-- ================================================================
--  RealtyFlow CRM — FIX SCRIPT
--  Run this in Supabase SQL Editor if you have an existing database
--  This fixes: created_by FK issues, grants, functions
-- ================================================================

-- Fix created_by columns (remove FK constraint that blocks imports)
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_created_by_fkey;
ALTER TABLE public.cheques  DROP CONSTRAINT IF EXISTS cheques_created_by_fkey;

-- Re-grant everything
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Fix auth permissions
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON auth.users TO authenticated;

-- Recreate create_crm_user with proper error handling
CREATE OR REPLACE FUNCTION public.create_crm_user(
  p_email    text,
  p_password text,
  p_name     text,
  p_role     text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_uid uuid;
BEGIN
  -- Check if already exists
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
      '{"provider":"email","providers":["email"]}'::jsonb,
      json_build_object('full_name', p_name)::jsonb,
      false, 'authenticated', 'authenticated',
      now(), now(), '', '', '', ''
    );
  END IF;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_uid, p_name, p_role)
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role;
  RETURN v_uid;
END; $$;

-- Recreate delete_crm_user
CREATE OR REPLACE FUNCTION public.delete_crm_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.project_members WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END; $$;

-- Recreate update_user_password
CREATE OR REPLACE FUNCTION public.update_user_password(
  p_user_id uuid, p_password text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = p_user_id;
END; $$;

-- Recreate assign_to_project
CREATE OR REPLACE FUNCTION public.assign_to_project(
  p_user_id uuid, p_project_id uuid, p_role text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (p_project_id, p_user_id, p_role)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = p_role;
END; $$;

-- Verify superadmin exists, if not recreate
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE role = 'superadmin';
  IF v_count = 0 THEN
    RAISE NOTICE 'No superadmin found. Run create_crm_user to create one.';
  ELSE
    RAISE NOTICE 'Superadmin exists. All good.';
  END IF;
END $$;

-- Show current state
SELECT p.full_name, p.role, u.email, u.email_confirmed_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.role, p.full_name;
