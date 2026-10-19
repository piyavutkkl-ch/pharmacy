-- =====================================================================
--  ขั้นที่ 77: ค้นฉลาก openFDA สำหรับ AI ร่างขนาดยา เฉพาะยารับประทาน + ฉบับใหม่สุดก่อน (audit F-11) · รันซ้ำได้ · ไม่ลบข้อมูล
--   เดิม limit 1 ไม่กรองช่องทางให้ยา → อาจได้ฉลากยาฉีด/ยาทาของสารเดียวกันมาร่างขนาดยารับประทาน
--   ใหม่: openfda.route:"ORAL" + เรียง effective_time ใหม่สุดก่อน · ไม่พบฉลากยารับประทาน = ไม่ร่าง (เดิมก็บอกให้กรอกเอง)
-- =====================================================================

create or replace function public.ai_dose_fda(p_q text, p_exact boolean)
returns bigint language sql security definer
set search_path = ''
as $$
  select net.http_get('https://api.fda.gov/drug/label.json',
    params := jsonb_build_object(
      'search', (case when p_exact then 'openfda.generic_name.exact:"' || upper(p_q) || '"' else 'openfda.generic_name:"' || p_q || '"' end)
                || ' AND openfda.route:"ORAL"',
      'sort', 'effective_time:desc',
      'limit', '1'),
    timeout_milliseconds := 20000)
$$;
revoke execute on function public.ai_dose_fda(text, boolean) from public, anon, authenticated;

select 'ok' as step_77_ai_dose_fda_oral;
