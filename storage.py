#!/usr/bin/env python3
"""ดึง/คืนไฟล์ใน Supabase Storage (รูปข่าว/ผลงาน, เอกสาร, หลักฐานเกณฑ์) — Python มาตรฐานเท่านั้น

  storage.py pull full <โฟลเดอร์>      ดาวน์โหลดทุกไฟล์
  storage.py pull inc  <โฟลเดอร์>      ดาวน์โหลดเฉพาะไฟล์ที่เพิ่ม/แก้ใน INC_DAYS วันล่าสุด
  storage.py push <โฟลเดอร์>           อัปโหลดทุกไฟล์ในโฟลเดอร์ (โครงสร้าง <bucket>/<path>) กลับขึ้นโปรเจกต์ (ทับของเดิม)

ค่าที่ต้องมี: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_… — เก็บใน GitHub Secrets เท่านั้น)
         pull ใช้ SUPABASE_DB_URL เพื่ออ่านรายชื่อไฟล์จากตาราง storage.objects (ผ่าน psql)
ทุกโฟลเดอร์ที่ pull จะมี _manifest.tsv = รายชื่อไฟล์ทั้งหมดในระบบขณะนั้น (ใช้ตรวจว่าไฟล์ไหนถูกลบ)
"""
import concurrent.futures as cf, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

INC_DAYS = 15          # สำรองรายสัปดาห์ แต่ย้อน 15 วัน เผื่อสัปดาห์ก่อนล้มเหลว
TYPES = {".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain"}


def env(k):
    v = os.environ.get(k)
    if not v:
        print(f"ERROR: ยังไม่ได้ตั้งค่า {k}", file=sys.stderr)
        sys.exit(1)
    return v


def headers():
    k = env("SUPABASE_SECRET_KEY")
    return {"apikey": k, "Authorization": "Bearer " + k}


def enc(path):
    return "/".join(urllib.parse.quote(p, safe="") for p in path.split("/"))


def list_objects(mode):
    where = "name not like '%.emptyFolderPlaceholder'"
    sql = ("select bucket_id, name, coalesce(updated_at, created_at)::text, coalesce((metadata->>'size')::bigint, 0), "
           f"(coalesce(updated_at, created_at) >= now() - interval '{INC_DAYS} days')::int "
           f"from storage.objects where {where} order by 1, 2")
    out = subprocess.run(["psql", env("SUPABASE_DB_URL"), "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if out.returncode:
        print("ERROR: อ่านรายชื่อไฟล์ไม่สำเร็จ: " + out.stderr.strip()[:300], file=sys.stderr)
        sys.exit(1)
    rows = [l.split("\t") for l in out.stdout.splitlines() if l.strip()]
    return rows, [r for r in rows if mode == "full" or r[4] == "1"]


def get(bucket, name, dest, tries=4):
    url = f"{env('SUPABASE_URL').rstrip('/')}/storage/v1/object/authenticated/{bucket}/{enc(name)}"
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers()), timeout=300) as r:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
            return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return f"{bucket}/{name}: ไม่พบไฟล์ (อาจถูกลบระหว่างสำรอง)"
            err = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            err = str(e.reason)
        time.sleep(2 ** i * 2)
    return f"{bucket}/{name}: {err}"


def pull(mode, out):
    allrows, rows = list_objects(mode)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "_manifest.tsv"), "w", encoding="utf-8") as m:
        m.write("bucket\tpath\tupdated_at\tsize\n")
        for r in allrows:
            m.write("\t".join(r[:4]) + "\n")
    errors, missing = [], 0
    with cf.ThreadPoolExecutor(6) as ex:
        for res in ex.map(lambda r: get(r[0], r[1], os.path.join(out, r[0], r[1])), rows):
            if res and "ไม่พบไฟล์" in res:
                missing += 1
            elif res:
                errors.append(res)
    size = sum(int(r[3]) for r in rows)
    print(f"storage {mode}: {len(rows) - len(errors) - missing}/{len(rows)} files ({size / 1048576:.1f} MB) · total in project {len(allrows)}")
    if errors:
        print("ERROR: ดาวน์โหลดไม่สำเร็จ " + str(len(errors)) + " ไฟล์ เช่น " + errors[0], file=sys.stderr)
        sys.exit(1)


def put(bucket, name, src):
    url = f"{env('SUPABASE_URL').rstrip('/')}/storage/v1/object/{bucket}/{enc(name)}"
    ctype = TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    with open(src, "rb") as f:
        data = f.read()
    for i in range(4):
        h = headers()
        h.update({"Content-Type": ctype, "x-upsert": "true", "cache-control": "3600"})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method="POST"), timeout=300):
                return None
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                return f"{bucket}/{name}: HTTP {e.code} {e.read().decode(errors='replace')[:150]}"
            err = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            err = str(e.reason)
        time.sleep(2 ** i * 2)
    return f"{bucket}/{name}: {err}"


def push(folder):
    jobs = []
    for root, _, files in os.walk(folder):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            if "/" not in rel:          # _manifest.tsv ฯลฯ
                continue
            bucket, name = rel.split("/", 1)
            jobs.append((bucket, name, full))
    errors = []
    with cf.ThreadPoolExecutor(6) as ex:
        errors = [e for e in ex.map(lambda j: put(*j), jobs) if e]
    print(f"storage restore: {len(jobs) - len(errors)}/{len(jobs)} files uploaded")
    if errors:
        print("ERROR: อัปโหลดไม่สำเร็จ " + str(len(errors)) + " ไฟล์ เช่น " + errors[0], file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == "pull" and a[1] in ("full", "inc"):
        pull(a[1], a[2])
    elif len(a) == 2 and a[0] == "push":
        push(a[1])
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
