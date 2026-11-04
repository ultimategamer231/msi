-- M0.2 Foundation: immutable, hash-chained audit log and document number counters.
-- SPEC 6.3 (immutability, document_sequences), 7.5 (audit_log), 11 (Audit), FR-26,
-- recommendation R-02 (hash chain, approved 2026-11-04).

-- Heads of the hash chains (audit_log now; journals join in M1.1). Each row holds the number and
-- hash of the last link. Inserting into a chained table locks its head row, which serialises
-- chain writers and gives a gap-free chain_no in commit order.
create table public.hash_chains (
  chain text primary key,
  last_no bigint not null check (last_no >= 0),
  last_hash bytea not null
);

-- The genesis hash for a chain: sha256('genesis:<chain>').
create or replace function public.chain_genesis(p_chain text)
returns bytea
language sql
immutable
set search_path = public
as $$
  select sha256(convert_to('genesis:' || p_chain, 'UTF8'));
$$;

insert into public.hash_chains (chain, last_no, last_hash)
values ('audit_log', 0, public.chain_genesis('audit_log'));

-- SPEC 7.5 audit_log. `entity_id` is text because audited entities include settings (keyed by
-- name) as well as uuid rows.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  chain_no bigint not null unique,
  at timestamptz not null default public.app_now(),
  actor_id uuid references public.profiles (id),
  actor_role public.app_role,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text not null check (length(entity_type) between 1 and 60),
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  prev_hash bytea not null,
  hash bytea not null
);

comment on table public.audit_log is
  'Append-only audit trail of every change (FR-26). Rows are hash-chained by chain_no (R-02).';

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

-- Canonical digest of an audit row: sha256(prev_hash || canonical JSON array of its fields).
-- A JSON array is unambiguous (no separator collisions) and jsonb text output is normalised.
create or replace function public.audit_row_digest(p public.audit_log)
returns bytea
language sql
stable
set search_path = public
as $$
  select sha256(
    p.prev_hash || convert_to(
      jsonb_build_array(
        p.chain_no,
        p.id,
        to_char(p.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p.actor_id,
        p.actor_role,
        p.action,
        p.entity_type,
        p.entity_id,
        p.before,
        p.after,
        host(p.ip)
      )::text,
      'UTF8'
    )
  );
$$;

create or replace function public.trg_audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head public.hash_chains;
begin
  select * into v_head from hash_chains where chain = 'audit_log' for update;
  new.chain_no := v_head.last_no + 1;
  new.prev_hash := v_head.last_hash;
  new.hash := audit_row_digest(new);
  update hash_chains set last_no = new.chain_no, last_hash = new.hash where chain = 'audit_log';
  return new;
end
$$;

create trigger audit_log_chain
  before insert on public.audit_log
  for each row execute function public.trg_audit_chain();

create trigger audit_immutable
  before update or delete on public.audit_log
  for each row execute function public.trg_immutable();

create trigger audit_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.trg_immutable();

-- Walks the chain and returns the chain_no of the first broken link, or null when intact.
-- Detects edited rows, removed rows (gap or head mismatch) and re-ordered rows.
create or replace function public.verify_audit_chain()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.audit_log;
  v_prev bytea := chain_genesis('audit_log');
  v_expected bigint := 1;
  v_head_no bigint;
begin
  for v_row in select * from audit_log order by chain_no loop
    if v_row.chain_no <> v_expected
       or v_row.prev_hash <> v_prev
       or v_row.hash <> audit_row_digest(v_row) then
      return v_row.chain_no;
    end if;
    v_prev := v_row.hash;
    v_expected := v_expected + 1;
  end loop;

  select last_no into v_head_no from hash_chains where chain = 'audit_log';
  if v_head_no <> v_expected - 1 then
    return v_expected;
  end if;
  return null;
end
$$;

-- The only way rows enter audit_log. Internal: called from RPCs after their permission checks.
-- The client IP comes from the PostgREST request headers when present.
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip inet;
begin
  begin
    v_ip := nullif(
      btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)),
      ''
    )::inet;
  exception when others then
    v_ip := null;
  end;

  insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, before, after, ip)
  values (auth.uid(), auth_role(), p_action, p_entity_type, p_entity_id, p_before, p_after, v_ip);
end
$$;

-- Changing the deployment environment is rare and sensitive (it enables the demo clock), so it is
-- audited even though only the database owner can do it.
create or replace function public.trg_audit_environment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  perform write_audit('environment.changed', 'app_environment', 'kind',
    jsonb_build_object('kind', old.kind), jsonb_build_object('kind', new.kind));
  return new;
end
$$;

create trigger app_environment_audit
  before update on public.app_environment
  for each row
  when (old.kind is distinct from new.kind)
  execute function public.trg_audit_environment();

create trigger app_environment_no_delete
  before delete on public.app_environment
  for each row execute function public.trg_immutable();

-- SPEC 6.3 invariant 4: gapless counters per (kind, branch). Global sequences use the sentinel
-- branch id 00000000-0000-0000-0000-000000000000. next_number() arrives in M1.2.
create table public.document_sequences (
  kind text not null check (kind ~ '^[a-z_]+$'),
  branch_id uuid not null,
  last_value bigint not null default 0 check (last_value >= 0),
  primary key (kind, branch_id)
);

comment on table public.document_sequences is
  'Gapless document counters (SPEC 6.3). Written only by next_number() and set_sequence_start().';
