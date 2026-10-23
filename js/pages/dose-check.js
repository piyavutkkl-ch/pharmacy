// ตรวจข้อมูลขนาดยาทุกตัวในครั้งเดียว (ศูนย์ข้อมูลยา › ภาพรวม · ปุ่ม #dcCheckBtn · เจ้าของเว็บ 22 ต.ค.)
//   ① ตรวจทันที (ไม่ใช้ AI): testDose + กฎความปลอดภัย dose-rules.js ของข้อมูลคำนวณทุกชุด → ไม่ผ่าน / ควรตรวจ / รออนุมัติ / ครบแล้ว
//   ปุ่มเดียว "ตรวจ + ให้ AI เติมข้อมูลที่ขาด": ตรวจเสร็จ → ถามยืนยัน → AI หาค่าทุกข้อที่ไม่ผ่านต่อเลย (ยกเลิก = ดูผลตรวจอย่างเดียว · กดเติมทีหลังได้)
//   ② AI เติมข้อมูล: ทีละข้อ · ยาที่ผูกฉลาก OpenFDA = ตรวจกับฉลากก่อน (87/90) · ไม่มีฉลาก/ฉลากไม่พอ = ค้นจากเว็บพร้อมลิงก์ (90 ai_dose_web_start)
//      ผลเก็บในฐานข้อมูล (ai_dose_fixes) → เปิดยาในหน้าโปรไฟล์ยา = ค่าถูกเติมลงการ์ดให้เลย (loadSavedFixes · ยังไม่บันทึก) · ผู้ดูแลเปิดลิงก์ตรวจ แล้วกดตรวจ/อนุมัติเอง
//      ไม่บันทึกลงข้อมูลคำนวณเอง เพราะการแก้ข้อบ่งใช้ของยาที่แสดงอยู่ = อนุมัติ (90) → ต้องเป็นเภสัชกรกดเท่านั้น
//   ไม่ส่งข้อความ MIMS ให้ AI · จำกัด 60 ครั้ง/วัน/ผู้ดูแล (ฐานข้อมูลกำหนด) → ครบแล้วหยุดพร้อมบอกเหตุผล
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { indsOf } from './dose.js?v=4.4';
import { testDose } from './dose-test.js?v=4.4';
import { flagHides, flagOpen, FLAG_LEVEL } from './dose-rules.js?v=4.4';

const IND_RE = /^ข้อบ่งใช้ (\d+)(?: \([^)]*\))?(?: · [^:]*)?: /;
let report = null, running = false, stop = false;

