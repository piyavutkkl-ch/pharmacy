#!/usr/bin/env python3
"""เซิร์ฟเวอร์หน้าตัวอย่างในเครื่อง (_preview/local.html) + รับบันทึก comment สั่งแก้ไขลง _preview/comments.json

ใช้:
  python3 tools/preview/serve.py [พอร์ต]       (ค่าเริ่มต้น 8765)
  python3 tools/preview/serve.py --list        แสดงรายการ comment ที่รอแก้ไข
  python3 tools/preview/serve.py --clear       ล้าง comment ที่แก้เสร็จแล้ว

เปิดดู: http://localhost:8765/_preview/local.html
API:
  GET  /__comments       → รายการ comment ทั้งหมด (JSON array)
  POST /__comments       → บันทึกชุด comment (JSON array หรือ {comments:[...]}) ลง _preview/comments.json
"""
import functools
import http.server
import json
import pathlib
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).resolve().parents[2]
PREVIEW = ROOT / "_preview"
COMMENTS = PREVIEW / "comments.json"


def load_comments():
    if not COMMENTS.exists():
        return []
    try:
        data = json.loads(COMMENTS.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_comments(items):
    PREVIEW.mkdir(parents=True, exist_ok=True)
    clean = []
    for i, c in enumerate(items if isinstance(items, list) else [], 1):
        if not isinstance(c, dict) or not str(c.get("note", "")).strip():
            continue
        clean.append({
            "id": c.get("id") or i,
            "role": str(c.get("role") or ""),
            "route": str(c.get("route") or "#/"),
            "selector": str(c.get("selector") or "")[:240],
            "label": str(c.get("label") or "")[:200],
            "box": c.get("box") if isinstance(c.get("box"), dict) else None,
            "note": str(c.get("note") or "").strip()[:2000],
            "done": bool(c.get("done", False)),
            "at": str(c.get("at") or ""),
        })
    COMMENTS.write_text(json.dumps(clean, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return clean


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__comments":
            body = json.dumps(load_comments(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/_preview/local.html?pvapi=1")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/__comments":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "[]"
        try:
            payload = json.loads(raw)
        except Exception:
            self.send_error(400, "invalid json")
            return
        items = payload.get("comments", payload) if isinstance(payload, dict) else payload
        saved = save_comments(items)
        body = json.dumps({"ok": True, "count": len(saved), "comments": saved}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def print_comments():
    items = load_comments()
    if not items:
        print("ยังไม่มี comment ที่บันทึกไว้ (_preview/comments.json)")
        return
    for i, c in enumerate(items, 1):
        status = "✓ แก้แล้ว" if c.get("done") else "• รอแก้"
        role = c.get("role") or "ผู้เยี่ยมชม"
        route = c.get("route") or "#/"
        label = c.get("label") or c.get("selector") or "-"
        sel = c.get("selector") or ""
        print(f"[{i}] {status} | บทบาท: {role} | หน้า: {route}")
        print(f"    จุดที่ครอบ: {label}" + (f" ({sel})" if sel and sel != label else ""))
        print(f"    สั่งแก้: {c.get('note')}")


def main():
    args = sys.argv[1:]
    if "--list" in args:
        print_comments()
        return
    if "--clear" in args:
        save_comments([])
        print("ล้างรายการ comment แล้ว")
        return
    port = int(args[0]) if args and args[0].isdigit() else 8765
    existing = load_comments()
    if not (PREVIEW / "local.html").exists():
        subprocess.run([sys.executable, str(ROOT / "tools/preview/build.py")], check=True)
    if existing and not COMMENTS.exists():
        save_comments(existing)
    handler = functools.partial(Handler, directory=str(ROOT))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"preview server: http://localhost:{port}/_preview/local.html?pvapi=1 (บันทึก comment → _preview/comments.json)")
        sys.stdout.flush()
        httpd.serve_forever()


if __name__ == "__main__":
    main()
