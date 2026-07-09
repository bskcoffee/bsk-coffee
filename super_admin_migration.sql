-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  BSK coffee&bakery — Super Admin role + permissions
--  Run this in Supabase SQL Editor (once), AFTER profiles_migration.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Allow 'super_admin' as a third role value
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'staff'));

-- 2. Promote chaiyapord.k@gmail.com to super_admin
UPDATE public.profiles
SET role = 'super_admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'chaiyapord.k@gmail.com');

-- 3. Replace change_user_role RPC with 3-tier authorization:
--    - staff              → cannot call this at all
--    - admin              → can toggle staff ⇄ admin only
--                            (cannot grant/revoke super_admin, cannot touch a super_admin's role)
--    - super_admin        → can set anyone's role to staff / admin / super_admin
--    - nobody can change their own role (unchanged from before)
CREATE OR REPLACE FUNCTION public.change_user_role(target_id uuid, new_role text)
RETURNS void AS $$
DECLARE
  caller_role text;
  target_role text;
BEGIN
  IF new_role NOT IN ('super_admin', 'admin', 'staff') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;
  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  SELECT role INTO target_role FROM public.profiles WHERE id = target_id;

  IF caller_role IS NULL OR caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: only admins can change roles';
  END IF;

  -- Only a super_admin may grant/revoke super_admin, or change an existing super_admin's role
  IF caller_role <> 'super_admin' AND (new_role = 'super_admin' OR target_role = 'super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: only super admin can manage the super admin role';
  END IF;

  UPDATE public.profiles SET role = new_role WHERE id = target_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.change_user_role(uuid, text) TO authenticated;

-- 4. Default "which of the 7 daily-ops pages can Staff see" setting.
--    Admin/Super Admin edit this from การจัดการผู้ใช้งาน → สิทธิ์การเข้าถึงเมนู (พนักงาน).
--    If this row is missing, the app defaults to showing all 7 pages to staff.
INSERT INTO public.settings (key, value)
VALUES ('staff_page_access', '["/","/sales","/history","/reports","/menu","/cost","/cashflow"]')
ON CONFLICT (key) DO NOTHING;

-- 5. Verify result
SELECT u.email, p.role, u.created_at
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;
