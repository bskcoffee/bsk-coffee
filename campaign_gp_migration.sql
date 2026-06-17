-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  Cocoa House — Grab Campaign 60/40 GP Support
--  Run once in Supabase SQL Editor
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Step 1: campaign_revenue on platform_costs (already added — safe to re-run)
ALTER TABLE public.platform_costs
  ADD COLUMN IF NOT EXISTS campaign_revenue NUMERIC DEFAULT 0;

-- Step 2: is_campaign on order_items
-- Marks individual menu items that belong to a Grab 60/40 campaign order (GP = 5%)
-- Normal items: is_campaign = false (32.1% GP baked into unit_gp_cost)
-- Campaign items: is_campaign = true (5% GP baked into unit_gp_cost)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_campaign BOOLEAN DEFAULT false;

-- Verify order_items columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'order_items'
ORDER BY ordinal_position;
