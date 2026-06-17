-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  Cocoa House — User Profiles + Role-Based Access
--  Run this in Supabase SQL Editor (once)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid  REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      text  NOT NULL DEFAULT '',
  role       text  NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Policies — read-all, update own profile only (role changes via RPC)
DROP POLICY IF EXISTS "authenticated_all"    ON public.profiles;
DROP POLICY IF EXISTS "profiles_select"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Users may update their own row, but cannot change their own role
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- INSERT handled by trigger (service_role only via SECURITY DEFINER function)
-- Profile rows are auto-created on signup; no direct client INSERT needed

-- 4. Function: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (new.id, COALESCE(new.email, ''), 'staff')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Trigger: fire after each new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 6. Backfill existing users (run safely with ON CONFLICT)
INSERT INTO public.profiles (id, email, role)
SELECT id, COALESCE(email, ''), 'staff'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 7. Promote the earliest user to admin (store owner / first account)
UPDATE public.profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1
);

-- 8. Secure RPC — only admins can change user roles
-- Call from client: supabase.rpc('change_user_role', { target_id: '...', new_role: 'staff' })
CREATE OR REPLACE FUNCTION public.change_user_role(target_id uuid, new_role text)
RETURNS void AS $$
BEGIN
  IF new_role NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;
  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only admins can change roles';
  END IF;
  UPDATE public.profiles SET role = new_role WHERE id = target_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.change_user_role(uuid, text) TO authenticated;

-- 9. Verify result
SELECT
  u.email,
  p.role,
  u.created_at
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;
