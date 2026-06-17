-- ============================================================
-- COCOA HOUSE - Supabase Database Setup
-- วิธีใช้: Copy ทั้งหมดนี้ไปรันใน Supabase SQL Editor
-- ============================================================

-- =================== EXTENSIONS ===================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =================== DROP TABLES (for fresh start) ===================
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS platform_costs CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS menu_prices CASCADE;
DROP TABLE IF EXISTS menus CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

-- =================== CREATE TABLES ===================

-- เมนู
CREATE TABLE menus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Cocoa','Coffee','Matcha','Classic','Hot','Bun','Refill','Addon')),
  gp_cost DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ประวัติราคาแยกต่อ Platform
CREATE TABLE menu_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_id UUID REFERENCES menus(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('GRAB','LINE','SHOPEE','Other')),
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_menu_prices_menu_platform ON menu_prices(menu_id, platform);
CREATE INDEX idx_menu_prices_effective ON menu_prices(effective_from, effective_to);

-- ยอดขายรายวันแยกต่อ Platform
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('GRAB','LINE','SHOPEE','Other')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, platform)
);
CREATE INDEX idx_orders_date ON orders(date);

-- รายการสินค้าในแต่ละ order
CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  menu_id UUID REFERENCES menus(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_gp_cost DECIMAL(10,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_menu ON order_items(menu_id);

-- ค่าใช้จ่าย Platform ต่อวัน
CREATE TABLE platform_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('GRAB','LINE','SHOPEE','Other')),
  menu_discount DECIMAL(10,2) DEFAULT 0,
  campaign DECIMAL(10,2) DEFAULT 0,
  marketing_fee DECIMAL(10,2) DEFAULT 0,
  delivery_discount DECIMAL(10,2) DEFAULT 0,
  advertisement DECIMAL(10,2) DEFAULT 0,
  UNIQUE(date, platform)
);
CREATE INDEX idx_platform_costs_date ON platform_costs(date);

-- Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT,
  action TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- =================== ROW LEVEL SECURITY ===================

ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated" ON menus FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON menu_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON platform_costs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =================== DEFAULT SETTINGS ===================

INSERT INTO settings (key, value) VALUES
  ('grab_fee_pct', '30'),
  ('line_fee_pct', '30'),
  ('shopee_fee_pct', '30'),
  ('other_fee_pct', '0'),
  ('grab_defaults', '{"menu_discount":0,"campaign":0,"marketing_fee":0,"delivery_discount":0,"advertisement":0}'),
  ('line_defaults', '{"menu_discount":0,"campaign":0,"marketing_fee":0,"delivery_discount":0,"advertisement":0}'),
  ('shopee_defaults', '{"menu_discount":0,"campaign":0,"marketing_fee":0,"delivery_discount":0,"advertisement":0}'),
  ('other_defaults', '{"menu_discount":0,"campaign":0,"marketing_fee":0,"delivery_discount":0,"advertisement":0}'),
  ('display_name', '"Cocoa House"')
ON CONFLICT (key) DO NOTHING;

-- =================== SEED MENUS (59 items) ===================

