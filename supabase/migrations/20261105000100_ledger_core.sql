-- M1.1 Ledger core: chart of accounts, journals and journal lines with their invariants.
-- SPEC 6.1 (chart), 6.2 (recipes use these tables), 6.3 (invariants 1-3), 7.5 (journals, lines),
-- D-01, D-02, FR-21; R-02 (journals join the hash chain); tests T-20, T-21.

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}(-[A-Z][A-Z0-9]{1,9})?$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  type public.account_type not null,
  is_cash boolean not null default false,
  branch_id uuid references public.branches (id),
  active boolean not null default true,
  created_at timestamptz not null default public.app_now(),
  -- Branch cash accounts are "1010-<branch code>" and belong to that branch (SPEC 6.1).
  constraint accounts_cash_branch check (not is_cash or branch_id is not null)
);

comment on table public.accounts is 'Chart of accounts (SPEC 6.1). Retained earnings is computed, not an account.';

-- Every branch gets its cash account, including branches the admin adds later (SPEC 6.1, D-10).
create or replace function public.trg_branch_cash_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into accounts (code, name, type, is_cash, branch_id)
  values ('1010-' || new.code, 'Cash on Hand – ' || new.name, 'asset', true, new.id)
  on conflict (code) do nothing;
  return new;
end
$$;

create trigger branches_cash_account
  after insert on public.branches
  for each row execute function public.trg_branch_cash_account();

-- Existing branches (seeded before this migration) get theirs now.
insert into public.accounts (code, name, type, is_cash, branch_id)
select '1010-' || b.code, 'Cash on Hand – ' || b.name, 'asset', true, b.id
  from public.branches b
on conflict (code) do nothing;

-- Journals (SPEC 7.5). `content_hash` is the digest of the header and all its lines, computed by
-- post_journal before inserting; the chain trigger links it to the previous journal (R-02).
-- `posted_txid` records the creating transaction: lines can be added only in that transaction.
create table public.journals (
  id uuid primary key default gen_random_uuid(),
  journal_no text not null unique,
  entry_date date not null,
  memo text not null check (length(btrim(memo)) between 1 and 500),
  source_type text not null check (source_type ~ '^[a-z_]+$'),
  source_id uuid,
  branch_id uuid references public.branches (id),
  reversal_of uuid unique references public.journals (id),
  posted_by uuid references public.profiles (id),
  posted_at timestamptz not null default public.app_now(),
  posted_txid bigint not null default txid_current(),
  content_hash bytea not null,
  chain_no bigint not null unique,
  prev_hash bytea not null,
  hash bytea not null
);

comment on table public.journals is 'Posted journals (D-01, D-02). Append-only; corrections are reversing journals.';

create index journals_entry_date_idx on public.journals (entry_date desc);
create index journals_source_idx on public.journals (source_type, source_id);
create index journals_branch_idx on public.journals (branch_id, entry_date);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals (id),
  line_no int not null check (line_no >= 1),
  account_id uuid not null references public.accounts (id),
  debit_cents bigint not null default 0,
  credit_cents bigint not null default 0,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  fx_rate_micros bigint not null default 1000000 check (fx_rate_micros > 0),
  loan_id uuid,      -- foreign key added with `loans` (M3)
  customer_id uuid,  -- foreign key added with `customers` (M2)
  payee_id uuid,     -- foreign key added with `payees` (M8)
  staff_id uuid references public.profiles (id),
  component text check (component in ('principal', 'interest', 'penalty')),
  unique (journal_id, line_no),
  -- SPEC 6.3 invariant 2: a line is either a debit or a credit, never both, never negative.
  constraint line_one_sided check (
    debit_cents >= 0 and credit_cents >= 0 and (debit_cents = 0) <> (credit_cents = 0))
);

comment on table public.journal_lines is 'Journal lines (SPEC 7.5). Loan balances are sums over these rows (D-01).';

create index journal_lines_journal_idx on public.journal_lines (journal_id);
create index journal_lines_account_idx on public.journal_lines (account_id);
create index journal_lines_loan_component_idx on public.journal_lines (loan_id, component) where loan_id is not null;

-- SPEC 6.3 invariant 1: a journal must balance at commit.
create or replace function public.trg_journal_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d bigint;
  c bigint;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    into d, c from journal_lines where journal_id = new.journal_id;
  if d <> c or d = 0 then
    raise exception 'JOURNAL_UNBALANCED: debits % credits %', d, c using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger journal_lines_balanced
  after insert on public.journal_lines
  deferrable initially deferred
  for each row execute function public.trg_journal_balanced();

-- A journal with no lines at all would escape the line trigger, so journals check themselves too.
create or replace function public.trg_journal_has_lines()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from journal_lines where journal_id = new.id) then
    raise exception 'JOURNAL_UNBALANCED: journal % has no lines', new.journal_no using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger journals_have_lines
  after insert on public.journals
  deferrable initially deferred
  for each row execute function public.trg_journal_has_lines();

-- Lines belong to the transaction that created their journal: no lines can be added later.
create or replace function public.trg_journal_line_same_txn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from journals where id = new.journal_id and posted_txid = txid_current()) then
    raise exception 'IMMUTABLE_RECORD: lines cannot be added to an already posted journal' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger journal_lines_same_txn
  before insert on public.journal_lines
  for each row execute function public.trg_journal_line_same_txn();

