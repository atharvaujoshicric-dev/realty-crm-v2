-- ================================================================
--  RealtyFlow CRM — Complete Schema v3
--  Run ENTIRE file in Supabase SQL Editor → New Query → Run
-- ================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── DROP & RECREATE (clean slate) ────────────────────────────
DROP TABLE IF EXISTS public.prev_bookings CASCADE;
DROP TABLE IF EXISTS public.cheques CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.custom_fields CASCADE;
DROP TABLE IF EXISTS public.project_members CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;

-- ── PROJECTS ─────────────────────────────────────────────────
CREATE TABLE public.projects (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  location      TEXT DEFAULT '',
  developer     TEXT DEFAULT '',
  rera          TEXT DEFAULT '',
  total_plots   INTEGER DEFAULT 100,
  launch_date   DATE,
  infra_rate    NUMERIC DEFAULT 100,
  legal_charges NUMERIC DEFAULT 25000,
  sdr_rate      NUMERIC DEFAULT 6,
  maintenance   NUMERIC DEFAULT 0,
  swatch        INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── PROFILES ─────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('superadmin','admin','sales')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── PROJECT MEMBERS ──────────────────────────────────────────
CREATE TABLE public.project_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin','sales')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- ── CUSTOM FIELDS ────────────────────────────────────────────
CREATE TABLE public.custom_fields (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  field_name    TEXT NOT NULL,
  field_label   TEXT NOT NULL,
  field_type    TEXT DEFAULT 'text' CHECK (field_type IN ('text','number','date','select','textarea','boolean')),
  field_options TEXT[],
  applies_to    TEXT DEFAULT 'booking' CHECK (applies_to IN ('booking','cheque')),
  sort_order    INTEGER DEFAULT 0,
  is_required   BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, field_name, applies_to)
);

-- ── BOOKINGS ─────────────────────────────────────────────────
CREATE TABLE public.bookings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  serial_no           INTEGER,
  booking_date        DATE,
  client_name         TEXT NOT NULL,
  contact             TEXT DEFAULT '',
  plot_no             TEXT DEFAULT '',
  plot_size           NUMERIC,
  basic_rate          NUMERIC,
  infra               NUMERIC DEFAULT 100,
  agreement_value     NUMERIC,
  sdr                 NUMERIC,
  sdr_minus           NUMERIC DEFAULT 0,
  maintenance         NUMERIC DEFAULT 0,
  legal_charges       NUMERIC DEFAULT 25000,
  bank_name           TEXT DEFAULT '',
  banker_contact      TEXT DEFAULT '',
  loan_status         TEXT DEFAULT 'File Given' CHECK (loan_status IN (
    'File Given','Under Process','Sanction Received',
    'Disbursement Done','Agreement Completed','Cancelled'
  )),
  sanction_received   TEXT,
  sanction_date       DATE,
  sanction_letter     TEXT,
  sdr_received        NUMERIC,
  sdr_received_date   DATE,
  disbursement_status TEXT,
  disbursement_date   DATE,
  disbursement_remark TEXT DEFAULT '',
  doc_submitted       TEXT DEFAULT '',
  remark              TEXT DEFAULT '',
  custom_data         JSONB DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ── CHEQUES ──────────────────────────────────────────────────
CREATE TABLE public.cheques (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cust_name   TEXT NOT NULL,
  plot_no     TEXT DEFAULT '',
  bank_detail TEXT DEFAULT '',
  cheque_no   TEXT DEFAULT '',
  cheque_date DATE,
  amount      NUMERIC NOT NULL DEFAULT 0,
  entry_type  TEXT DEFAULT 'RPM' CHECK (entry_type IN ('RPM','SM','NILL','cash','BOUNCE','Other')),
  custom_data JSONB DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── PREV TEAM BOOKINGS ────────────────────────────────────────
CREATE TABLE public.prev_bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_name     TEXT NOT NULL,
  plot_no         TEXT DEFAULT '',
  plot_size       NUMERIC,
  agreement_value NUMERIC,
  notes           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_projects_upd BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER trg_bookings_upd BEFORE UPDATE ON public.bookings  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── DISABLE RLS ───────────────────────────────────────────────
ALTER TABLE public.projects        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prev_bookings   DISABLE ROW LEVEL SECURITY;

-- ── GRANTS ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- ── USER MANAGEMENT FUNCTIONS ─────────────────────────────────

-- create_crm_user: inserts directly into auth.users (SECURITY DEFINER bypasses restrictions)
CREATE OR REPLACE FUNCTION public.create_crm_user(
  p_email    TEXT,
  p_password TEXT,
  p_name     TEXT,
  p_role     TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = p_email;
  IF v_uid IS NULL THEN
    v_uid := uuid_generate_v4();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, role, aud, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000',
      p_email, crypt(p_password, gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      json_build_object('full_name', p_name)::JSONB,
      false, 'authenticated', 'authenticated',
      now(), now(), '', '', '', ''
    );
  END IF;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_uid, p_name, p_role)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
  RETURN v_uid;
END; $$;

-- delete_crm_user: removes from auth.users + profiles + members
CREATE OR REPLACE FUNCTION public.delete_crm_user(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.project_members WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END; $$;

-- update_user_password
CREATE OR REPLACE FUNCTION public.update_user_password(
  p_user_id UUID, p_password TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now()
  WHERE id = p_user_id;
END; $$;

-- assign_to_project
CREATE OR REPLACE FUNCTION public.assign_to_project(
  p_user_id UUID, p_project_id UUID, p_role TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (p_project_id, p_user_id, p_role)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role;
END; $$;

-- ── CREATE SUPERADMIN ─────────────────────────────────────────
-- Run this separately after the above:
-- SELECT public.create_crm_user('your@email.com', 'YourPassword123!', 'Super Admin', 'superadmin');

-- ── AUTO-CREATE PROFILE ON AUTH USER CREATION ─────────────────
-- This trigger fires whenever a new user is created in auth.users
-- ensuring profiles row always exists even if created via Dashboard

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name TEXT;
  v_role TEXT;
  v_count INTEGER;
BEGIN
  -- Get name from metadata
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );
  -- If no superadmin exists yet, first user becomes superadmin
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE role = 'superadmin';
  v_role := CASE WHEN v_count = 0 THEN 'superadmin' ELSE 'sales' END;
  -- Insert profile (ignore if already exists)
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, v_name, v_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ── AUDIT LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL,
  user_role   TEXT NOT NULL,
  action      TEXT NOT NULL,  -- 'CREATE','UPDATE','DELETE','IMPORT','LOGIN'
  entity      TEXT NOT NULL,  -- 'booking','cheque','prev_booking','project','user'
  entity_id   UUID,
  entity_name TEXT,           -- e.g. client name for quick reference
  detail      TEXT,           -- human-readable summary of what changed
  changes     JSONB,          -- {field: {old, new}} for updates
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_audit_project ON public.audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_log(user_id, created_at DESC);

-- Disable RLS
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.audit_log TO anon, authenticated;

-- ── AUDIT LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL DEFAULT '',
  user_role   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,   -- 'create' | 'update' | 'delete' | 'import' | 'cancel'
  entity      TEXT NOT NULL,   -- 'booking' | 'cheque' | 'prev_booking'
  entity_id   UUID,
  entity_name TEXT DEFAULT '',  -- client name / cheque ref for quick display
  old_data    JSONB,            -- snapshot before change
  new_data    JSONB,            -- snapshot after change
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.audit_log TO anon, authenticated;
