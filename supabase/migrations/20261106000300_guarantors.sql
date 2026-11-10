-- M2.5: guarantors (SPEC 7.2; FR-05): optional, per loan, with ID details and a document scan.
-- Rows are written by the loan draft RPC in M3 (create_loan_draft), which also adds the foreign
-- key to loans; this block fixes the model and its validation.

create table public.guarantors (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text not null,
  address text check (length(address) <= 300),
  id_type text check (id_type in ('national_id', 'passport', 'voter_card', 'drivers_license', 'other')),
  id_number text check (length(id_number) <= 120),
  relationship text check (length(relationship) <= 60),
  doc_path text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now(),
  constraint guarantor_id_pair check ((id_type is null) = (id_number is null))
);

comment on table public.guarantors is 'Optional guarantors per loan (SPEC 7.2, FR-05). Written only by the loan RPCs.';

create index guarantors_loan_id_idx on public.guarantors (loan_id);
create index guarantors_created_by_idx on public.guarantors (created_by);

alter table public.guarantors enable row level security;
create policy guarantors_read on public.guarantors
  for select to authenticated using ((select public.is_staff()));
revoke all on public.guarantors from anon;
revoke insert, update, delete, truncate, references, trigger on public.guarantors from authenticated, service_role;

-- Validates and cleans the guarantors of a loan request: at most 3 (A-10: guarantors optional);
-- name and phone required; ID type and number together; the scan is checked when the loan RPC
-- links it. Returns the cleaned array (blanks as null). Raises INVALID_STATE.
create or replace function public.clean_guarantors(p_guarantors jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_clean jsonb;
  v_result jsonb := '[]'::jsonb;
  v_key text;
begin
  if p_guarantors is null or p_guarantors = 'null'::jsonb then
    return v_result;
  end if;
  if jsonb_typeof(p_guarantors) <> 'array' then
    raise exception 'INVALID_STATE: guarantors must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_guarantors) > 3 then
    raise exception 'INVALID_STATE: at most 3 guarantors per loan' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_guarantors) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_STATE: a guarantor must be a set of fields' using errcode = '22023';
    end if;
    v_clean := '{}'::jsonb;
    foreach v_key in array array['full_name', 'phone', 'address', 'id_type', 'id_number', 'relationship'] loop
      v_clean := v_clean || jsonb_build_object(v_key, nullif(btrim(coalesce(v_item ->> v_key, '')), ''));
    end loop;
    if v_clean ->> 'full_name' is null or length(v_clean ->> 'full_name') > 120 then
      raise exception 'INVALID_STATE: each guarantor needs a name (up to 120 characters)' using errcode = '22023';
    end if;
    if length(coalesce(phone_key(v_clean ->> 'phone'), '')) not between 7 and 15 then
      raise exception 'INVALID_STATE: each guarantor needs a valid phone number' using errcode = '22023';
    end if;
    if (v_clean ->> 'id_type' is null) <> (v_clean ->> 'id_number' is null)
       or coalesce(v_clean ->> 'id_type', 'national_id')
          not in ('national_id', 'passport', 'voter_card', 'drivers_license', 'other') then
      raise exception 'INVALID_STATE: give both a valid ID type and the ID number' using errcode = '22023';
    end if;
    if length(v_clean ->> 'address') > 300 or length(v_clean ->> 'relationship') > 60
       or length(v_clean ->> 'id_number') > 120 then
      raise exception 'INVALID_STATE: a guarantor field is too long' using errcode = '22023';
    end if;
    if v_item ? 'doc' then
      v_clean := v_clean || jsonb_build_object('doc', v_item -> 'doc');
    end if;
    v_result := v_result || jsonb_build_array(v_clean);
  end loop;
  return v_result;
end
$$;

revoke execute on function public.clean_guarantors(jsonb) from public, anon, authenticated, service_role;
