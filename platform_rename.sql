-- ============================================================
-- Cocoa House — Platform Rename Migration
-- Other → The metro  +  เพิ่ม TU
-- รัน SQL นี้ใน Supabase SQL Editor
-- ============================================================

-- 1. เปลี่ยนชื่อ Other → The metro ในทุกตาราง
UPDATE menu_prices     SET platform = 'The metro' WHERE platform = 'Other';
UPDATE orders          SET platform = 'The metro' WHERE platform = 'Other';
UPDATE platform_costs  SET platform = 'The metro' WHERE platform = 'Other';

-- 2. เปลี่ยน settings key
UPDATE settings SET key = 'the_metro_fee_pct' WHERE key = 'other_fee_pct';

-- 3. เพิ่ม TU fee setting (0% default)
INSERT INTO settings (key, value) VALUES ('tu_fee_pct', '0')
ON CONFLICT (key) DO NOTHING;

-- 4. Seed ราคา TU จาก The metro (copy ราคาปัจจุบัน)
INSERT INTO menu_prices (menu_id, platform, price, effective_from)
SELECT menu_id, 'TU', price, CURRENT_DATE
FROM menu_prices
WHERE platform = 'The metro'
AND effective_to IS NULL;

-- 5. ตรวจสอบผลลัพธ์
SELECT platform, COUNT(*) AS rows
FROM menu_prices
WHERE effective_to IS NULL
GROUP BY platform
ORDER BY platform;

-- ผลลัพธ์ที่ถูกต้อง:
-- GRAB       | 59
-- LINE       | 59
-- SHOPEE     | 59
-- The metro  | 59
-- TU         | 59
