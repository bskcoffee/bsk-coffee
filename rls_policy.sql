-- ============================================================
-- Cocoa House — RLS Policy (ปลอดภัย ใช้งานได้หลายคน)
-- รัน SQL นี้ใน Supabase SQL Editor
-- สามารถรันซ้ำได้ปลอดภัย (DROP IF EXISTS ก่อนทุกครั้ง)
-- ============================================================
--
-- หลักการ:
--   ✅ ต้อง login ก่อนถึงจะเข้าถึงข้อมูลได้
--   ✅ ผู้ใช้ทุกคนในระบบเห็นข้อมูลร่วมกัน (shared café data)
--   ❌ ผู้ที่ไม่ได้ login ไม่สามารถดึงข้อมูลได้แม้จะมี anon key
-- ============================================================


-- ============================================================
-- 1. ORIGINAL TABLES (ตรวจสอบให้แน่ใจว่า RLS เปิดอยู่)
-- ============================================================

ALTER TABLE menus          ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;

-- menus
DROP POLICY IF EXISTS "Allow all for authenticated" ON menus;
CREATE POLICY "authenticated_all" ON menus
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- menu_prices
DROP POLICY IF EXISTS "Allow all for authenticated" ON menu_prices;
CREATE POLICY "authenticated_all" ON menu_prices
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- orders
DROP POLICY IF EXISTS "Allow all for authenticated" ON orders;
CREATE POLICY "authenticated_all" ON orders
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- order_items
DROP POLICY IF EXISTS "Allow all for authenticated" ON order_items;
CREATE POLICY "authenticated_all" ON order_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- platform_costs
DROP POLICY IF EXISTS "Allow all for authenticated" ON platform_costs;
CREATE POLICY "authenticated_all" ON platform_costs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- settings
DROP POLICY IF EXISTS "Allow all for authenticated" ON settings;
CREATE POLICY "authenticated_all" ON settings
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- audit_logs
DROP POLICY IF EXISTS "Allow all for authenticated" ON audit_logs;
CREATE POLICY "authenticated_all" ON audit_logs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- 2. MIGRATION TABLES (แก้ bug — เดิมเป็น user-scoped ต้องเปลี่ยนเป็น shared)
--
--  ⚠️  ปัญหาเดิม: policy ใช้ auth.uid() = user_id
--      ทำให้ user ใหม่มองไม่เห็น cost settings ที่ admin สร้างไว้
--      ต้องเปลี่ยนเป็น shared เหมือนตารางอื่น
-- ============================================================

ALTER TABLE cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_costs    ENABLE ROW LEVEL SECURITY;

-- cost_settings (แก้จาก user-scoped → shared)
DROP POLICY IF EXISTS "Users manage own cost_settings" ON cost_settings;
DROP POLICY IF EXISTS "authenticated_all"               ON cost_settings;
CREATE POLICY "authenticated_all" ON cost_settings
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- menu_costs (แก้จาก user-scoped → shared)
DROP POLICY IF EXISTS "Users manage own menu_costs" ON menu_costs;
DROP POLICY IF EXISTS "authenticated_all"            ON menu_costs;
CREATE POLICY "authenticated_all" ON menu_costs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- 3. ตรวจสอบผล — ควรเห็น policy ทุกตาราง
-- ============================================================

SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'menus','menu_prices','orders','order_items',
    'platform_costs','settings','audit_logs',
    'cost_settings','menu_costs'
  )
ORDER BY tablename;

-- ผลที่ถูกต้อง: ทุกตารางมี policy "authenticated_all" FOR ALL roles = {authenticated}
