-- =====================================================================
--  ขั้นที่ 75: ติดธงร่าง AI ที่ข้อมูลขนาดยาไม่ครบ (audit F-07) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   dose_drugs.draft_issue = เหตุผลที่ร่างยังใช้ไม่ได้ (เช่น ขนาดต่อวันแต่ไม่บอกจำนวนครั้ง) · ระบบใส่เองทุกครั้งที่บันทึกร่าง
--   ไม่ใช่ร่างแล้ว (อนุมัติ) = null · ร่างที่มีธงอนุมัติไม่ได้อยู่แล้ว (73_dose_approval.sql) → ธงนี้บอกผู้ดูแลล่วงหน้าว่าต้องแก้อะไร
-- =====================================================================

alter table public.dose_drugs add column if not exists draft_issue text;

create or replace function public.before_dose_draft_issue()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.draft_issue := case when new.ai_draft then public.dose_inds_problem(new.indications) end;
  return new;
end $$;
drop trigger if exists dose_drugs_draft_issue on public.dose_drugs;
create trigger dose_drugs_draft_issue before insert or update on public.dose_drugs
  for each row execute function public.before_dose_draft_issue();

-- ร่างเดิมที่มีอยู่แล้ว: คำนวณธงครั้งแรก
update public.dose_drugs set draft_issue = public.dose_inds_problem(indications)
 where ai_draft and draft_issue is distinct from public.dose_inds_problem(indications);

select 'ok' as step_75_dose_draft_issue, (select count(*) from public.dose_drugs where draft_issue is not null) as drafts_need_fix;
