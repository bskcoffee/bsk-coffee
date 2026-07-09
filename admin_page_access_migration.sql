-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  BSK coffee&bakery — Admin page-access default setting
--  Run this in Supabase SQL Editor (once), AFTER super_admin_migration.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Default "which of the 6 special pages can Admin see" setting.
-- Super Admin edits this from การจัดการผู้ใช้งาน → สิทธิ์การเข้าถึงเมนู (ผู้ดูแลระบบ).
-- If this row is missing, the app defaults to: Admin has ตั้งค่า/ตั้งค่าฉลาก/การจัดการผู้ใช้งาน,
-- and NOT นำเข้าข้อมูล/AI Memory/System Architecture (matches original fixed behavior).
INSERT INTO public.settings (key, value)
VALUES ('admin_page_access', '["/settings","/label-settings","/users"]')
ON CONFLICT (key) DO NOTHING;
