#!/usr/bin/env python3
"""สร้าง "หน้าตัวอย่าง" ของเว็บ สำหรับเจ้าของเว็บดูและ comment ได้ทุกอุปกรณ์ (Claude Artifact / หน้าตัวอย่างในเครื่อง)

ใช้:  python3 tools/preview/build.py [โฟลเดอร์ปลายทาง]      (ค่าเริ่มต้น _preview/ — อยู่ใน .gitignore)
ได้:  index.html   หน้าหลักสำหรับ publish (ไม่มี <html>/<head>/<body> — ระบบ Artifact ครอบให้เอง)
      local.html   หน้าเดียวกันแบบเต็ม ไว้เปิดทดสอบในเครื่อง (tests/ui/smoke.js / tools/preview/serve.py)
      assets/ js/ fixtures.json   ไฟล์ประกอบ (publish ผ่าน files)

ความปลอดภัย / PDPA:
- ใช้ Supabase จำลอง (tests/ui/mock_supabase.js) + ข้อมูลสมมติ (tests/ui/fixtures.json) เท่านั้น ไม่แตะข้อมูลจริง
- เปลี่ยนชื่อโรงพยาบาล อำเภอ จังหวัด รพ.สต. และเบอร์โทรจริงเป็นชื่อสมมติ แล้วตรวจซ้ำว่าไม่หลุด
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "_preview"

# ชื่อจริง → ชื่อสมมติ (ยาวก่อนสั้น)
NAMES = [
    ("โรงพยาบาลควนกาหลง", "โรงพยาบาลตัวอย่าง"), ("ควนกาหลง", "ตัวอย่าง"),
    ("จังหวัดสตูล", "จังหวัดตัวอย่าง"), ("จ.สตูล", "จ.ตัวอย่าง"), ("สตูล", "ตัวอย่าง"),
    ("074-752-081", "0xx-xxx-xxx"),
]
UNIT_ALIAS = "หน่วยที่ {}"            # รพ.สต. จริงทุกแห่ง → "หน่วยที่ 1…7"
FORBIDDEN = re.compile(r"ควนกาหลง|สตูล|074-752-081")

ROLE_BAR = """<title>ตัวอย่างเว็บเภสัชปฐมภูมิ</title>
<style>
.pv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 16px;background:var(--sunken);border-bottom:1px solid var(--line);color:var(--ink);font:500 13px/1.4 'IBM Plex Sans Thai','IBM Plex Sans',system-ui,sans-serif;position:sticky;top:0;z-index:9990}
.pv-bar b{font-weight:700;color:var(--primary)}
.pv-bar .pv-roles,.pv-bar .pv-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pv-bar .pv-tools{margin-left:auto}
.pv-bar button{appearance:none;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;cursor:pointer}
.pv-bar button[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.pv-bar button.pv-pick-btn[aria-pressed="true"]{background:#d97706;border-color:#d97706;color:#fff}
.pv-bar button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.pv-bar code{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}
.pv-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:700;margin-left:4px}
body.pv-picking,body.pv-picking *{cursor:crosshair!important}
.pv-hover-box,.pv-drag-box{position:fixed;pointer-events:none;z-index:9995;border:2px dashed #d97706;background:rgba(217,119,6,.12);border-radius:6px;display:none}
.pv-drag-box{border-style:solid;background:rgba(217,119,6,.18)}
.pv-pin{position:absolute;z-index:9985;width:26px;height:26px;border-radius:999px;background:#d97706;color:#fff;font:700 12px/26px system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.28);cursor:pointer;border:2px solid #fff;transform:translate(-50%,-50%)}
.pv-pin[data-done="true"]{background:#16a34a}
.pv-drawer{position:fixed;right:12px;bottom:12px;width:min(380px,calc(100vw - 24px));max-height:min(78vh,640px);display:flex;flex-direction:column;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.22);z-index:9998;font:400 13px/1.45 'IBM Plex Sans Thai','IBM Plex Sans',system-ui,sans-serif;overflow:hidden}
.pv-drawer[hidden]{display:none!important}
.pv-dh{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:var(--sunken);border-bottom:1px solid var(--line);font-weight:700}
.pv-dh-acts{display:flex;gap:6px;align-items:center}
.pv-dh button,.pv-df button,.pv-item-acts button{appearance:none;min-height:32px;padding:4px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:500 12px/1.3 inherit;cursor:pointer}
.pv-dh button.pv-pri,.pv-df button.pv-pri{background:var(--primary);border-color:var(--primary);color:var(--on-primary);font-weight:600}
.pv-db{padding:12px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.pv-form{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:var(--sunken);border:1px solid var(--line)}
.pv-target{font-size:12px;color:var(--muted);word-break:break-word}
.pv-target b{color:var(--ink)}
.pv-form textarea{width:100%;min-height:68px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;resize:vertical;box-sizing:border-box}
.pv-df{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pv-list{display:flex;flex-direction:column;gap:8px}
.pv-item{padding:9px 10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:4px}
.pv-item[data-done="true"]{opacity:.65}
.pv-item-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:var(--muted)}
.pv-item-num{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#d97706;color:#fff;font-weight:700;font-size:11px}
.pv-item[data-done="true"] .pv-item-num{background:#16a34a}
.pv-item-note{font-size:13px;color:var(--ink);white-space:pre-wrap;word-break:break-word}
.pv-item-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
.pv-status{font-size:12px;color:var(--muted)}
</style>
<div class="pv-bar" id="pvBar" role="region" aria-label="แถบหน้าตัวอย่าง">
  <span><b>หน้าตัวอย่าง</b> · ข้อมูลสมมติ ไม่กระทบเว็บจริง</span>
  <span class="pv-roles" role="group" aria-label="ดูในฐานะ">
    <button type="button" data-pv-role="">ผู้เยี่ยมชม</button>
    <button type="button" data-pv-role="citizen">ประชาชน</button>
    <button type="button" data-pv-role="staff">เจ้าหน้าที่ รพ.สต.</button>
    <button type="button" data-pv-role="admin">ผู้ดูแล</button>
  </span>
  <span>หน้า: <code id="pvRoute">#/</code></span>
  <span class="pv-tools">
    <button type="button" class="pv-pick-btn" id="pvPickBtn" aria-pressed="false" title="คลิกหรือลากครอบส่วนที่ต้องการสั่งแก้">✚ ครอบสั่งแก้</button>
    <button type="button" id="pvListBtn" aria-expanded="false">รายการแก้ <span class="pv-badge" id="pvCount">0</span></button>
  </span>
</div>
<div class="pv-hover-box" id="pvHoverBox"></div>
<div class="pv-drag-box" id="pvDragBox"></div>
<div id="pvPins"></div>
<aside class="pv-drawer" id="pvDrawer" hidden aria-label="รายการสั่งแก้ไข">
  <div class="pv-dh">
    <span>รายการครอบสั่งแก้ (<span id="pvCountHead">0</span>)</span>
    <div class="pv-dh-acts">
      <button type="button" id="pvCopyBtn" title="คัดลอกข้อความทั้งหมดส่งให้ AI">คัดลอก</button>
      <button type="button" id="pvClearBtn" title="ล้างรายการทั้งหมด">ล้าง</button>
      <button type="button" id="pvCloseBtn" aria-label="ปิด">✕</button>
    </div>
  </div>
  <div class="pv-db">
    <form class="pv-form" id="pvForm" hidden>
      <div class="pv-target" id="pvTargetInfo">จุดที่เลือก: <b>ทั้งหน้านี้</b></div>
      <textarea id="pvNote" placeholder="พิมพ์สิ่งที่ต้องการให้แก้ตรงนี้... (กด Ctrl+Enter เพื่อบันทึก)" required></textarea>
      <div class="pv-df">
        <button type="button" id="pvRepickBtn">ครอบจุดอื่น</button>
        <div style="display:flex;gap:6px">
          <button type="button" id="pvCancelBtn">ยกเลิก</button>
          <button type="submit" class="pv-pri" id="pvSaveBtn">บันทึก comment</button>
        </div>
      </div>
    </form>
    <div class="pv-status" id="pvStatus">กด "✚ ครอบสั่งแก้" แล้วคลิกหรือลากครอบบริเวณที่ต้องการแก้ไข</div>
    <div class="pv-list" id="pvList"></div>
  </div>
</aside>
<script>
(function () {
  var KEY = 'pv-role', CKEY = 'pv-comments', HOME = { '': '#/', citizen: '#/me', staff: '#/staff', admin: '#/admin' };
  function get() {
    try { var v = localStorage.getItem(KEY); if (v !== null) return v; } catch (e) {}
    var m = /(?:^|;)pv-role=([a-z0-9]*)/.exec(window.name || ''); return m ? m[1] : '';
  }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} window.name = 'pv-role=' + v; }
  window.__previewRole = function () { return get() || null; };
  // หน้าตัวอย่างแสดงกล่อง confirm/alert ไม่ได้ — ให้ยืนยันอัตโนมัติ (ข้อมูลสมมติ)
  window.confirm = function () { return true; };
  window.alert = function (m) { console.log(m); };
  var cur = get();
  [].forEach.call(document.querySelectorAll('[data-pv-role]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-pv-role') === cur));
    b.addEventListener('click', function () { var r = b.getAttribute('data-pv-role'); set(r); location.hash = HOME[r]; location.reload(); });
  });
  function show() {
    document.getElementById('pvRoute').textContent = location.hash || '#/';
    renderPins();
  }
  window.addEventListener('hashchange', show);

  /* ---------- ระบบครอบและเขียน comment สั่งแก้ไข ---------- */
  var comments = [], picking = false, target = null, dragStart = null;
  var pickBtn = document.getElementById('pvPickBtn'), listBtn = document.getElementById('pvListBtn');
  var hoverBox = document.getElementById('pvHoverBox'), dragBox = document.getElementById('pvDragBox');
  var drawer = document.getElementById('pvDrawer'), form = document.getElementById('pvForm');
  var noteEl = document.getElementById('pvNote'), targetInfo = document.getElementById('pvTargetInfo');
  var listEl = document.getElementById('pvList'), statusEl = document.getElementById('pvStatus');
  var pinsEl = document.getElementById('pvPins');

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }
  function isPvUi(el) {
    return !el || el.closest('#pvBar,#pvDrawer,#pvPins,#pvHoverBox,#pvDragBox');
  }
  function selectorOf(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    if (el.id) return '#' + el.id;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0 && a.value && a.value.length < 40) return el.tagName.toLowerCase() + '[' + a.name + '="' + a.value + '"]';
    }
    var cls = (typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '');
    var s = el.tagName.toLowerCase() + (cls ? '.' + cls : '');
    var p = el.parentElement;
    if (p && p.id) return '#' + p.id + ' > ' + s;
    return s;
  }
  function labelOf(el) {
    if (!el) return 'บริเวณที่ครอบ';
    var t = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.alt || '').trim().replace(/\\s+/g, ' ');
    var sel = selectorOf(el);
    return (t ? '"' + t.slice(0, 50) + (t.length > 50 ? '…' : '') + '" ' : '') + '(' + sel + ')';
  }
  function hasCommentApi() {
    try {
      if (/[?&]pvapi=1/.test(location.search)) localStorage.setItem('pv-api', '1');
      return /(?:^|;)pv-api=1/.test(window.name || '') || localStorage.getItem('pv-api') === '1';
    } catch (e) { return false; }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(CKEY);
      if (raw) comments = JSON.parse(raw) || [];
    } catch (e) {}
    if (hasCommentApi()) {
      fetch('/__comments').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (Array.isArray(d) && (d.length || !comments.length)) {
          comments = d;
          try { localStorage.setItem(CKEY, JSON.stringify(comments)); } catch (e) {}
          renderList();
        }
      }).catch(function () {});
    }
  }
  function syncSave(msg) {
    try { localStorage.setItem(CKEY, JSON.stringify(comments)); } catch (e) {}
    renderList();
    if (hasCommentApi()) {
      fetch('/__comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: comments })
      }).then(function (r) {
        statusEl.textContent = r.ok ? (msg || 'บันทึกแล้ว — สั่งในแชทว่า "แก้ตาม comment" ได้เลย') : 'บันทึกไว้ในเบราว์เซอร์แล้ว';
      }).catch(function () {
        statusEl.textContent = msg || 'บันทึกไว้ในเบราว์เซอร์แล้ว (กด "คัดลอก" ส่งในแชทได้)';
      });
    } else if (msg) {
      statusEl.textContent = msg;
    }
  }
  function setPicking(on) {
    picking = !!on;
    document.body.classList.toggle('pv-picking', picking);
    pickBtn.setAttribute('aria-pressed', String(picking));
    hoverBox.style.display = 'none';
    dragBox.style.display = 'none';
    if (picking) {
      statusEl.textContent = 'คลิกจุดที่ต้องการ หรือกดค้างลากครอบบริเวณ (กด Esc เพื่อยกเลิก)';
    }
  }
  function openFormFor(t) {
    target = t;
    setPicking(false);
    drawer.hidden = false;
    listBtn.setAttribute('aria-expanded', 'true');
    form.hidden = false;
    targetInfo.innerHTML = 'จุดที่ครอบ: <b>' + escHtml(t.label) + '</b> · หน้า <code>' + escHtml(t.route) + '</code>';
    noteEl.value = '';
    setTimeout(function () { noteEl.focus(); }, 30);
  }
  function renderPins() {
    var r = location.hash || '#/';
    var html = '';
    comments.forEach(function (c, i) {
      if ((c.route || '#/') !== r || !c.box) return;
      var x = Math.min(Math.max(c.box.pageX || 40, 16), Math.max((document.documentElement.clientWidth || 360) - 16, 40)), y = (c.box.pageY || 80);
      html += '<button type="button" class="pv-pin" data-pv-pin="' + i + '" data-done="' + Boolean(c.done) + '" style="left:' + x + 'px;top:' + y + 'px" title="' + escHtml(c.note) + '">' + (i + 1) + '</button>';
    });
    pinsEl.innerHTML = html;
  }
  function renderList() {
    var openCount = comments.filter(function (c) { return !c.done; }).length;
    document.getElementById('pvCount').textContent = String(openCount);
    document.getElementById('pvCountHead').textContent = String(comments.length);
    renderPins();
    if (!comments.length) {
      listEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = comments.map(function (c, i) {
      var roleName = { '': 'ผู้เยี่ยมชม', citizen: 'ประชาชน', staff: 'เจ้าหน้าที่', admin: 'ผู้ดูแล' }[c.role || ''] || c.role;
      return '<div class="pv-item" data-pv-item="' + i + '" data-done="' + Boolean(c.done) + '">' +
        '<div class="pv-item-head"><span><span class="pv-item-num">' + (i + 1) + '</span> ' + escHtml(roleName) + ' · <code>' + escHtml(c.route || '#/') + '</code></span>' +
        '<span>' + escHtml(c.label || c.selector || '') + '</span></div>' +
        '<div class="pv-item-note">' + escHtml(c.note) + '</div>' +
        '<div class="pv-item-acts">' +
          '<button type="button" data-pv-goto="' + i + '">ไปหน้านี้</button>' +
          '<button type="button" data-pv-done="' + i + '">' + (c.done ? 'เปิดใหม่' : '✓ แก้แล้ว') + '</button>' +
          '<button type="button" data-pv-del="' + i + '">ลบ</button>' +
        '</div></div>';
    }).join('');
  }

  pickBtn.addEventListener('click', function () { setPicking(!picking); });
  listBtn.addEventListener('click', function () {
    drawer.hidden = !drawer.hidden;
    listBtn.setAttribute('aria-expanded', String(!drawer.hidden));
  });
  document.getElementById('pvCloseBtn').addEventListener('click', function () {
    drawer.hidden = true;
    listBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('pvRepickBtn').addEventListener('click', function () {
    form.hidden = true;
    setPicking(true);
  });
  document.getElementById('pvCancelBtn').addEventListener('click', function () {
    form.hidden = true;
    target = null;
  });
  noteEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var txt = noteEl.value.trim();
    if (!txt) return;
    var t = target || { role: get(), route: location.hash || '#/', selector: 'body', label: 'ทั้งหน้านี้', box: null };
    comments.push({
      id: Date.now(),
      role: t.role,
      route: t.route,
      selector: t.selector,
      label: t.label,
      box: t.box,
      note: txt,
      done: false,
      at: new Date().toISOString()
    });
    form.hidden = true;
    target = null;
    syncSave('บันทึก comment แล้ว — บอกในแชทว่า "แก้ตาม comment" ได้เลย');
  });
  document.getElementById('pvClearBtn').addEventListener('click', function () {
    comments = [];
    syncSave('ล้างรายการทั้งหมดแล้ว');
  });
  document.getElementById('pvCopyBtn').addEventListener('click', function () {
    var lines = comments.filter(function (c) { return !c.done; }).map(function (c, i) {
      return (i + 1) + '. [' + (c.role || 'anon') + ' ' + (c.route || '#/') + '] ' + (c.label || c.selector) + ' → ' + c.note;
    }).join('\\n');
    if (navigator.clipboard && lines) navigator.clipboard.writeText(lines).catch(function () {});
    statusEl.textContent = lines ? 'คัดลอกรายการส่งแชทแล้ว (' + comments.length + ' ข้อ)' : 'ยังไม่มีรายการให้คัดลอก';
  });
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var g = b.getAttribute('data-pv-goto'), d = b.getAttribute('data-pv-done'), rm = b.getAttribute('data-pv-del');
    if (g !== null) {
      var c = comments[Number(g)];
      if (!c) return;
      if ((c.role || '') !== get()) { set(c.role || ''); location.hash = c.route || '#/'; location.reload(); return; }
      location.hash = c.route || '#/';
      var el = c.selector ? document.querySelector(c.selector) : null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (d !== null && comments[Number(d)]) {
      comments[Number(d)].done = !comments[Number(d)].done;
      syncSave('อัปเดตสถานะแล้ว');
    } else if (rm !== null) {
      comments.splice(Number(rm), 1);
      syncSave('ลบรายการแล้ว');
    }
  });
  pinsEl.addEventListener('click', function (e) {
    var pin = e.target.closest('[data-pv-pin]');
    if (!pin) return;
    drawer.hidden = false;
    listBtn.setAttribute('aria-expanded', 'true');
  });

  document.addEventListener('mousemove', function (e) {
    if (!picking) return;
    if (dragStart) {
      var x = Math.min(dragStart.x, e.clientX), y = Math.min(dragStart.y, e.clientY);
      var w = Math.abs(e.clientX - dragStart.x), h = Math.abs(e.clientY - dragStart.y);
      dragBox.style.display = 'block';
      dragBox.style.left = x + 'px'; dragBox.style.top = y + 'px';
      dragBox.style.width = w + 'px'; dragBox.style.height = h + 'px';
      hoverBox.style.display = 'none';
      return;
    }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isPvUi(el)) { hoverBox.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    hoverBox.style.display = 'block';
    hoverBox.style.left = r.left + 'px'; hoverBox.style.top = r.top + 'px';
    hoverBox.style.width = r.width + 'px'; hoverBox.style.height = r.height + 'px';
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (!picking || e.button !== 0 || isPvUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart = { x: e.clientX, y: e.clientY, el: e.target };
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (!picking || !dragStart) return;
    e.preventDefault();
    e.stopPropagation();
    var st = dragStart;
    dragStart = null;
    dragBox.style.display = 'none';
    var dx = Math.abs(e.clientX - st.x), dy = Math.abs(e.clientY - st.y);
    var cx = dx > 12 || dy > 12 ? Math.round((st.x + e.clientX) / 2) : e.clientX;
    var cy = dx > 12 || dy > 12 ? Math.round((st.y + e.clientY) / 2) : e.clientY;
    var el = document.elementFromPoint(cx, cy) || st.el;
    if (isPvUi(el)) return;
    var rect = el.getBoundingClientRect();
    var box = dx > 12 && dy > 12
      ? { x: Math.min(st.x, e.clientX), y: Math.min(st.y, e.clientY), w: dx, h: dy, pageX: Math.round(cx + window.scrollX), pageY: Math.round(cy + window.scrollY) }
      : { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), pageX: Math.round(e.clientX + window.scrollX), pageY: Math.round(e.clientY + window.scrollY) };
    var picked = {
      role: get(),
      route: location.hash || '#/',
      selector: selectorOf(el),
      label: labelOf(el),
      box: box
    };
    setTimeout(function () { openFormFor(picked); }, 0);
  }, true);

  document.addEventListener('click', function (e) {
    if (!picking || isPvUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && picking) setPicking(false);
  });

  loadLocal();
  renderList();
  show();
})();
</script>
"""


def must_sub(text, old, new, where):
    if old not in text:
        sys.exit(f"preview: หา '{old[:60]}' ใน {where} ไม่เจอ — โค้ดเปลี่ยนไป ต้องแก้ tools/preview/build.py")
    return text.replace(old, new)


def rename(text):
    for a, b in NAMES:
        text = text.replace(a, b)
    return re.sub(r"\?v=[0-9A-Za-z.\-]+", "", text)   # หน้าตัวอย่างไม่ต้องกันแคช


def ai_samples(mock):
    """ภาพตัวอย่างข่าวจากช่อง AI: วาดจาก tests/ai_news/fixtures แบบออฟไลน์ (ชื่อโรงพยาบาลสมมติ) → sample/ai/*.jpg
    แล้วให้ Supabase จำลองชี้รูป ai/…/<ชนิด>.jpg มาที่ไฟล์นี้ · ไม่มี Node/Playwright = ข้าม (รูปข่าว AI ในหน้าตัวอย่างจะว่าง)"""
    tmp = OUT / "_aifx"
    try:
        shutil.copytree(ROOT / "tests/ai_news/fixtures", tmp)
        env = {**os.environ, "AI_NEWS_BRAND": rename("งานเภสัชกรรมปฐมภูมิ · โรงพยาบาลควนกาหลง")}
        if not env.get("NODE_PATH"):
            local_nm = ROOT / "tests/ui/node_modules"
            env["NODE_PATH"] = str(local_nm) if local_nm.exists() else subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
        subprocess.run(["node", str(ROOT / "tools/ai_news/run.mjs"), "--offline", str(tmp), str(OUT / "sample/ai")], check=True, env=env, capture_output=True, timeout=180)
        (OUT / "sample/ai/news.json").unlink()
        return must_sub(mock, "`https://img.test/${bucket}/${p}`",
                        "(/^ai\\/.*(infographic|comic|clinical)\\.jpg$/.test(p) ? `sample/ai/${p.match(/(infographic|comic|clinical)\\.jpg$/)[1]}.jpg` : `https://img.test/${bucket}/${p}`)", "mock_supabase.js")
    except Exception as e:  # noqa: BLE001
        print("preview: ข้ามภาพตัวอย่างช่อง AI —", str(e)[:120])
        return mock
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    saved_comments = (OUT / "comments.json").read_text(encoding="utf-8") if (OUT / "comments.json").exists() else None
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    if saved_comments is not None:
        (OUT / "comments.json").write_text(saved_comments, encoding="utf-8")

    # ข้อมูลสมมติ: เปลี่ยนชื่อ รพ.สต. / สถานที่จริงทั้งหมด
    fx = (ROOT / "tests/ui/fixtures.json").read_text(encoding="utf-8")
    units = json.loads(fx)["units"]
    for u in sorted(units, key=lambda u: -len(u["name"])):
        if u["id"] == 0:
            continue
        fx = fx.replace(u["name"], UNIT_ALIAS.format(u["id"]))
    data = json.loads(rename(fx))
    for u in data["units"]:
        u["phone"] = "0xx-xxx-xxx" if u.get("phone") else None
        u["address"] = f"ที่อยู่สมมติ หน่วยที่ {u['id']}" if u.get("address") else None
    # ตัวอย่างธง AI ตรวจย้อนหลัง (92 · หน้าตัวอย่างเท่านั้น · ข้อความสมมติ): ตัวเลขขัด 1 ยา + นอกฉลาก 1 ยา → เห็นปุ่มเภสัชกรตัดสิน
    for d in data.get("dose_drugs", []):
        inds = d.get("indications") or []
        if not inds:
            continue
        if d["id"] == 3:
            d["audit_flags"] = [{"name": inds[0]["name"], "level": "wrong", "at": "2026-10-22T18:00:00Z",
                                 "why": "ตัวอย่าง: ฉลากระบุขนาดสูงสุดต่ำกว่าที่บันทึก (ข้อความสมมติ)", "quote": "sample label text (preview only)"}]
        elif d["id"] == 1:
            d["audit_flags"] = [{"name": inds[0]["name"], "level": "offlabel", "at": "2026-10-22T18:00:00Z",
                                 "why": "ตัวอย่าง: ฉลากสหรัฐฯ ไม่ได้ระบุข้อบ่งใช้/กลุ่มอายุนี้ (ข้อความสมมติ)"}]
    (OUT / "fixtures.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    shutil.copy(ROOT / "assets/app.css", OUT / "assets/app.css")
    shutil.copytree(ROOT / "assets/growth", OUT / "assets/growth")   # กราฟการเจริญเติบโต (กรมอนามัย)
    for f in (ROOT / "js").rglob("*.js"):
        dst = OUT / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        text = rename(f.read_text(encoding="utf-8"))
        if f.name == "supabase.js":
            text = must_sub(text, "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm", "./mock-supabase.js", "js/supabase.js")
        if f.name == "drug-grid.js":   # ตารางแก้ไขยา: หน้าตัวอย่างโหลดสไตล์จาก jsDelivr ไม่ได้ → ใช้สำเนาในหน้าตัวอย่าง
            text = must_sub(text, "const TAB_JS = `${TAB}/js/tabulator_esm.min.mjs`, TAB_CSS = `${TAB}/css/tabulator.min.css`;",
                            "const TAB_JS = '../../vendor/tabulator_esm.min.js', TAB_CSS = 'vendor/tabulator.min.css';", "js/pages/drug-grid.js")
        if f.name == "config.js":
            text = re.sub(r"https://[a-z0-9]+\.supabase\.co", "https://preview.invalid", text)
            text = re.sub(r"sb_publishable_[A-Za-z0-9_-]+", "preview-key", text)
        dst.write_text(text, encoding="utf-8")

    tab = ROOT / "tests/ui/node_modules/tabulator-tables/dist"   # ติดตั้งโดย tests/setup_env.sh / npm install ใน tests/ui
    if not tab.exists():
        sys.exit("preview: ไม่มี Tabulator ในเครื่อง — รัน bash tests/setup_env.sh ก่อน")
    (OUT / "vendor").mkdir()
    shutil.copy(tab / "js/tabulator_esm.min.mjs", OUT / "vendor/tabulator_esm.min.js")
    shutil.copy(tab / "css/tabulator.min.css", OUT / "vendor/tabulator.min.css")

    mock = (ROOT / "tests/ui/mock_supabase.js").read_text(encoding="utf-8")
    mock = must_sub(mock, "fetch('/tests/ui/fixtures.json')", "fetch('fixtures.json')", "mock_supabase.js")
    mock = must_sub(mock, "new URLSearchParams(location.search).get('mockrole')", "window.__previewRole()", "mock_supabase.js")
    mock = ai_samples(mock)
    (OUT / "js/mock-supabase.js").write_text(mock, encoding="utf-8")

    # หน้าหลัก: ตัด <html>/<head>/<body> ออก (Artifact ครอบให้เอง) + แถบเลือกบทบาทไว้บนสุด
    html = rename((ROOT / "index.html").read_text(encoding="utf-8"))
    html = re.sub(r"<title>.*?</title>\n?", "", html, flags=re.S)
    for tag in (r"<!doctype html>", r"<html[^>]*>", r"</html>", r"<head>", r"</head>", r"</body>", r'<meta charset="utf-8">', r'<meta name="viewport"[^>]*>'):
        html = re.sub(tag + r"\n?", "", html, flags=re.I)
    html = must_sub(html, "<body>\n", "", "index.html")
    page = ROLE_BAR + html.strip() + "\n"
    (OUT / "index.html").write_text(page, encoding="utf-8")
    (OUT / "local.html").write_text('<!doctype html>\n<html lang="th">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + page + "</html>\n", encoding="utf-8")

    texts = [p for p in OUT.rglob("*") if p.is_file() and p.suffix != ".jpg" and p.name != "comments.json"]   # ภาพตัวอย่างช่อง AI วาดด้วยชื่อสมมติอยู่แล้ว
    leaks = [str(p.relative_to(OUT)) for p in texts if FORBIDDEN.search(p.read_text(encoding="utf-8"))]
    leaks += [u["name"] for u in units if u["id"] and any(u["name"] in p.read_text(encoding="utf-8") for p in texts)]
    if leaks:
        sys.exit(f"preview: ยังมีชื่อจริงหลุด: {leaks}")
    print(f"preview: {sum(1 for p in OUT.rglob('*') if p.is_file())} ไฟล์ → {OUT}")


main()
