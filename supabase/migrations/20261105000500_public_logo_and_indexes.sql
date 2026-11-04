-- B-22 (approved 2026-11-04): the company logo may appear on public pages (sign-in, /verify,
-- printed documents). The `branding` bucket holds only the logo, so it becomes public-read; uploads
-- stay admin-only (policy branding_insert_admin) and nothing can be overwritten or deleted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true;

-- The sign-in page needs the logo path as well as the names.
create or replace function public.public_branding()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', value ->> 'name', 'short_name', value ->> 'short_name',
                            'logo_path', value ->> 'logo_path')
    from settings
   where key = 'company';
$$;

-- R-12 (supabase db advisors): covering indexes for foreign keys that queries filter or join on.
create index if not exists accounts_branch_id_idx on public.accounts (branch_id);
create index if not exists journals_posted_by_idx on public.journals (posted_by);
create index if not exists journal_lines_staff_id_idx on public.journal_lines (staff_id) where staff_id is not null;
create index if not exists approval_requests_decided_by_idx on public.approval_requests (decided_by) where decided_by is not null;
