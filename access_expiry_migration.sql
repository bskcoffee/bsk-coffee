-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  BSK coffee&bakery — Access Expiry (per-user usage limit)
--  Run this in Supabase SQL Editor (once)
--
--  จุดประสงค์: ให้ super_admin กำหนด/ต่ออายุจำนวนวันที่ admin และ staff
--  แต่ละคนใช้งานระบบได้ (เผื่ออนาคตขายระบบนี้เป็นแพ็กเกจให้ลูกค้ารายอื่น)
--  super_admin ไม่ถูกจำกัดด้วยค่านี้เลยไม่ว่ากรณีใด
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. เพิ่มคอลัมน์วันหมดอายุการใช้งาน — NULL = ไม่จำกัด (ค่า default นี้จะไม่กระทบ
--    ผู้ใช้ทุกคนที่มีอยู่แล้วในระบบ จนกว่า super_admin จะตั้งค่าจำกัดวันให้ใครสักคน)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz NULL;

-- 2. RPC สำหรับต่ออายุ/ตั้งวันหมดอายุ — เรียกได้เฉพาะ super_admin เท่านั้น
--    days_to_add: จำนวนวันที่จะต่อ (นับต่อจากวันหมดอายุเดิม ถ้ายังไม่หมดอายุ
--    หรือนับจากวันนี้ถ้าหมดอายุไปแล้ว/ยังไม่เคยตั้งค่า)
CREATE OR REPLACE FUNCTION public.extend_user_access(target_id uuid, days_to_add int)
RETURNS timestamptz AS $$
DECLARE
  caller_role text;
  current_expiry timestamptz;
  base_date timestamptz;
  new_expiry timestamptz;
BEGIN
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: only super admin can set access expiry';
  END IF;

  IF days_to_add IS NULL OR days_to_add <= 0 THEN
    RAISE EXCEPTION 'Invalid days_to_add: %', days_to_add;
  END IF;

  SELECT access_expires_at INTO current_expiry FROM public.profiles WHERE id = target_id;
  base_date := GREATEST(COALESCE(current_expiry, now()), now());
  new_expiry := base_date + (days_to_add || ' days')::interval;

  UPDATE public.profiles SET access_expires_at = new_expiry WHERE id = target_id;
  RETURN new_expiry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.extend_user_access(uuid, int) TO authenticated;

-- 3. RPC สำหรับยกเลิกวันหมดอายุ (ตั้งเป็นไม่จำกัด) — super_admin เท่านั้น
CREATE OR REPLACE FUNCTION public.clear_user_access_expiry(target_id uuid)
RETURNS void AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: only super admin can clear access expiry';
  END IF;

  UPDATE public.profiles SET access_expires_at = NULL WHERE id = target_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.clear_user_access_expiry(uuid) TO authenticated;

-- 4. ตรวจผลลัพธ์
SELECT u.email, p.role, p.access_expires_at
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;
