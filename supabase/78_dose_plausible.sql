-- =====================================================================
--  ขั้นที่ 78: เพดานความสมเหตุสมผลของขนาดยาต่อ กก. (audit F-12) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ① เพดานแข็ง 10,000 มก./กก. (10 ก./กก.): เกินนี้เป็นไปไม่ได้สำหรับยาใด ๆ = พิมพ์ผิด/ผิดหน่วย → ยาที่แสดงบันทึกไม่ได้ (dose_inds_problem)
--   ② เพดานติดธงตรวจ (ค่าเริ่ม 500 มก./กก. · site_texts 'dose_soft_max_mg_per_kg' ให้เภสัชกรปรับได้):
--      คำตอบ AI ที่เกินนี้ไม่ใช้ + บอกเหตุผล (dose_ai_item_problem) · ฟอร์มผู้ดูแลถามยืนยันก่อนบันทึก (admin-settings.js SOFT_MAX)
--   ไม่ใช่เกณฑ์ขนาดยาทางคลินิกของยาแต่ละตัว
-- =====================================================================

create or replace function public.dose_soft_max()
returns numeric language sql stable
set search_path = ''
as $$
  select coalesce((select btrim(t.body)::numeric from public.site_texts t where t.key = 'dose_soft_max_mg_per_kg' and btrim(t.body) ~ '^\d+(\.\d+)?$'), 500)
$$;
grant execute on function public.dose_soft_max() to anon, authenticated;

