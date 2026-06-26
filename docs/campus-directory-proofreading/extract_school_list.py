#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent

with open(ROOT / "schools.json", encoding="utf-8") as f:
    schools = json.load(f)
with open(ROOT / "campuses.json", encoding="utf-8") as f:
    campuses = json.load(f)
with open(ROOT / "canteens.json", encoding="utf-8") as f:
    canteens = json.load(f)

campus_count = defaultdict(int)
canteen_count = defaultdict(int)
for c in campuses:
    campus_count[c["school_id"]] += 1
for c in canteens:
    canteen_count[c["school_id"]] += 1

schools_with = [s for s in schools if campus_count[s["id"]] > 0]
schools_with.sort(key=lambda s: (s.get("province") or "", s.get("city") or "", s["name"]))

lines = ["| # | 学校 | 省份 | 层次 | 985 | 211 | 校区数 | 食堂数 |",
         "|---|------|------|------|-----|-----|--------|--------|"]
for i, s in enumerate(schools_with, 1):
    lines.append(f"| {i} | {s['name']} | {s.get('province') or ''} | {s.get('level') or ''} | {'是' if s.get('is_985') else ''} | {'是' if s.get('is_211') else ''} | {campus_count[s['id']]} | {canteen_count[s['id']]} |")

with open(ROOT / "schools_with_data.md", "w", encoding="utf-8") as f:
    f.write("# 已有校区/食堂数据的学校清单\n\n")
    f.write(f"共 {len(schools_with)} 所学校\n\n")
    f.write("\n".join(lines))

print(f"Wrote {len(schools_with)} schools to schools_with_data.md")