-- SPEC 6.3 invariant 3: posted journals and lines are immutable.
create trigger journals_immutable
  before update or delete on public.journals
  for each row execute function public.trg_immutable();
create trigger journal_lines_immutable
  before update or delete on public.journal_lines
  for each row execute function public.trg_immutable();
create trigger journals_no_truncate
  before truncate on public.journals
  for each statement execute function public.trg_immutable();
create trigger journal_lines_no_truncate
  before truncate on public.journal_lines
  for each statement execute function public.trg_immutable();

-- Content digest of a journal: header fields plus its lines in line order, as canonical JSON.
create or replace function public.journal_content_digest(
  p_journal_no text,
  p_entry_date date,
  p_memo text,
  p_source_type text,
  p_source_id uuid,
  p_branch_id uuid,
  p_reversal_of uuid,
  p_lines jsonb
)
returns bytea
language sql
immutable
set search_path = public
as $$
  select sha256(convert_to(
    jsonb_build_array(p_journal_no, p_entry_date, p_memo, p_source_type, p_source_id, p_branch_id, p_reversal_of,
                      p_lines)::text,
    'UTF8'));
$$;

-- Canonical JSON of a stored journal's lines (same shape post_journal hashes).
create or replace function public.journal_lines_canonical(p_journal_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           l.line_no, a.code, l.debit_cents, l.credit_cents, l.currency, l.fx_rate_micros,
           l.loan_id, l.customer_id, l.payee_id, l.staff_id, l.component) order by l.line_no), '[]'::jsonb)
    from journal_lines l
    join accounts a on a.id = l.account_id
   where l.journal_id = p_journal_id;
$$;

insert into public.hash_chains (chain, last_no, last_hash)
values ('journals', 0, public.chain_genesis('journals'));

create or replace function public.trg_journal_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head public.hash_chains;
begin
  select * into v_head from hash_chains where chain = 'journals' for update;
  new.chain_no := v_head.last_no + 1;
  new.prev_hash := v_head.last_hash;
  new.hash := sha256(v_head.last_hash || new.content_hash || convert_to(new.chain_no::text, 'UTF8'));
  update hash_chains set last_no = new.chain_no, last_hash = new.hash where chain = 'journals';
  return new;
end
$$;

create trigger journals_chain
  before insert on public.journals
  for each row execute function public.trg_journal_chain();

-- First broken link in the journal chain (edited header, edited/added/removed lines, removed
-- journal), or null when intact.
create or replace function public.verify_journal_chain()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.journals;
  v_prev bytea := chain_genesis('journals');
  v_expected bigint := 1;
  v_content bytea;
  v_head_no bigint;
begin
  for v_row in select * from journals order by chain_no loop
    v_content := journal_content_digest(v_row.journal_no, v_row.entry_date, v_row.memo, v_row.source_type,
                                        v_row.source_id, v_row.branch_id, v_row.reversal_of,
                                        journal_lines_canonical(v_row.id));
    if v_row.chain_no <> v_expected
       or v_row.prev_hash <> v_prev
       or v_row.content_hash <> v_content
       or v_row.hash <> sha256(v_prev || v_content || convert_to(v_row.chain_no::text, 'UTF8')) then
      return v_row.chain_no;
    end if;
    v_prev := v_row.hash;
    v_expected := v_expected + 1;
  end loop;

  select last_no into v_head_no from hash_chains where chain = 'journals';
  if v_head_no <> v_expected - 1 then
    return v_expected;
  end if;
  return null;
end
$$;

-- RLS (SPEC 6.4): the chart is readable by all staff (cash accounts are chosen on forms); the
-- ledger itself by ceo, manager, accountant and admin. No write policies: only post_journal writes.
alter table public.accounts enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;

create policy accounts_read on public.accounts
  for select to authenticated using ((select public.is_staff()));
create policy journals_read on public.journals
  for select to authenticated using ((select public.auth_role()) in ('ceo', 'manager', 'accountant', 'admin'));
create policy journal_lines_read on public.journal_lines
  for select to authenticated using ((select public.auth_role()) in ('ceo', 'manager', 'accountant', 'admin'));

revoke all on public.accounts, public.journals, public.journal_lines from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.accounts, public.journals, public.journal_lines from authenticated, service_role;

revoke execute on function public.trg_branch_cash_account() from public, anon, authenticated, service_role;
revoke execute on function public.journal_content_digest(text, date, text, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.journal_lines_canonical(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.verify_journal_chain() from public, anon, authenticated;
grant execute on function public.verify_journal_chain() to service_role;

-- Postgres grants EXECUTE on new functions to PUBLIC by a global default that a schema-scoped
-- default privilege cannot remove (the 0005 statement only covered named roles). Remove the global
-- default so every future function starts with no grants, and revoke the functions created above.
alter default privileges for role postgres revoke execute on functions from public;
revoke execute on function public.trg_journal_balanced() from public, anon, authenticated, service_role;
revoke execute on function public.trg_journal_has_lines() from public, anon, authenticated, service_role;
revoke execute on function public.trg_journal_line_same_txn() from public, anon, authenticated, service_role;
revoke execute on function public.trg_journal_chain() from public, anon, authenticated, service_role;