/** ตรวจข้อมูลคำนวณทุกชุดจากแถวของศูนย์ข้อมูลยา ([{ l, j }]) → รายการต่อข้อมูลคำนวณ 1 ชุด */
export function checkAll(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const d = r.j?.dose?.dose; if (!d) continue;
    if (!by.has(d.id)) by.set(d.id, { d, ls: [] });
    by.get(d.id).ls.push(r.l);
  }
  return [...by.values()].map(({ d, ls }) => {
    const inds = indsOf(d), t = testDose(d, ls), per = new Map();
    for (const x of t.issues) {
      const m = IND_RE.exec(x.text), k = m ? +m[1] - 1 : -1, txt = x.text.replace(IND_RE, '');
      if (!per.has(k)) per.set(k, { fails: [], warns: [] });
      per.get(k)[x.sev === 'fail' ? 'fails' : 'warns'].push(txt);
    }
    for (const f of Array.isArray(d.audit_flags) ? d.audit_flags : []) {   // AI ตรวจย้อนหลัง (91): ขัดกับฉลาก = ไม่ผ่าน · สงสัย = ควรตรวจ
      const k = inds.findIndex((i) => i.name === f.name), txt = `AI ตรวจย้อนหลัง${f.level === 'wrong' ? 'พบตัวเลขขัดกับฉลาก' : 'สงสัย'}: ${f.why}`;
      if (!per.has(k)) per.set(k, { fails: [], warns: [] });
      per.get(k)[f.level === 'wrong' ? 'fails' : 'warns'].push(txt);
      t.issues.push({ sev: f.level === 'wrong' ? 'fail' : 'warn', text: `${f.name}: ${txt}` });
    }
    if (t.issues.some((x) => x.sev === 'fail')) t.status = 'fail'; else if (t.issues.length && t.status === 'pass') t.status = 'warn';
    const bad = inds.map((ind, k) => ({ k, ind, ...(per.get(k) || { fails: [], warns: [] }) })).filter((x) => x.fails.length);
    const wait = d.ai_draft ? 'ร่าง รอตรวจ' : !d.active ? 'ซ่อนอยู่' : !d.approved_at ? 'รอเภสัชกรอนุมัติ' : '';
    const status = t.status === 'fail' ? 'fail' : t.status === 'warn' ? 'warn' : wait ? 'wait' : 'ok';
    const main = ls.find((l) => l.fda_key) || ls[0];
    return { d, ls, main, status, wait, bad, fails: t.issues.filter((x) => x.sev === 'fail').map((x) => x.text), warns: t.issues.filter((x) => x.sev === 'warn').map((x) => x.text), ai: {} };
  }).sort((a, b) => ['fail', 'warn', 'wait', 'ok'].indexOf(a.status) - ['fail', 'warn', 'wait', 'ok'].indexOf(b.status) || String(a.d.name).localeCompare(String(b.d.name), 'th'));
}

/** ส่งข้อบ่งใช้ 1 ข้อให้ AI (label = ฉลาก OpenFDA · web = ค้นจากเว็บพร้อมลิงก์) แล้วรอผล → { result, note } */
export async function aiFix(localId, ind, issues, mode) {
  const { ref: _ref, checked: _c, ...clean } = ind || {};
  const { data: id, error } = await sb.rpc(mode === 'web' ? 'ai_dose_web_start' : 'ai_dose_fix_start', { p_local: localId, p_ind: clean, p_issues: (issues || []).slice(0, 12) });
  if (error) throw error;
  for (let n = 0; n < 70; n++) {
    await new Promise((ok) => setTimeout(ok, n ? 3000 : 1200));
    const { data, error: e2 } = await sb.rpc('ai_dose_fix_poll', { p_id: id });
    if (e2) throw e2;
    if (data.status !== 'pending') return { id, mode, result: data.result, note: data.note };
  }
  return { id, mode, result: null, note: 'หมดเวลารอ AI' };
}
/** ใช้ได้ครบไหม: มีค่าที่เสนอ ไม่ถูกปฏิเสธ และไม่มีกฎที่ยังขาด */
export const aiGood = (r) => !!r?.result?.ind && !r.result.left;

/** AI ช่วยข้อนี้: ฉลากก่อน (ถ้ามี) → ไม่พอ = ค้นจากเว็บ */
async function aiOne(it, b) {
  const issues = [...b.fails, ...b.warns];
  let r = null;
  if (it.main?.fda_key) r = await aiFix(it.main.id, b.ind, issues, 'label');
  if (!aiGood(r)) { const w = await aiFix(it.main.id, b.ind, issues, 'web'); if (w.result?.ind || !r?.result?.ind) r = w; }
  return r;
}

