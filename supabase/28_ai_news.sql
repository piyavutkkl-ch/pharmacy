-- =====================================================================
--  ขั้นที่ 27: ช่อง AI — สร้างข่าวจากบทความวิชาการ CCPE (สภาเภสัชกรรม) วันละ 1 ข่าว — รันต่อจาก 27 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   งานจริงทำใน GitHub Actions (.github/workflows/ai-news.yml → tools/ai_news/run.mjs) ด้วย SUPABASE_SECRET_KEY + GEMINI_API_KEY
--   ข่าวจาก AI: ai_generated = true · ภาพประกอบเพิ่มเติมใน gallery · อ้างอิงบทความต้นฉบับ source_url/source_title (ไม่แนบ PDF)
--   ค่าตั้ง (site_texts, ผู้ดูแลแก้ได้): ai_news_auto = on|off (เผยแพร่ทันที / รอผู้ดูแลตรวจ) · ai_news_request = เวลาที่กด "สร้างข่าวตอนนี้"
--   ai_news_log: บทความที่ทำไปแล้ว (กันทำซ้ำ) + ผลแต่ละรอบ — ผู้ดูแลอ่านได้ · เขียนได้เฉพาะระบบ (secret key)
-- =====================================================================

alter table public.news add column if not exists ai_generated boolean not null default false;
alter table public.news add column if not exists source_url text;
alter table public.news add column if not exists source_title text;
alter table public.news add column if not exists gallery text[] not null default '{}';
alter table public.news drop constraint if exists news_source_check;
alter table public.news add constraint news_source_check
  check ((source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 500))
     and (source_title is null or char_length(source_title) <= 300)
     and cardinality(gallery) <= 6);

create table if not exists public.ai_news_log (
  id          bigint generated always as identity primary key,
  article_id  int,                                   -- id บทความใน CCPE (null = รอบที่ไม่ได้ทำบทความ เช่น ยังไม่มีบทความใหม่)
  title       text,
  news_id     uuid references public.news(id) on delete set null,
  status      text not null check (status in ('done', 'skipped', 'error')),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now()
);
create unique index if not exists ai_news_log_article_done on public.ai_news_log (article_id) where status in ('done', 'skipped');
create index if not exists ai_news_log_recent on public.ai_news_log (created_at desc);

alter table public.ai_news_log enable row level security;
drop policy if exists ailog_read on public.ai_news_log;
create policy ailog_read on public.ai_news_log for select to authenticated using (public.is_admin());
revoke all on public.ai_news_log from anon, authenticated;
grant select on public.ai_news_log to authenticated;
grant all on public.ai_news_log to service_role;

insert into public.site_texts (key, body) values ('ai_news_auto', 'off'), ('ai_news_request', '')
on conflict (key) do nothing;

select 'ok' as step_27_ai_news;
