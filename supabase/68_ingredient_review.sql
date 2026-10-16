-- =====================================================================
--  ขั้นที่ 68: สารสำคัญที่ระบบใส่ให้ (66_combo_drugs.sql) ติดป้าย auto = ยังไม่ผ่านการทวนสอบของผู้ดูแล · รันซ้ำได้ · ไม่ลบข้อมูล
--   หน้าผู้ดูแลเตือนให้ทวนสอบกับฉลากจริง · ผู้ดูแลกดบันทึก = ทวนสอบแล้ว (ป้ายหาย)
--   ingredients[] รองรับ dose_id รายสาร (ข้อมูลคำนวณขนาดยาของสารนั้น) · u/amt = หน่วยที่กรอก (mcg) · mg = ค่าที่ใช้คำนวณ (มก.)
-- =====================================================================
update public.local_drugs
   set ingredients = (select jsonb_agg(e || '{"auto":true}' order by n) from jsonb_array_elements(ingredients) with ordinality t(e, n))
 where ingredients in ('[{"name":"Sulfamethoxazole","mg":400,"per":"tab"},{"name":"Trimethoprim","mg":80,"per":"tab"}]'::jsonb,
                       '[{"name":"Sulfamethoxazole","mg":200,"per":"5ml"},{"name":"Trimethoprim","mg":40,"per":"5ml"}]'::jsonb);

select 'ok' as step_68_ingredient_review, (select count(*) from public.local_drugs where ingredients @> '[{"auto":true}]') as auto_rows;
