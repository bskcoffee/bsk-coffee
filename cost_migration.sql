-- ============================================================
-- Cocoa House — Cost Versioning Migration
-- รัน SQL นี้ใน Supabase SQL Editor (ทำครั้งเดียว)
-- ============================================================

-- 1. ตาราง cost_settings (ค่าใช้จ่ายส่วนกลาง พร้อม Version)
CREATE TABLE IF NOT EXISTS cost_settings (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  key            TEXT NOT NULL,
  value          NUMERIC NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cost_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own cost_settings" ON cost_settings;
CREATE POLICY "Users manage own cost_settings" ON cost_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cost_settings_key ON cost_settings(key, effective_from);

-- 2. ตาราง menu_costs (ต้นทุนวัตถุดิบต่อเมนู พร้อม Version)
CREATE TABLE IF NOT EXISTS menu_costs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  menu_id         UUID REFERENCES menus(id) ON DELETE CASCADE,
  main_ingredient NUMERIC DEFAULT 0,
  milk_condensed  NUMERIC DEFAULT 0,
  milk_mixed      NUMERIC DEFAULT 0,
  milk_fresh      NUMERIC DEFAULT 0,
  packaging_type  TEXT DEFAULT 'beverage',
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- packaging_type: 'beverage' | 'bun' | 'none'

ALTER TABLE menu_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own menu_costs" ON menu_costs;
CREATE POLICY "Users manage own menu_costs" ON menu_costs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_menu_costs_menu ON menu_costs(menu_id, effective_from);

-- 3. Seed ค่า Default ลง cost_settings
INSERT INTO cost_settings (key, value, effective_from) VALUES
  -- บรรจุภัณฑ์เครื่องดื่ม
  ('packaging_bev_cup',     3.00,  CURRENT_DATE),
  ('packaging_bev_sticker', 0.39,  CURRENT_DATE),
  ('packaging_bev_straw',   0.13,  CURRENT_DATE),
  ('packaging_bev_seal',    0.10,  CURRENT_DATE),
  ('packaging_bev_bag',     0.24,  CURRENT_DATE),
  -- บรรจุภัณฑ์ขนมปัง
  ('packaging_bun_box',     2.50,  CURRENT_DATE),
  ('packaging_bun_sticker', 0.39,  CURRENT_DATE),
  ('packaging_bun_bag',     0.50,  CURRENT_DATE),
  -- ต้นทุนร่วม
  ('consumables',           1.00,  CURRENT_DATE),
  ('operation_cost',        2.00,  CURRENT_DATE),
  -- เปอร์เซ็นต์
  ('labor_pct',            10.00,  CURRENT_DATE),
  ('marketing_pct',        10.00,  CURRENT_DATE);

-- 4. ตรวจสอบผลลัพธ์
SELECT 'cost_settings' AS table_name, COUNT(*) AS total_rows FROM cost_settings
UNION ALL
SELECT 'menu_costs',                   COUNT(*) FROM menu_costs;

-- ผลลัพธ์ที่ถูกต้อง:
-- cost_settings | 12
-- menu_costs    | 0  (ยังไม่มีข้อมูลวัตถุดิบ — กรอกผ่านหน้า "ต้นทุนเมนู")