create or replace function public.dose_inds_problem(p jsonb)
returns text language plpgsql immutable
set search_path = ''
as $$
declare e jsonb; t jsonb; n int := 0; w text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then return 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ'; end if;
  for e in select x from jsonb_array_elements(p) x loop
    n := n + 1; w := 'ข้อบ่งใช้ ' || n || ': ';
    if jsonb_typeof(e) <> 'object' then return w || 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
    if btrim(coalesce(e->>'name', '')) = '' then return w || 'ยังไม่มีชื่อข้อบ่งใช้'; end if;
    if coalesce(e->>'per', '') not in ('dose', 'day') then return w || 'ต้องระบุว่าเป็นขนาดต่อครั้งหรือต่อวัน'; end if;
    if coalesce(jsonb_typeof(e->'min'), '') <> 'number' or coalesce(jsonb_typeof(e->'max'), '') <> 'number' then return w || 'ต้องมีขนาดยาต่ำสุดและสูงสุดเป็นตัวเลข'; end if;
    if (e->>'min')::numeric < 0 then return w || 'ขนาดยาต้องไม่ติดลบ'; end if;
    if (e->>'max')::numeric <= 0 then return w || 'ขนาดยาสูงสุดต้องมากกว่า 0'; end if;
    if (e->>'max')::numeric < (e->>'min')::numeric then return w || 'ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด'; end if;
    if (e->>'max')::numeric * (case when e->>'unit' = 'mcg' then 0.001 else 1 end) > 10000 then
      return w || 'ขนาดยาสูงเกินกว่าจะเป็นไปได้ (เกิน 10,000 มก./กก.) · ตรวจหน่วยและจุดทศนิยม';
    end if;
    if e->>'per' = 'day' and not (coalesce(jsonb_typeof(e->'times'), '') = 'number' and (e->>'times')::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then
      return w || 'ขนาดต่อวันต้องระบุจำนวนครั้งที่แบ่งให้ (1–12 ครั้ง)';
    end if;
    if coalesce(jsonb_typeof(e->'times_alt'), 'null') not in ('null', 'array') then return w || 'จำนวนครั้งแบบอื่นไม่ถูกต้อง'; end if;
    if jsonb_typeof(e->'times_alt') = 'array' then
      for t in select y from jsonb_array_elements(e->'times_alt') y loop
        if not (jsonb_typeof(t) = 'number' and t::text::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then return w || 'จำนวนครั้งแบบอื่นต้องเป็น 1–12'; end if;
      end loop;
    end if;
    if coalesce(jsonb_typeof(e->'cap'), 'null') <> 'null' and not (jsonb_typeof(e->'cap') = 'number' and (e->>'cap')::numeric > 0) then
      return w || 'ขนาดสูงสุดต่อครั้งต้องเป็นตัวเลขมากกว่า 0';
    end if;
    if coalesce(e->>'unit', 'mg') not in ('mg', 'mcg') then return w || 'หน่วยขนาดยาต้องเป็น มก. หรือ mcg'; end if;
    if coalesce(jsonb_typeof(e->'cap_day'), 'null') <> 'null' and not (jsonb_typeof(e->'cap_day') = 'number' and (e->>'cap_day')::numeric > 0) then
      return w || 'ขนาดสูงสุดต่อวันต้องเป็นตัวเลขมากกว่า 0';
    end if;
    if (coalesce(jsonb_typeof(e->'age_min'), 'null') <> 'null' and not (jsonb_typeof(e->'age_min') = 'number' and (e->>'age_min')::numeric between 0 and 120))
       or (coalesce(jsonb_typeof(e->'age_max'), 'null') <> 'null' and not (jsonb_typeof(e->'age_max') = 'number' and (e->>'age_max')::numeric between 0 and 120)) then
      return w || 'ช่วงอายุต้องเป็นตัวเลข 0–120 ปี';
    end if;
    if jsonb_typeof(e->'age_min') = 'number' and jsonb_typeof(e->'age_max') = 'number' and (e->>'age_max')::numeric <= (e->>'age_min')::numeric then
      return w || 'อายุสูงสุดต้องมากกว่าอายุต่ำสุด';
    end if;
  end loop;
  return null;
end $$;
grant execute on function public.dose_inds_problem(jsonb) to anon, authenticated;

create or replace function public.dose_ai_item_problem(e jsonb, lab jsonb)
returns text language plpgsql stable
set search_path = ''
as $$
declare q text := public.dose_norm(e->>'quote');
        src text := public.dose_norm(concat_ws(' ', lab->>'dosage', lab->>'pediatric', lab->>'indications'));
        qn numeric[]; u text := coalesce(e->>'unit', 'mg');
begin
  if q = '' then return 'ไม่มีข้อความอ้างอิงจากฉลาก'; end if;
  if src = '' then return 'ไม่มีข้อความฉลากให้เทียบ'; end if;
  if position(q in src) = 0 then return 'ข้อความที่ AI อ้างไม่พบในฉลากยา'; end if;
  if q !~ '(/kg|per kg)' then return 'ข้อความที่อ้างไม่ใช่ขนาดยาต่อน้ำหนักตัว (ต่อ กก.)'; end if;
  qn := public.dose_nums(q);
  if jsonb_typeof(e->'min') <> 'number' or jsonb_typeof(e->'max') <> 'number'
     or not ((e->>'min')::numeric = any(qn)) or not ((e->>'max')::numeric = any(qn)) then
    return 'ตัวเลขขนาดยาไม่ตรงกับข้อความในฉลาก';
  end if;
  if (e->>'max')::numeric * (case when u = 'mcg' then 0.001 else 1 end) > public.dose_soft_max() then
    return 'ขนาดยาสูงผิดปกติ (เกิน ' || public.dose_soft_max() || ' มก./กก.) · ตรวจหน่วยและจุดทศนิยมในฉลากแล้วกรอกเอง';
  end if;
  if u = 'mcg' and q !~ 'mcg(/| per )kg' then return 'AI ระบุหน่วย mcg แต่ฉลากไม่ใช่ mcg/กก.'; end if;
  if u <> 'mcg' and q !~ '(^|[^c])mg(/| per )kg' then
    return case when q ~ 'mcg(/| per )kg' then 'ฉลากเป็น mcg/กก. แต่ AI ระบุเป็น มก./กก.' else 'หน่วยในฉลากไม่ใช่ มก./กก.' end;
  end if;
  if coalesce(jsonb_typeof(e->'cap'), 'null') <> 'null'
     and not (jsonb_typeof(e->'cap') = 'number' and (e->>'cap')::numeric = any(public.dose_nums(src))) then
    return 'ขนาดสูงสุดต่อครั้งที่ AI ระบุไม่พบในฉลาก';
  end if;
  return null;
end $$;
grant execute on function public.dose_ai_item_problem(jsonb, jsonb) to authenticated;

select 'ok' as step_78_dose_plausible, public.dose_soft_max() as soft_max_mg_per_kg;
