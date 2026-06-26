#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract DB campus/canteen data for the sample schools we web-searched."""

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

sample_names = [
    "上海交通大学", "复旦大学", "浙江大学", "武汉大学", "四川大学",
    "北京大学", "清华大学", "中山大学", "西安交通大学", "哈尔滨工业大学",
    "山东大学", "中国科学技术大学", "中国人民大学",
]

school_by_name = {s["name"]: s for s in schools}
campus_by_school = defaultdict(list)
for c in campuses:
    campus_by_school[c["school_id"]].append(c)
canteen_by_campus = defaultdict(list)
for c in canteens:
    if c["campus_id"]:
        canteen_by_campus[c["campus_id"]].append(c)

result = []
for name in sample_names:
    s = school_by_name.get(name)
    if not s:
        result.append(f"## {name}\n\n未在数据库中找到\n")
        continue
    lines = [f"## {name}", ""]
    lines.append(f"- 学校ID: {s['id']}")
    lines.append(f"- 数据库中校区数: {len(campus_by_school[s['id']])}")
    total_canteens = sum(len(canteen_by_campus[c['id']]) for c in campus_by_school[s['id']])
    lines.append(f"- 数据库中食堂数: {total_canteens}")
    lines.append("")
    for c in campus_by_school[s['id']]:
        lines.append(f"### {c['name']}")
        if c.get("aliases"):
            lines.append(f"- 别名: {', '.join(c['aliases'])}")
        if c.get("address"):
            lines.append(f"- 地址: {c['address']}")
        cts = canteen_by_campus.get(c["id"], [])
        if cts:
            lines.append(f"- 食堂 ({len(cts)}):")
            for ct in cts:
                lines.append(f"  - {ct['name']}")
        else:
            lines.append("- 暂无食堂数据")
        lines.append("")
    result.append("\n".join(lines))

with open(ROOT / "sample_schools_db_extract.md", "w", encoding="utf-8") as f:
    f.write("# 抽样学校数据库原始数据\n\n")
    f.write("\n".join(result))

print("Wrote sample_schools_db_extract.md")
