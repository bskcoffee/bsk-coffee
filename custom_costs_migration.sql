-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  Cocoa House — Custom Cost Rows per Menu
--  Run once in Supabase SQL Editor
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add custom_costs JSONB column to menu_costs
-- Format: [{ "label": "น้ำตาลทราย", "amount": 2.50 }, ...]
-- Included in materialCost calculation per item
ALTER TABLE public.menu_costs
  ADD COLUMN IF NOT EXISTS custom_costs JSONB DEFAULT '[]';

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'menu_costs'
ORDER BY ordinal_position;
