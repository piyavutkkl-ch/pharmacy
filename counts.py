#!/usr/bin/env python3
"""นับจำนวนแถวต่อตารางจากไฟล์ pg_dump (COPY … FROM stdin) → พิมพ์ "schema.table<TAB>จำนวน" เรียงตามชื่อ"""
import re, sys
counts, cur = {}, None
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        if cur is None:
            m = re.match(r'COPY ([\w."]+) .*FROM stdin;', line)
            if m:
                cur = m.group(1).replace('"', "")
                counts[cur] = 0
        elif line.rstrip("\n") == "\\.":
            cur = None
        else:
            counts[cur] += 1
for t in sorted(counts):
    print(f"{t}\t{counts[t]}")