-- Helper function to insert menu + prices
CREATE OR REPLACE FUNCTION insert_menu_with_prices(
  p_name TEXT,
  p_category TEXT,
  p_price DECIMAL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO menus (name, category, gp_cost)
  VALUES (p_name, p_category, 0)
  RETURNING id INTO v_id;

  INSERT INTO menu_prices (menu_id, platform, price, effective_from)
  VALUES
    (v_id, 'GRAB', p_price, '2024-01-01'),
    (v_id, 'LINE', p_price, '2024-01-01'),
    (v_id, 'SHOPEE', p_price, '2024-01-01'),
    (v_id, 'Other', p_price, '2024-01-01');

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Cocoa (15)
SELECT insert_menu_with_prices('Signature COCORO Bomb', 'Cocoa', 153);
SELECT insert_menu_with_prices('Signature COCORO Noir Cocoa', 'Cocoa', 153);
SELECT insert_menu_with_prices('Dutch Premium', 'Cocoa', 94);
SELECT insert_menu_with_prices('Dutch DARK Premium', 'Cocoa', 94);
SELECT insert_menu_with_prices('Cocoa House brand', 'Cocoa', 94);
SELECT insert_menu_with_prices('Hershey''s natural', 'Cocoa', 104);
SELECT insert_menu_with_prices('Droste sine 1863', 'Cocoa', 107);
SELECT insert_menu_with_prices('Cocoa Classic No.1', 'Cocoa', 88);
SELECT insert_menu_with_prices('Switzerland Cocoa', 'Cocoa', 116);
SELECT insert_menu_with_prices('Belgium Cocoa', 'Cocoa', 111);
SELECT insert_menu_with_prices('Cocoa Hazelnut', 'Cocoa', 108);
SELECT insert_menu_with_prices('Cocoa Vanilla', 'Cocoa', 108);
SELECT insert_menu_with_prices('Cocoa Macadamia', 'Cocoa', 108);
SELECT insert_menu_with_prices('Cocoa tiramisu', 'Cocoa', 108);
SELECT insert_menu_with_prices('Cocoa caramel', 'Cocoa', 108);

-- Coffee (7)
SELECT insert_menu_with_prices('ICE Americano Ethiopia', 'Coffee', 75);
SELECT insert_menu_with_prices('ICE Americano Nan', 'Coffee', 70);
SELECT insert_menu_with_prices('ICE Americano Brazil', 'Coffee', 75);
SELECT insert_menu_with_prices('Cappuccino', 'Coffee', 85);
SELECT insert_menu_with_prices('Latte', 'Coffee', 85);
SELECT insert_menu_with_prices('Espresso Brazil', 'Coffee', 85);
SELECT insert_menu_with_prices('ICE Mocha', 'Coffee', 85);

-- Matcha (9)
SELECT insert_menu_with_prices('Coconut Matcha', 'Matcha', 137);
SELECT insert_menu_with_prices('P.Uji latte', 'Matcha', 144);
SELECT insert_menu_with_prices('P.Nishio latte', 'Matcha', 144);
SELECT insert_menu_with_prices('P.YAME latte', 'Matcha', 162);
SELECT insert_menu_with_prices('C.UJI latte', 'Matcha', 171);
SELECT insert_menu_with_prices('P.UJI Pure', 'Matcha', 135);
SELECT insert_menu_with_prices('P.Nishio Pure', 'Matcha', 135);
SELECT insert_menu_with_prices('P.YAME Pure', 'Matcha', 144);
SELECT insert_menu_with_prices('C.UJI Pure', 'Matcha', 153);

-- Classic (2)
SELECT insert_menu_with_prices('Thai tea', 'Classic', 65);
SELECT insert_menu_with_prices('Thai green tea', 'Classic', 65);

-- Hot (5)
SELECT insert_menu_with_prices('HOT Cocoa', 'Hot', 70);
SELECT insert_menu_with_prices('HOT Milk', 'Hot', 60);
SELECT insert_menu_with_prices('HOT Coffee Americano', 'Hot', 60);
SELECT insert_menu_with_prices('Hot Coffee Latte', 'Hot', 65);
SELECT insert_menu_with_prices('Hot Matcha Latte', 'Hot', 120);

-- Bun (7)
SELECT insert_menu_with_prices('เนยถังทองนม', 'Bun', 58);
SELECT insert_menu_with_prices('เนยถังทอง นมน้ำตาล', 'Bun', 58);
SELECT insert_menu_with_prices('เนยถังทอง นม+ชอค', 'Bun', 71);
SELECT insert_menu_with_prices('เนยถังทอง นูเทล่า', 'Bun', 71);
SELECT insert_menu_with_prices('เนยถังทอง Lotus Biscoff', 'Bun', 71);
SELECT insert_menu_with_prices('เนยถังทอง Creamy Peanut Butter', 'Bun', 71);
SELECT insert_menu_with_prices('เนยถังทอง Ovaltine Crunchy', 'Bun', 71);

-- Refill (11)
SELECT insert_menu_with_prices('Refill Classic No1', 'Refill', 70);
SELECT insert_menu_with_prices('Refill Cocoa house brand', 'Refill', 74);
SELECT insert_menu_with_prices('Refill Dutch Premium', 'Refill', 74);
SELECT insert_menu_with_prices('Refill Dutch dark Premium', 'Refill', 74);
SELECT insert_menu_with_prices('Refill Hersheys', 'Refill', 74);
SELECT insert_menu_with_prices('Refill Hazelnut', 'Refill', 94);
SELECT insert_menu_with_prices('Refill Macadamia', 'Refill', 94);
SELECT insert_menu_with_prices('Refill Vanilla', 'Refill', 94);
SELECT insert_menu_with_prices('Refill Thiramisu', 'Refill', 94);
SELECT insert_menu_with_prices('Refill Caramel', 'Refill', 94);
SELECT insert_menu_with_prices('Refill Belgium Cocoa', 'Refill', 89);

-- Addon (3)
SELECT insert_menu_with_prices('Oat milk', 'Addon', 25);
SELECT insert_menu_with_prices('จิตรดา', 'Addon', 25);
SELECT insert_menu_with_prices('นมหมี', 'Addon', 25);

-- Drop helper function
DROP FUNCTION insert_menu_with_prices;

-- =================== HELPER VIEWS ===================

-- View: current prices (latest per menu/platform)
CREATE OR REPLACE VIEW current_menu_prices AS
SELECT DISTINCT ON (menu_id, platform)
  mp.id,
  mp.menu_id,
  mp.platform,
  mp.price,
  mp.effective_from,
  m.name,
  m.category,
  m.gp_cost,
  m.is_active
FROM menu_prices mp
JOIN menus m ON m.id = mp.menu_id
WHERE mp.effective_to IS NULL
ORDER BY menu_id, platform, effective_from DESC;

-- =================== DONE ===================
-- จำนวนเมนูที่สร้าง:
SELECT COUNT(*) as total_menus FROM menus;
SELECT COUNT(*) as total_prices FROM menu_prices;
