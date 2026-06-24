-- ============================================================
-- Cocoa House — LINE Order System Migration
-- ============================================================

-- ------------------------------------------------------------
-- 1. orders table — เพิ่ม columns สำหรับ LINE orders
-- ------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS source          TEXT    DEFAULT 'pos'
    CHECK (source IN ('pos', 'line')),
  ADD COLUMN IF NOT EXISTS customer_name   TEXT,
  ADD COLUMN IF NOT EXISTS line_user_id    TEXT,
  ADD COLUMN IF NOT EXISTS delivery_zone   TEXT
    CHECK (delivery_zone IN ('metro', 'tu', 'other')),
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  -- delivery_address schema:
  -- metro: { zone: 'metro', house_number: '88/12', soi: '5', note: '...' }
  -- tu:    { zone: 'tu', recipient_name: 'กระติก' }
  -- other: { zone: 'other', lat: 13.72, lng: 100.44, distance_km: 1.8 }
  ADD COLUMN IF NOT EXISTS order_status    TEXT    DEFAULT 'pending'
    CHECK (order_status IN ('pending', 'confirmed', 'out_for_delivery', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ;
  -- scheduled_at: null = สั่งทันที, มีค่า = สั่งล่วงหน้า (เวลาที่ต้องการจัดส่ง)

-- Index สำหรับ query ออเดอร์จาก LINE
CREATE INDEX IF NOT EXISTS idx_orders_source        ON orders (source);
CREATE INDEX IF NOT EXISTS idx_orders_line_user_id  ON orders (line_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status  ON orders (order_status);

-- ------------------------------------------------------------
-- 2. settings table — store hours + manual override
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ค่า default
INSERT INTO settings (key, value) VALUES
  ('store_open_time',  '08:00'),
  ('store_close_time', '20:00'),
  ('manual_override',  'null'),   -- null | 'open' | 'closed'
  ('reopen_at',        'null'),   -- ISO timestamp หรือ null
  ('min_order_other',  '249')     -- ขั้นต่ำสำหรับ zone "ที่อื่น"
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Supabase Realtime — เปิด Realtime สำหรับ orders
-- ------------------------------------------------------------
-- เปิดใน Supabase Dashboard: Database → Replication → orders table
-- หรือรัน:
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
