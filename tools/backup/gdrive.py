#!/usr/bin/env python3
"""เก็บไฟล์สำรองใน Google Drive กลาง (ใช้เฉพาะ Python มาตรฐาน ไม่ต้องติดตั้งอะไรเพิ่ม)

สิทธิ์ที่ใช้: drive.file — เห็น/แก้ได้เฉพาะไฟล์ที่ระบบสำรองนี้สร้างเอง ไม่เห็นไฟล์อื่นใน Drive
ค่าที่ต้องมี (GitHub Secrets): GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
ตัวเลือก: GDRIVE_FOLDER (ค่าเริ่มต้น "Pharmacy-Backups")

  gdrive.py upload <ไฟล์>           อัปโหลดเข้าโฟลเดอร์สำรอง
  gdrive.py prune                   ลบไฟล์เก่าตามนโยบายเก็บรักษา (ดู KEEP_*)
  gdrive.py ls                      แสดงรายการไฟล์สำรอง
  gdrive.py fetch db [ชื่อไฟล์]       ดาวน์โหลดไฟล์ฐานข้อมูล (ล่าสุด หรือชื่อที่ระบุ) → พิมพ์ชื่อไฟล์
  gdrive.py fetch files             ดาวน์โหลดชุดไฟล์ล่าสุด (full ล่าสุด + inc หลังจากนั้น) → พิมพ์ชื่อไฟล์
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

TOKEN_URL = os.environ.get("GDRIVE_TOKEN_URL", "https://oauth2.googleapis.com/token")
API = os.environ.get("GDRIVE_API_BASE", "https://www.googleapis.com/drive/v3")
UPLOAD = os.environ.get("GDRIVE_UPLOAD_BASE", "https://www.googleapis.com/upload/drive/v3")
FOLDER = os.environ.get("GDRIVE_FOLDER", "Pharmacy-Backups")
FOLDER_MIME = "application/vnd.google-apps.folder"
CHUNK = int(os.environ.get("GDRIVE_CHUNK", 8 * 1024 * 1024))   # ต้องเป็นพหุคูณของ 256 KiB
KEEP_DB = 26                      # ฐานข้อมูลรายสัปดาห์ ≈ 6 เดือน
KEEP_FULL = 3                     # ไฟล์รูป/เอกสารชุดเต็ม (รายเดือน) ≈ 3 เดือน

_token = None


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def token():
    global _token
    if _token:
        return _token
    miss = [k for k in ("GDRIVE_CLIENT_ID", "GDRIVE_CLIENT_SECRET", "GDRIVE_REFRESH_TOKEN") if not os.environ.get(k)]
    if miss:
        die("ยังไม่ได้ตั้ง GitHub Secret: " + ", ".join(miss))
    body = urllib.parse.urlencode({
        "client_id": os.environ["GDRIVE_CLIENT_ID"], "client_secret": os.environ["GDRIVE_CLIENT_SECRET"],
        "refresh_token": os.environ["GDRIVE_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=60) as r:
            _token = json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        die(f"ขอสิทธิ์ Google Drive ไม่สำเร็จ (HTTP {e.code}) — refresh token อาจหมดอายุ/ถูกยกเลิก ให้สร้างใหม่ตาม docs/BACKUP.md\n{detail}")
    return _token


def call(method, url, data=None, headers=None, raw=False, tries=4):
    for i in range(tries):
        h = {"Authorization": "Bearer " + token()}
        h.update(headers or {})
        body = data
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json; charset=UTF-8"
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method=method), timeout=300)
            if raw:
                return r
            with r:
                txt = r.read()
                return json.loads(txt) if txt else {}
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** i * 3)
                continue
            die(f"Google Drive {method} ผิดพลาด HTTP {e.code}: {e.read().decode(errors='replace')[:300]}")
        except urllib.error.URLError as e:
            if i < tries - 1:
                time.sleep(2 ** i * 3)
                continue
            die(f"เชื่อมต่อ Google Drive ไม่ได้: {e}")


def q(expr):
    return urllib.parse.quote(expr, safe="")


def folder_id():
    name = FOLDER.replace("'", "\\'")
    expr = f"name='{name}' and mimeType='{FOLDER_MIME}' and trashed=false"
    res = call("GET", f"{API}/files?q={q(expr)}&fields=files(id)&spaces=drive")
    if res.get("files"):
        return res["files"][0]["id"]
    return call("POST", f"{API}/files?fields=id", {"name": FOLDER, "mimeType": FOLDER_MIME})["id"]


def list_files(fid):
    out, page = [], None
    while True:
        expr = f"'{fid}' in parents and trashed=false"
        url = f"{API}/files?q={q(expr)}&fields=nextPageToken,files(id,name,size,createdTime)&pageSize=1000&orderBy=name"
        if page:
            url += "&pageToken=" + q(page)
        res = call("GET", url)
        out += res.get("files", [])
        page = res.get("nextPageToken")
        if not page:
            return out


def upload(path):
    size = os.path.getsize(path)
    fid = folder_id()
    for old in list_files(fid):                       # รันซ้ำวันเดียวกัน → แทนที่ไฟล์เดิม
        if old["name"] == os.path.basename(path):
            call("DELETE", f"{API}/files/{old['id']}")
    r = call("POST", f"{UPLOAD}/files?uploadType=resumable&fields=id",
             {"name": os.path.basename(path), "parents": [fid]},
             headers={"X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": str(size)}, raw=True)
    session = r.headers["Location"]
    r.close()
    sent = 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK) if size else b""
            end = sent + len(chunk) - 1
            rng = f"bytes {sent}-{end}/{size}" if size else "bytes */0"
            req = urllib.request.Request(session, data=chunk, method="PUT", headers={"Content-Range": rng, "Content-Length": str(len(chunk))})
            try:
                with urllib.request.urlopen(req, timeout=600) as resp:
                    json.load(resp)            # 200/201 = เสร็จ
                    break
            except urllib.error.HTTPError as e:
                if e.code != 308:              # 308 = รับช่วงนี้แล้ว ส่งต่อ
                    die(f"อัปโหลดไม่สำเร็จ HTTP {e.code}: {e.read().decode(errors='replace')[:300]}")
                rng_hdr = e.headers.get("Range")
                sent = int(rng_hdr.split("-")[1]) + 1 if rng_hdr else 0
                f.seek(sent)
    print(f"uploaded {os.path.basename(path)} ({size / 1048576:.1f} MB) → Google Drive/{FOLDER}")


def plan_prune(files):
    """คืนรายการไฟล์ที่ควรลบ (ชื่อไฟล์มีวันที่ YYYY-MM-DD จึงเรียงตามชื่อ = เรียงตามเวลา)"""
    names = sorted(f["name"] for f in files)
    dbs = [n for n in names if n.startswith("db-")]
    fulls = [n for n in names if n.startswith("files-full-")]
    incs = [n for n in names if n.startswith("files-inc-")]
    drop = set(dbs[:-KEEP_DB])
    keep_full = fulls[-KEEP_FULL:]
    drop |= set(fulls[:-KEEP_FULL]) if len(fulls) > KEEP_FULL else set()
    if keep_full:
        oldest = keep_full[0][len("files-full-"):]
        drop |= {n for n in incs if n[len("files-inc-"):] < oldest}
    return [f for f in files if f["name"] in drop]


def prune():
    files = list_files(folder_id())
    for f in plan_prune(files):
        call("DELETE", f"{API}/files/{f['id']}")
        print("deleted old backup " + f["name"])
    print(f"kept {len(files) - len(plan_prune(files))} backup files")


def download(f):
    with call("GET", f"{API}/files/{f['id']}?alt=media", raw=True) as r, open(f["name"], "wb") as out:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            out.write(b)
    print(f["name"])


def fetch(kind, name=None):
    files = sorted(list_files(folder_id()), key=lambda f: f["name"])
    if kind == "db":
        pick = [f for f in files if f["name"] == name] if name else [f for f in files if f["name"].startswith("db-")][-1:]
        if not pick:
            die("ไม่พบไฟล์สำรองฐานข้อมูล" + (f" ชื่อ {name}" if name else ""))
    else:
        fulls = [f for f in files if f["name"].startswith("files-full-")]
        if not fulls:
            die("ไม่พบไฟล์สำรองรูป/เอกสารชุดเต็ม")
        base = fulls[-1]["name"][len("files-full-"):]
        pick = [fulls[-1]] + [f for f in files if f["name"].startswith("files-inc-") and f["name"][len("files-inc-"):] > base]
    for f in pick:
        download(f)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["upload"] and len(a) == 2:
        upload(a[1])
    elif a == ["prune"]:
        prune()
    elif a == ["ls"]:
        for f in list_files(folder_id()):
            print(f"{f['name']}\t{int(f.get('size', 0)) / 1048576:.1f} MB")
    elif a[:1] == ["fetch"] and len(a) in (2, 3) and a[1] in ("db", "files"):
        fetch(a[1], a[2] if len(a) == 3 else None)
    else:
        die(__doc__)
