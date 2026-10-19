-- =====================================================================
--  ขั้นที่ 76: ข้อบ่งใช้มีช่วงอายุ + ขนาดสูงสุดต่อวัน (audit F-09) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   indications[] เพิ่มช่องได้ (ไม่บังคับ): age_min / age_max (ปี) · cap_day (ขนาดสูงสุดต่อวัน หน่วยเดียวกับขนาดยา)
--   หน้าคำนวณ: อายุนอกช่วง = ไม่แสดงขนาดยาของข้อบ่งใช้นั้น · ต่อวันเกิน cap_day = จำกัด · ไม่มีเพดานเลย = เตือน
--   dose_inds_problem() ตรวจช่องใหม่ด้วย (73_dose_approval.sql ใช้ฟังก์ชันนี้ตอนยาจะแสดง · 75 ใช้ติดธงร่าง)
-- =====================================================================

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

select 'ok' as step_76_dose_inds_age;