function summary(list) {
  const n = (s) => list.filter((x) => x.status === s).length;
  return { fail: n('fail'), warn: n('warn'), wait: n('wait'), ok: n('ok'), bad: list.reduce((a, x) => a + x.bad.length, 0) };
}
const TAG = { fail: ['dc-err', 'ไม่ผ่าน'], warn: ['dc-warn', 'ควรตรวจ'], wait: ['dc-warn', 'รออนุมัติ'], ok: ['dc-ok', 'ครบแล้ว'] };
function rowHtml(it) {
  const [cls, word] = TAG[it.status], l = it.main;
  const done = Object.values(it.ai).filter((r) => r?.result?.ind).length, tried = Object.keys(it.ai).length;
  const aiTxt = it.ai.busy ? '<span class="dw-tag t-ai" data-ck-busy>AI กำลังหาค่า…</span>'
    : tried ? `<span class="dw-tag t-ai" data-ck-ai="${it.d.id}">AI เติมแล้ว ${done}/${it.bad.length} ข้อ · เปิดตรวจและอนุมัติ</span>` : '';
  const iss = [...it.fails, ...(it.status === 'warn' ? it.warns : [])].slice(0, 3);
  return `<li class="ck-row" data-ck-row="${it.d.id}"><div class="ck-h"><span class="${cls} ck-tag">${word}</span><b>${esc(it.d.web_code ? `${it.d.web_code} ` : '')}${esc(it.d.name)}</b>`
    + `<span class="small muted">${esc(it.ls.map((x) => x.name).slice(0, 2).join(', '))}${it.ls.length > 2 ? ' …' : ''}${it.wait ? ` · ${esc(it.wait)}` : ''}</span>${aiTxt}</div>`
    + (iss.length ? `<ul class="small">${iss.map((x) => `<li>${esc(x)}</li>`).join('')}${it.fails.length + it.warns.length > iss.length ? `<li class="muted">และอีก ${it.fails.length + it.warns.length - iss.length} ข้อ</li>` : ''}</ul>` : '')
    + (l ? `<button type="button" class="btn btn-o btn-sm" data-ck-open="${esc(l.id)}">แก้ในหน้าโปรไฟล์ยา ›</button>` : '') + '</li>';
}
function render() {
  const box = $('#dcCheck'); if (!box || !report) return;
  const s = summary(report.list), todo = report.list.filter((x) => x.status !== 'ok');
  box.hidden = false;
  box.innerHTML = `<div class="ck-top"><b>ผลตรวจข้อมูลขนาดยา ${report.list.length} ชุด</b><span class="small muted">ตรวจเมื่อ ${esc(report.at)} · ทดสอบสูตร + กฎความปลอดภัย (ไม่ใช้ AI)</span>`
    + '<button type="button" class="btn btn-o btn-sm" data-ck-close>ปิด</button></div>'
    + `<div class="ck-sum"><span class="dc-err">ไม่ผ่าน ${s.fail}</span><span class="dc-warn">ควรตรวจ ${s.warn}</span><span class="dc-warn">รออนุมัติ ${s.wait}</span><span class="dc-ok">ครบแล้ว ${s.ok}</span></div>`
    + (s.bad ? `<div class="row-btns">${running ? `<button type="button" class="btn btn-o btn-sm" data-ck-stop>หยุด</button><span class="small" data-ck-prog aria-live="polite">${esc(report.prog || '')}</span>`
      : `<button type="button" class="btn btn-p btn-sm" data-ck-ai-all>ให้ AI เติมข้อมูลทุกข้อที่ไม่ผ่าน (${s.bad} ข้อ)</button>`}<span class="small muted">ใช้ฉลาก OpenFDA ก่อน ไม่พอ = ค้นจากเว็บพร้อมลิงก์ · เปิดยาแต่ละตัว = ค่าถูกเติมในการ์ดแล้ว ตรวจตามลิงก์แล้วกดอนุมัติ</span></div>` : '')
    + (report.msg ? `<p class="small dc-warn" data-ck-msg>${esc(report.msg)}</p>` : '')
    + (todo.length ? `<ul class="ck-list">${todo.map(rowHtml).join('')}</ul>` : '<p class="empty" data-ck-allok>ข้อมูลขนาดยาทุกชุดครบตามเงื่อนไขและอนุมัติแล้ว</p>');
}
/** ปุ่ม "ตรวจ + ให้ AI เติมข้อมูลที่ขาด" (rows = แถวของศูนย์ข้อมูลยา) · fill = ถามแล้วให้ AI เติมต่อเลย */
export function runCheck(rows, { fill = true } = {}) {
  if (running) return;
  report = { list: checkAll(rows), at: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), msg: '' };
  render();
  $('#dcCheck')?.scrollIntoView({ block: 'nearest' });
  if (fill && report.list.some((x) => x.bad.length)) aiAll($('#dcCheck [data-ck-ai-all]'));
}
async function aiAll(btn) {
  if (running || !report) return;
  const jobs = report.list.flatMap((it) => it.bad.map((b) => ({ it, b })));
  if (!jobs.length) return;
  if (!confirm(`ตรวจแล้ว: ไม่ผ่าน ${jobs.length} ข้อบ่งใช้ · ให้ AI เติมข้อมูลที่ขาดเลยไหม?\n(ทีละข้อ ข้อละประมาณครึ่งนาที · AI ใช้ได้ 60 ครั้งต่อวัน · ยังไม่บันทึก/ไม่แสดงต่อประชาชนจนกว่าจะตรวจและอนุมัติ)`)) return;
  running = true; stop = false; report.msg = ''; busy(btn, true, 'กำลังเริ่ม…'); render();
  let n = 0;
  try {
    for (const { it, b } of jobs) {
      if (stop) { report.msg = `หยุดแล้ว · ทำไป ${n} จาก ${jobs.length} ข้อ`; break; }
      n++; report.prog = `กำลังหาค่า ${n}/${jobs.length}: ${it.d.name} · ${b.ind.name || `ข้อ ${b.k + 1}`}`; it.ai.busy = true; render();
      try { it.ai[b.k] = await aiOne(it, b); }
      catch (err) { delete it.ai.busy; report.msg = `หยุดที่ ${it.d.name}: ${errText(err)}`; render(); break; }
      delete it.ai.busy; render();
    }
    if (!report.msg) report.msg = `AI ทำครบ ${n} ข้อแล้ว · กด "แก้ในหน้าโปรไฟล์ยา" = ค่าถูกเติมในการ์ดแล้ว เปิดลิงก์ตรวจตัวเลข แล้วกดตรวจและอนุมัติ`;
    toast('AI เติมข้อมูลเสร็จแล้ว · เปิดยาแต่ละตัวเพื่อตรวจและอนุมัติ');
  } finally { running = false; report.prog = ''; render(); }
}
/** กล่องแจ้งเตือน "AI ตรวจย้อนหลังพบ" ในภาพรวม (#dcAudit) — ขัดกับฉลาก (หยุดแสดงแล้ว) / สงสัย (ยังแสดง) */
export function renderAudit(rows) {
  const box = $('#dcAudit'); if (!box) return;
  const seen = new Set(), list = [];
  for (const r of rows || []) {
    const d = r.j?.dose?.dose, fl = (Array.isArray(d?.audit_flags) ? d.audit_flags : []).filter(flagOpen);   // ตัดสินแล้วว่าไม่ขัด = ไม่ต้องทำอะไร
    if (!d || !fl.length || seen.has(d.id)) continue;
    seen.add(d.id); list.push({ d, l: r.l, fl });
  }
  box.hidden = !list.length;
  if (!list.length) { box.innerHTML = ''; return; }
  const cnt = (fn) => list.reduce((a, x) => a + x.fl.filter(fn).length, 0);
  const nw = cnt(flagHides), no = cnt((f) => !flagHides(f) && f.level === 'offlabel'), nd = cnt((f) => !flagHides(f) && f.level !== 'offlabel');
  box.innerHTML = `<div class="ck-top"><b>AI ตรวจย้อนหลังพบข้อมูลขนาดยาที่ควรตรวจ</b><span class="small muted">เทียบยาที่อนุมัติแล้วกับฉลาก OpenFDA+DailyMed ทุกคืน · AI เสนอ เภสัชกรตัดสิน · ตัดสินแล้วไม่ถูกธงซ้ำจนกว่าตัวเลขจะเปลี่ยน</span></div>`
    + `<div class="ck-sum">${nw ? `<span class="dc-err">ตัวเลขขัดกับฉลาก ${nw} ข้อ · หยุดแสดงตัวเลขแล้ว</span>` : ''}${no ? `<span class="dc-warn">นอกฉลาก ${no} ข้อ · ยังแสดงอยู่ รอตัดสิน</span>` : ''}${nd ? `<span class="dc-warn">สงสัย ${nd} ข้อ · ยังแสดงอยู่</span>` : ''}</div>`
    + `<ul class="ck-list">${list.map(({ d, l, fl }) => `<li class="ck-row" data-audit-row="${d.id}"><div class="ck-h"><b>${esc(d.web_code ? `${d.web_code} ` : '')}${esc(d.name)}</b></div>`
      + `<ul class="small">${fl.map((f) => `<li><span class="${flagHides(f) ? 'dc-err' : 'dc-warn'}">${f.decision === 'conflict' ? 'เภสัชกรยืนยันว่าขัด · รอแก้' : FLAG_LEVEL[f.level] || 'สงสัย'}</span> ${esc(f.name)}: ${esc(f.why || '')}</li>`).join('')}</ul>`
      + `<button type="button" class="btn btn-o btn-sm" data-ck-open="${esc(l.id)}">ตัดสินในหน้าโปรไฟล์ยา ›</button></li>`).join('')}</ul>`;
}
let bound = false;
/** ผูกปุ่มในกล่องผลตรวจ (เรียกครั้งเดียว) */
export function bindCheck() {
  if (bound || !$('#dcCheck')) return; bound = true;
  $('#dcAudit')?.addEventListener('click', (e) => { const b = e.target.closest('[data-ck-open]'); if (!b) return;
    try { sessionStorage.setItem('pcps_work_focus', `${b.dataset.ckOpen}:dose`); } catch { /* ไม่เป็นไร */ }
    location.hash = '#/admin/drugs/work'; });
  $('#dcCheck').addEventListener('click', (e) => {
    const B = (s) => e.target.closest(s); let b;
    if (B('[data-ck-close]')) { if (running) stop = true; $('#dcCheck').hidden = true; return; }
    if (B('[data-ck-stop]')) { stop = true; report.msg = 'กำลังหยุดหลังข้อที่ทำอยู่…'; render(); return; }
    if ((b = B('[data-ck-ai-all]'))) { aiAll(b); return; }
    if ((b = B('[data-ck-open]'))) {
      try { sessionStorage.setItem('pcps_work_focus', `${b.dataset.ckOpen}:dose`); } catch { /* ไม่เป็นไร */ }
      location.hash = '#/admin/drugs/work';
    }
  });
}

/** ค่าที่ AI เสนอไว้แล้ว (ai_dose_fixes · 14 วัน) ของยาเหล่านี้ → Map(ชื่อข้อบ่งใช้ → ผลล่าสุดที่ใช้ได้) · หน้าโปรไฟล์ยาใส่ในการ์ดให้ */
export async function loadSavedFixes(localIds) {
  const ids = [...new Set((localIds || []).filter((x) => x != null))];
  if (!ids.length) return new Map();
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data, error } = await sb.from('ai_dose_fixes').select('id,local_id,ind,mode,status,result,note,created_at').in('local_id', ids).eq('status', 'done').gte('created_at', since).order('id', { ascending: false });
  if (error) return new Map();
  const m = new Map();
  for (const r of data || []) {
    const name = String(r.ind?.name || '').trim(); if (!name || !r.result?.ind) continue;
    const prev = m.get(name);
    if (!prev || (!aiGood(prev) && aiGood(r))) m.set(name, r);   // ล่าสุดก่อน · ผลที่ครบชนะผลที่ยังขาด
  }
  return m;
}
