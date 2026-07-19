-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  BSK coffee&bakery — Convert hardcoded ความหวาน/บรรจุภัณฑ์
--  ให้เป็นกลุ่มตัวเลือกเสริม (menu_option_groups) เหมือนกลุ่มอื่นๆ
--  Run this in Supabase SQL Editor (once)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- เดิม "ความหวาน" และ "บรรจุภัณฑ์" ถูก hardcode ไว้ใน MenuOptionModal.jsx
-- (SWEETNESS_LEVELS / PACKAGING_OPTIONS) แยกจากระบบตัวเลือกเสริมทั่วไป
-- migration นี้สร้าง 2 กลุ่มใหม่ให้เหมือนกลุ่มอื่น (บังคับ, เลือกได้ 1, ราคา 0)
-- แล้วผูกกับทุกหมวดหมู่เมนูที่มีอยู่ตอนนี้ (ดึงจาก settings.menu_categories โดยตรง
-- ไม่ hardcode ชื่อหมวดหมู่ไว้ในไฟล์นี้ เผื่อมีการแก้ชื่อ/เพิ่มหมวดหมู่ไปแล้ว)

do $$
declare
  cats          jsonb;
  sweetness_id  uuid;
  packaging_id  uuid;
begin
  select value::jsonb into cats from public.settings where key = 'menu_categories';
  if cats is null then
    cats := '["Cocoa","Coffee","Matcha","Classic","Hot","Bun"]'::jsonb;
  end if;

  -- ความหวาน (บังคับ, เลือกได้ 1, ฟรีทุกตัวเลือก)
  insert into public.menu_option_groups (name, selection_type, max_select, required, categories, sort_order, is_active)
  values ('ความหวาน', 'single', 1, true, cats, -20, true)
  returning id into sweetness_id;

  insert into public.menu_option_choices (group_id, label, price, sort_order, is_active) values
    (sweetness_id, '0%',   0, 1, true),
    (sweetness_id, '10%',  0, 2, true),
    (sweetness_id, '25%',  0, 3, true),
    (sweetness_id, '50%',  0, 4, true),
    (sweetness_id, '100%', 0, 5, true);

  -- บรรจุภัณฑ์ (บังคับ, เลือกได้ 1, ฟรีทุกตัวเลือก)
  insert into public.menu_option_groups (name, selection_type, max_select, required, categories, sort_order, is_active)
  values ('บรรจุภัณฑ์', 'single', 1, true, cats, -10, true)
  returning id into packaging_id;

  insert into public.menu_option_choices (group_id, label, price, sort_order, is_active) values
    (packaging_id, 'แยกน้ำแข็ง', 0, 1, true),
    (packaging_id, 'พร้อมดื่ม',  0, 2, true);
end $$;
