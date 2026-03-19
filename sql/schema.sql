-- ================================================================
--  RealtyFlow CRM — Complete Schema (Fresh Install)
--  Run entire file in Supabase → SQL Editor → New Query
-- ================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ── PROJECTS ─────────────────────────────────────────────────
create table if not exists public.projects (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  location      text default '',
  developer     text default '',
  rera          text default '',
  total_plots   integer default 100,
  launch_date   date,
  infra_rate    numeric default 100,
  legal_charges numeric default 25000,
  sdr_rate      numeric default 6,
  maintenance   numeric default 0,
  swatch        integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── CUSTOM FIELDS ────────────────────────────────────────────
create table if not exists public.custom_fields (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references public.projects(id) on delete cascade,
  field_name   text not null,
  field_label  text not null,
  field_type   text default 'text' check (field_type in ('text','number','date','select','textarea','boolean')),
  field_options text[],
  applies_to   text default 'booking' check (applies_to in ('booking','cheque')),
  sort_order   integer default 0,
  is_required  boolean default false,
  created_at   timestamptz default now(),
  unique(project_id, field_name, applies_to)
);

-- ── PROFILES ─────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null check (role in ('superadmin','admin','sales')),
  created_at timestamptz default now()
);

-- ── PROJECT MEMBERS ──────────────────────────────────────────
create table if not exists public.project_members (
  id         uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  role       text not null check (role in ('admin','sales')),
  created_at timestamptz default now(),
  unique(project_id, user_id)
);

-- ── BOOKINGS ─────────────────────────────────────────────────
create table if not exists public.bookings (
  id                  uuid primary key default uuid_generate_v4(),
  project_id          uuid references public.projects(id) on delete cascade,
  serial_no           integer,
  booking_date        date,
  client_name         text not null,
  contact             text default '',
  plot_no             text default '',
  plot_size           numeric,
  basic_rate          numeric,
  infra               numeric default 100,
  agreement_value     numeric,
  sdr                 numeric,
  sdr_minus           numeric default 0,
  maintenance         numeric default 0,
  legal_charges       numeric default 25000,
  bank_name           text default '',
  banker_contact      text default '',
  loan_status         text default 'File Given' check (loan_status in (
    'File Given','Under Process','Sanction Received',
    'Disbursement Done','Agreement Completed','Cancelled'
  )),
  sanction_received   text,
  sanction_date       date,
  sanction_letter     text,
  sdr_received        numeric,
  sdr_received_date   date,
  disbursement_status text,
  disbursement_date   date,
  doc_submitted       text default '',
  disbursement_remark text default '',
  remark              text default '',
  custom_data         jsonb default '{}'::jsonb,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ── CHEQUES ──────────────────────────────────────────────────
create table if not exists public.cheques (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid references public.projects(id) on delete cascade,
  cust_name   text not null,
  plot_no     text default '',
  bank_detail text default '',
  cheque_no   text default '',
  cheque_date date,
  amount      numeric not null default 0,
  entry_type  text default 'RPM' check (entry_type in ('RPM','SM','NILL','cash','BOUNCE','Other')),
  custom_data jsonb default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz default now()
);

-- ── PREV TEAM BOOKINGS ────────────────────────────────────────
create table if not exists public.prev_bookings (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid references public.projects(id) on delete cascade,
  client_name     text not null,
  plot_no         text default '',
  plot_size       numeric,
  agreement_value numeric,
  notes           text default '',
  created_at      timestamptz default now()
);

-- ── TRIGGERS ─────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_projects_upd on public.projects;
create trigger trg_projects_upd before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_bookings_upd on public.bookings;
create trigger trg_bookings_upd before update on public.bookings
  for each row execute function public.set_updated_at();

-- ── DISABLE RLS (use Supabase anon key with grants instead) ──
alter table public.projects       disable row level security;
alter table public.custom_fields  disable row level security;
alter table public.profiles       disable row level security;
alter table public.project_members disable row level security;
alter table public.bookings       disable row level security;
alter table public.cheques        disable row level security;
alter table public.prev_bookings  disable row level security;

-- ── GRANTS ───────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;

-- ── USER MANAGEMENT FUNCTIONS (SECURITY DEFINER) ─────────────

-- Create user (inserts into auth.users directly)
create or replace function public.create_crm_user(
  p_email    text,
  p_password text,
  p_name     text,
  p_role     text
) returns uuid language plpgsql security definer as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    v_uid := uuid_generate_v4();
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, role, aud, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000',
      p_email, crypt(p_password, gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      json_build_object('full_name', p_name)::jsonb,
      false, 'authenticated', 'authenticated',
      now(), now(), '', '', '', ''
    );
  end if;
  insert into public.profiles (id, full_name, role)
  values (v_uid, p_name, p_role)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
  return v_uid;
end; $$;

-- Delete user completely
create or replace function public.delete_crm_user(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from public.project_members where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end; $$;

-- Assign user to project
create or replace function public.assign_to_project(
  p_user_id    uuid,
  p_project_id uuid,
  p_role       text
) returns void language plpgsql security definer as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do update set role = p_role;
end; $$;

-- Update user password
create or replace function public.update_user_password(
  p_user_id uuid,
  p_password text
) returns void language plpgsql security definer as $$
begin
  update auth.users
  set encrypted_password = crypt(p_password, gen_salt('bf', 10)),
      updated_at = now()
  where id = p_user_id;
end; $$;
