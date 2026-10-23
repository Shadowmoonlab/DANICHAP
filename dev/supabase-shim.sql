-- ═══════════════════════════════════════════════════════════════════════════
-- dev/supabase-shim.sql — Lo mínimo de Supabase para correr los SQL de docs/ en local
-- (roles de PostgREST, esquema auth, esquema storage, extensiones). SOLO ambiente local.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Roles (mismos nombres que Supabase) ───────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator-dev';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- Mismos permisos por defecto que un proyecto Supabase nuevo (RLS decide qué se ve)
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ── auth ──────────────────────────────────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}',
  created_at          timestamptz not null default now()
);

-- Claims del JWT que PostgREST pone en cada request
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt() ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true), auth.jwt() ->> 'role'), '')
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ── storage (solo tablas para que las policies de docs/ compilen) ─────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id      text primary key,
  name    text not null,
  public  boolean default false
);
create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text,
  owner       uuid,
  created_at  timestamptz default now()
);
alter table storage.objects enable row level security;
