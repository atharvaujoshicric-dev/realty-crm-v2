-- ================================================================
--  RealtyFlow CRM v2 — Complete Supabase Schema
--  Run this entire file in Supabase → SQL Editor → New Query
-- ================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ──────────────────────────────────────────────────────────────
--  PROJECTS
-- ──────────────────────────────────────────────────────────────
create table public.projects (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  location      text,
  developer     text,
  rera          text,
  total_plots   integer default 100,
  launch_date   date,
  infra_rate    numeric default 100,
  legal_charges numeric default 25000,
  sdr_rate      numeric default 6,
  maintenance   numeric default 0,
  swatch        integer default 0,
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
--  CUSTOM FIELD DEFINITIONS  (per project)
-- ──────────────────────────────────────────────────────────────
create table public.custom_fields (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  field_name   text not null,          -- internal key  e.g. "ref_name"
  field_label  text not null,          -- display label e.g. "Reference Name"
  field_type   text not null default 'text'
               check (field_type in ('text','number','date','select','textarea','boolean')),
  field_options text[],                -- for select type
  applies_to   text not null default 'booking'
               check (applies_to in ('booking','cheque')),
  sort_order   integer default 0,
  is_required  boolean default false,
  created_at   timestamptz default now(),
  unique(project_id, field_name, applies_to)
);

-- ──────────────────────────────────────────────────────────────
--  PROFILES  (extends auth.users)
-- ──────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null check (role in ('superadmin','admin','sales')),
  created_at timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
--  PROJECT MEMBERS
-- ──────────────────────────────────────────────────────────────
create table public.project_members (
  id         uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  role       text not null check (role in ('admin','sales')),
  created_at timestamptz default now(),
  unique(project_id, user_id)
);

-- ──────────────────────────────────────────────────────────────
--  BOOKINGS
-- ──────────────────────────────────────────────────────────────
create table public.bookings (
  id                  uuid primary key default uuid_generate_v4(),
  project_id          uuid references public.projects(id) on delete cascade,
  serial_no           integer,
  booking_date        date,
  client_name         text not null,
  contact             text,
  plot_no             text,
  plot_size           numeric,
  basic_rate          numeric,
  infra               numeric default 100,
  agreement_value     numeric,
  sdr                 numeric,
  sdr_minus           numeric default 0,
  maintenance         numeric default 0,
  legal_charges       numeric default 25000,
  bank_name           text,
  banker_contact      text,
  loan_status         text default 'File Given'
                      check (loan_status in ('File Given','Under Process','Sanction Received',
                                             'Disbursement Done','Agreement Completed','Cancelled')),
  sanction_received   text,
  sanction_date       date,
  sanction_letter     text,
  sdr_received        numeric,
  sdr_received_date   date,
  disbursement_status text,
  disbursement_date   date,
  doc_submitted       text,
  disbursement_remark text,
  remark              text,
  custom_data         jsonb default '{}'::jsonb,   -- stores custom field values
  created_by          uuid references public.profiles(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
--  CHEQUES
-- ──────────────────────────────────────────────────────────────
create table public.cheques (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid references public.projects(id) on delete cascade,
  cust_name   text not null,
  plot_no     text,
  bank_detail text,
  cheque_no   text,
  cheque_date date,
  amount      numeric not null,
  entry_type  text default 'RPM'
              check (entry_type in ('RPM','SM','NILL','cash','BOUNCE','Other')),
  custom_data jsonb default '{}'::jsonb,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
--  PREVIOUS TEAM BOOKINGS
-- ──────────────────────────────────────────────────────────────
create table public.prev_bookings (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid references public.projects(id) on delete cascade,
  client_name     text not null,
  plot_no         text,
  plot_size       numeric,
  agreement_value numeric,
  notes           text,
  created_at      timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────
--  UPDATED_AT TRIGGER
-- ──────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_projects_upd before update on public.projects
  for each row execute function public.set_updated_at();
create trigger trg_bookings_upd before update on public.bookings
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────
alter table public.projects        enable row level security;
alter table public.custom_fields   enable row level security;
alter table public.profiles        enable row level security;
alter table public.project_members enable row level security;
alter table public.bookings        enable row level security;
alter table public.cheques         enable row level security;
alter table public.prev_bookings   enable row level security;

-- Helper functions
create or replace function public.my_role()
returns text language sql security definer stable as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_project_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(project_id), '{}')
  from public.project_members where user_id = auth.uid();
$$;

-- PROFILES
create policy "profiles_sel" on public.profiles for select
  using (id = auth.uid() or public.my_role() = 'superadmin');
create policy "profiles_ins" on public.profiles for insert
  with check (true);
create policy "profiles_del" on public.profiles for delete
  using (public.my_role() = 'superadmin');

-- PROJECTS
create policy "proj_sel" on public.projects for select
  using (public.my_role() = 'superadmin' or id = any(public.my_project_ids()));
create policy "proj_ins" on public.projects for insert
  with check (public.my_role() = 'superadmin');
create policy "proj_upd" on public.projects for update
  using (public.my_role() = 'superadmin'
      or (public.my_role() = 'admin' and id = any(public.my_project_ids())));
create policy "proj_del" on public.projects for delete
  using (public.my_role() = 'superadmin');

-- CUSTOM FIELDS
create policy "cf_sel" on public.custom_fields for select
  using (public.my_role() = 'superadmin' or project_id = any(public.my_project_ids()));
create policy "cf_ins" on public.custom_fields for insert
  with check (public.my_role() in ('superadmin','admin'));
create policy "cf_upd" on public.custom_fields for update
  using (public.my_role() in ('superadmin','admin'));
create policy "cf_del" on public.custom_fields for delete
  using (public.my_role() in ('superadmin','admin'));

-- PROJECT MEMBERS
create policy "mem_sel" on public.project_members for select
  using (public.my_role() = 'superadmin' or project_id = any(public.my_project_ids()));
create policy "mem_ins" on public.project_members for insert
  with check (public.my_role() in ('superadmin','admin'));
create policy "mem_del" on public.project_members for delete
  using (public.my_role() in ('superadmin','admin'));

-- BOOKINGS
create policy "bk_sel" on public.bookings for select
  using (public.my_role() = 'superadmin' or project_id = any(public.my_project_ids()));
create policy "bk_ins" on public.bookings for insert
  with check (public.my_role() in ('superadmin','admin')
           and project_id = any(public.my_project_ids()));
create policy "bk_upd" on public.bookings for update
  using (public.my_role() in ('superadmin','admin')
      and project_id = any(public.my_project_ids()));
create policy "bk_del" on public.bookings for delete
  using (public.my_role() in ('superadmin','admin')
      and project_id = any(public.my_project_ids()));

-- CHEQUES
create policy "chq_sel" on public.cheques for select
  using (public.my_role() = 'superadmin' or project_id = any(public.my_project_ids()));
create policy "chq_ins" on public.cheques for insert
  with check (public.my_role() in ('superadmin','admin')
           and project_id = any(public.my_project_ids()));
create policy "chq_upd" on public.cheques for update
  using (public.my_role() in ('superadmin','admin')
      and project_id = any(public.my_project_ids()));
create policy "chq_del" on public.cheques for delete
  using (public.my_role() in ('superadmin','admin')
      and project_id = any(public.my_project_ids()));

-- PREV BOOKINGS
create policy "prev_sel" on public.prev_bookings for select
  using (public.my_role() = 'superadmin' or project_id = any(public.my_project_ids()));
create policy "prev_ins" on public.prev_bookings for insert
  with check (public.my_role() in ('superadmin','admin')
           and project_id = any(public.my_project_ids()));
create policy "prev_del" on public.prev_bookings for delete
  using (public.my_role() in ('superadmin','admin'));

-- ──────────────────────────────────────────────────────────────
--  ADMIN FUNCTIONS (security definer — bypass RLS safely)
-- ──────────────────────────────────────────────────────────────

-- Create auth user + profile
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
      is_super_admin, role, aud, created_at, updated_at
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000'::uuid,
      p_email, crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      json_build_object('full_name', p_name)::jsonb,
      false, 'authenticated', 'authenticated', now(), now()
    );
  end if;
  insert into public.profiles (id, full_name, role)
  values (v_uid, p_name, p_role)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
  return v_uid;
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

-- List all users with projects (superadmin only)
create or replace function public.list_all_users()
returns table (
  id uuid, full_name text, role text, email text,
  project_ids uuid[], project_names text[], created_at timestamptz
) language plpgsql security definer as $$
begin
  if (select public.my_role()) != 'superadmin' then
    raise exception 'Forbidden';
  end if;
  return query
    select p.id, p.full_name, p.role, u.email::text,
      coalesce(array_agg(pm.project_id) filter (where pm.project_id is not null), '{}'),
      coalesce(array_agg(pr.name)       filter (where pr.name       is not null), '{}'),
      p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.project_members pm on pm.user_id = p.id
    left join public.projects pr on pr.id = pm.project_id
    group by p.id, p.full_name, p.role, u.email, p.created_at
    order by p.created_at;
end; $$;

-- Remove user from project (keep auth user, remove membership)
create or replace function public.remove_from_project(
  p_user_id    uuid,
  p_project_id uuid
) returns void language plpgsql security definer as $$
begin
  delete from public.project_members
  where user_id = p_user_id and project_id = p_project_id;
end; $$;
