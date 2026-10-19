-- =====================================================================
--  ขั้นที่ 80: ติดธงฉลากยาเก่าในงาน AI ร่างขนาดยา (audit F-17) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ฉลาก openFDA ฉบับ (effective_time) เก่ากว่า N ปี → result.label_old = true + บอกใน note (ไม่ตัดทิ้ง ให้ผู้ดูแลตรวจกับฉบับปัจจุบัน)
--   N ค่าเริ่ม 10 ปี · site_texts 'dose_label_max_age_years' ให้เภสัชกรปรับได้
-- =====================================================================

create or replace function public.dose_label_max_age()
returns int language sql stable
set search_path = ''
as $$
  select coalesce((select btrim(t.body)::int from public.site_texts t where t.key = 'dose_label_max_age_years' and btrim(t.body) ~ '^\d{1,3}$'), 10)
$$;
grant execute on function public.dose_label_max_age() to anon, authenticated;

create or replace function public.before_ai_dose_label_age()
returns trigger language plpgsql
set search_path = ''
as $$
declare eff text := new.result #>> '{label,effective}'; d date; yrs int := public.dose_label_max_age();
begin
  if eff is null or eff !~ '^\d{8}$' then return new; end if;
  if tg_op = 'UPDATE' and (new.result -> 'label') is not distinct from (old.result -> 'label') then return new; end if;
  begin d := to_date(eff, 'YYYYMMDD'); exception when others then return new; end;
  if d < (current_date - make_interval(years => yrs)) then
    new.result := new.result || jsonb_build_object('label_old', true);
    new.note := left(concat_ws(' · ', nullif(new.note, ''), 'ฉลากยาฉบับ ' || to_char(d, 'DD/MM/YYYY') || ' เก่ากว่า ' || yrs || ' ปี ตรวจกับฉบับปัจจุบันก่อนใช้'), 500);
  end if;
  return new;
end $$;
drop trigger if exists ai_dose_label_age on public.ai_dose_drafts;
create trigger ai_dose_label_age before insert or update of result on public.ai_dose_drafts
  for each row execute function public.before_ai_dose_label_age();

select 'ok' as step_80_ai_dose_label_age, public.dose_label_max_age() as max_age_years;
