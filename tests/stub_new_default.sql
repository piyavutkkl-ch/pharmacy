-- Minimal stand-ins for what a fresh Supabase project already has (test only)
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}'
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text default (auth.uid())::text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to anon, authenticated;

create publication supabase_realtime;
alter default privileges in schema public revoke execute on functions from public;

-- Vault (เก็บค่าลับเข้ารหัส) + pg_net (เรียก HTTP จากฐานข้อมูลแบบไม่รอผล) — จำลองเท่าที่ 37_ai_match.sql ใช้
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as
$$ insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null) returns void language sql as
$$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create schema net;
grant usage on schema net to anon, authenticated;
create table net.http_request_queue (id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds int);
create table net._http_response (id bigint, status_code int, content_type text, headers jsonb, content text, timed_out bool, error_msg text, created timestamptz not null default now());
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
language sql security definer as
$$ insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds) values ('POST', url, headers, convert_to(body::text, 'utf8'), timeout_milliseconds) returning id $$;
grant execute on function net.http_post(text, jsonb, jsonb, jsonb, int) to anon, authenticated;
