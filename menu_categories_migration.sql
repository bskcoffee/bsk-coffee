-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  BSK coffee&bakery — Menu categories default setting
--  Run this in Supabase SQL Editor (once)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Default list of product categories shown in MenuManagementPage.
-- Editable from จัดการเมนู → จัดการหมวดหมู่ (add / rename / delete / reorder).
-- If this row is missing, the app falls back to the same 8 categories below.
-- NOTE: Bun / Refill / Addon are reserved — cocoa-pos/src/pages/POSPage.jsx
-- keys special ordering behavior off these exact names, so the UI blocks
-- renaming/deleting them.
INSERT INTO public.settings (key, value)
VALUES ('menu_categories', '["Cocoa","Coffee","Matcha","Classic","Hot","Bun","Refill","Addon"]')
ON CONFLICT (key) DO NOTHING;
