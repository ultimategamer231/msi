-- seed_local.sql: local development only (listed in supabase/config.toml, never run in the cloud).
-- Marks the database as a development environment so the business clock can be moved (B-01).
update public.app_environment set kind = 'development' where id and kind <> 'development';
