-- ================================================================
--  Run this in Supabase SQL Editor to fix "Database error querying schema"
--  This creates missing profiles for any existing auth users
-- ================================================================

-- 1. Add the auto-profile trigger (so future users never have this issue)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name TEXT;
  v_role TEXT;
  v_count INTEGER;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE role = 'superadmin';
  v_role := CASE WHEN v_count = 0 THEN 'superadmin' ELSE 'sales' END;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, v_name, v_role)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 2. Fix all existing auth users that have no profile row
INSERT INTO public.profiles (id, full_name, role)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  'sales'  -- default role; update manually for admins
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- 3. Make sure at least one superadmin exists
-- If your superadmin has no profile, this fixes it:
UPDATE public.profiles 
SET role = 'superadmin'
WHERE id = (
  SELECT id FROM auth.users 
  WHERE email = 'atharva.joshi@beyondwalls.com'
  LIMIT 1
);

-- 4. Show current state
SELECT u.email, p.full_name, p.role, u.email_confirmed_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;
