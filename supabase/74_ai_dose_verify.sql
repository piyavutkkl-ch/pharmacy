-- =====================================================================
--  ขั้นที่ 74: ตรวจคำตอบ AI ร่างขนาดยากับข้อความฉลากจริง (audit F-05) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ทุกข้อที่ AI ตอบ (ai_dose_drafts.result.ai) ต้องผ่าน:
--     ① quote (ข้อความที่ AI อ้าง) อยู่ในข้อความฉลากที่ส่งให้ AI จริง (ปรับตัวพิมพ์/เว้นวรรค/เครื่องหมายแล้ว)
--     ② quote เป็นขนาดยาต่อน้ำหนักตัว (/kg) ③ ตัวเลข min/max อยู่ใน quote ④ หน่วย (มก./mcg) ตรงกับ quote
--     ⑤ เพดานต่อครั้ง (cap) ถ้ามี ต้องพบตัวเลขนั้นในฉลาก
--   ไม่ผ่าน → ย้ายไป result.ai_rejected พร้อมเหตุผล (ไม่ถูกนำไปสร้างร่าง · ผู้ดูแลเห็นเหตุผลในหน้าช่วยกรอก) + บอกใน note
--   ทำด้วย trigger บน ai_dose_drafts จึงครอบคลุมทั้งปุ่มช่วยกรอก (ai_dose_step) และงานอัตโนมัติ (ai_auto_tick → ai_dose_convert)
-- =====================================================================

/** ข้อความสำหรับเทียบ: ตัวเล็ก · µg/microgram → mcg · milligram → mg · kilogram → kg · 1,000 → 1000 · เครื่องหมายอื่นเป็นช่องว่าง */
create or replace function public.dose_norm(t text)
returns text language sql immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(t, '')),
    '(µ|μ)g\M|micrograms?', 'mcg', 'g'),
    'milligrams?', 'mg', 'g'),
    'kilograms?', 'kg', 'g'),
    '(\d),(\d{3})', '\1\2', 'g'),
    '[^a-z0-9./]+', ' ', 'g'),
    '\s*/\s*', '/', 'g'))
$$;

/** ตัวเลขทั้งหมดในข้อความ (หลังปรับแล้ว) */
create or replace function public.dose_nums(t text)
returns numeric[] language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(m[1]::numeric), '{}') from regexp_matches(coalesce(t, ''), '(\d+(?:\.\d+)?)', 'g') m
$$;

/** ข้อที่ AI ตอบ เทียบกับฉลาก → null = ผ่าน · ข้อความ = เหตุผลที่ไม่ใช้ */
create or replace function public.dose_ai_item_problem(e jsonb, lab jsonb)
returns text language plpgsql immutable
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
grant execute on function public.dose_norm(text), public.dose_nums(text), public.dose_ai_item_problem(jsonb, jsonb) to authenticated;

create or replace function public.before_ai_dose_verify()
returns trigger language plpgsql
set search_path = ''
as $$
declare ok jsonb := '[]'; bad jsonb := '[]'; e jsonb; why text;
begin
  if jsonb_typeof(new.result->'ai') is distinct from 'array' then return new; end if;
  if tg_op = 'UPDATE' and (new.result->'ai') is not distinct from (old.result->'ai') then return new; end if;
  for e in select x from jsonb_array_elements(new.result->'ai') x loop
    why := public.dose_ai_item_problem(e, new.result->'label');
    if why is null then ok := ok || jsonb_build_array(e);
    else bad := bad || jsonb_build_array(e || jsonb_build_object('why', why)); end if;
  end loop;
  new.result := new.result || jsonb_build_object('ai', ok, 'ai_rejected', bad);
  if jsonb_array_length(bad) > 0 then
    new.note := left(concat_ws(' · ', nullif(new.note, ''), 'ไม่ใช้ข้อที่ AI ตอบแต่ตรวจกับฉลากไม่ผ่าน ' || jsonb_array_length(bad) || ' ข้อ'), 500);
  end if;
  return new;
end $$;
drop trigger if exists ai_dose_verify on public.ai_dose_drafts;
create trigger ai_dose_verify before insert or update of result on public.ai_dose_drafts
  for each row execute function public.before_ai_dose_verify();

select 'ok' as step_74_ai_dose_verify;
