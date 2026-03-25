
-- ── AUDIT LOG TABLE (run this if you haven't already) ────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL DEFAULT '',
  user_role   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL DEFAULT '',
  entity      TEXT NOT NULL DEFAULT '',
  entity_id   UUID,
  entity_name TEXT DEFAULT '',
  detail      TEXT DEFAULT '',
  changes     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON public.audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_log(user_id, created_at DESC);
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.audit_log TO anon, authenticated;
-- ================================================================
--  RealtyFlow CRM — COMPLETE FIX
--  Run this ENTIRE file in Supabase SQL Editor → New Query → Run
-- ================================================================

-- Step 1: Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 2: Fix any missing profiles for existing auth users  
INSERT INTO public.profiles (id, full_name, role)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  'sales'
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
  AND u.email_confirmed_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Step 3: Ensure your superadmin has the right role
UPDATE public.profiles 
SET role = 'superadmin', full_name = 'Super Admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'atharva.joshi@beyondwalls.com');

-- Step 4: Re-grant everything
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Step 5: Auto-create profile trigger (fixes all future users)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name TEXT;
  v_count INTEGER;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE role = 'superadmin';
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, v_name, CASE WHEN v_count = 0 THEN 'superadmin' ELSE 'sales' END)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Step 6: Recreate user management functions
CREATE OR REPLACE FUNCTION public.create_crm_user(
  p_email TEXT, p_password TEXT, p_name TEXT, p_role TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = p_email;
  IF v_uid IS NULL THEN
    v_uid := uuid_generate_v4();
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, role, aud,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000',
      p_email, crypt(p_password, gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      json_build_object('full_name', p_name)::JSONB,
      false, 'authenticated', 'authenticated', now(), now(), '', '', '', ''
    );
  END IF;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_uid, p_name, p_role)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
  RETURN v_uid;
END; $$;

CREATE OR REPLACE FUNCTION public.delete_crm_user(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.project_members WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_user_password(p_user_id UUID, p_password TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users SET encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now() WHERE id = p_user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.assign_to_project(p_user_id UUID, p_project_id UUID, p_role TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role) VALUES (p_project_id, p_user_id, p_role)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role;
END; $$;

-- Step 7: Show results
SELECT u.email, p.full_name, p.role, 
  CASE WHEN u.email_confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'unconfirmed' END as status
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;
