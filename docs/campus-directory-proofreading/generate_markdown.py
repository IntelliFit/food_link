#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate human-readable markdown report of campus directory data."""

import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent


def load(name):
    with open(ROOT / f"{name}.json", "r", encoding="utf-8") as f:
        return json.load(f)


def save_text(name, text):
    with open(ROOT / f"{name}.md", "w", encoding="utf-8") as f:
        f.write(text)


def main():
    schools = load("schools")
    campuses = load("campuses")
    canteens = load("canteens")
    sources = load("sources")

    school_by_id = {s["id"]: s for s in schools}
    campuses_by_school = defaultdict(list)
    for c in campuses:
        campuses_by_school[c["school_id"]].append(c)

    canteens_by_campus = defaultdict(list)
    orphan_canteens = []
    for c in canteens:
        if c["campus_id"]:
            canteens_by_campus[c["campus_id"]].append(c)
        else:
            orphan_canteens.append(c)

    sources_by_canteen = defaultdict(list)
    sources_by_campus = defaultdict(list)
    for s in sources:
        if s.get("canteen_id"):
            sources_by_canteen[s["canteen_id"]].append(s)
        elif s.get("campus_id"):
            sources_by_campus[s["campus_id"]].append(s)

    # Schools with campus data
    schools_with_data = [s for s in schools if s["id"] in campuses_by_school]
    schools_with_data.sort(key=lambda s: (s.get("province") or "", s.get("city") or "", s["name"]))

    lines = [
        "# 校园食堂数据校对底稿",
        "",
        f"生成时间：见 summary.json",
        f"- 学校总数：{len(schools)}",
        f"- 已覆盖学校数（有校区数据）：{len(schools_with_data)}",
        f"- 校区总数：{len(campuses)}",
        f"- 食堂总数：{len(canteens)}",
        f"- 档口总数：{len(load('windows'))}",
        f"- 来源总数：{len(sources)}",
        "",
        "## 数据覆盖情况",
        "",
        f"在 {len(schools)} 所学校中，只有 **{len(schools_with_data)}** 所有校区/食堂数据，",
        f"覆盖率为 {len(schools_with_data)/len(schools)*100:.2f}%。",
        f"其中 {len(orphan_canteens)} 个食堂未关联校区，{sum(1 for c in campuses if c['id'] not in canteens_by_campus)} 个校区下没有食堂。",
        "",
        "## 已覆盖学校清单",
        "",
    ]

    for idx, school in enumerate(schools_with_data, 1):
        sid = school["id"]
        sname = school["name"]
        province = school.get("province") or "未知省份"
        city = school.get("city") or ""
        level = school.get("level") or ""
        tags = []
        if school.get("is_985"):
            tags.append("985")
        if school.get("is_211"):
            tags.append("211")
        tag_str = f" ({', '.join(tags)})" if tags else ""

        lines.append(f"### {idx}. {sname}{tag_str}")
        lines.append(f"- 省份：{province} {city} | 层次：{level}")

        scampuses = campuses_by_school[sid]
        lines.append(f"- 校区数量：{len(scampuses)}")
        for c in scampuses:
            cid = c["id"]
            cname = c["name"]
            aliases = c.get("aliases") or []
            address = c.get("address") or ""
            ctype = c.get("campus_type") or ""
            lines.append(f"  - **校区：{cname}**")
            if aliases:
                lines.append(f"    - 别名：{', '.join(aliases)}")
            if ctype:
                lines.append(f"    - 类型：{ctype}")
            if address:
                lines.append(f"    - 地址：{address}")

            canteens = canteens_by_campus.get(cid, [])
            if canteens:
                lines.append(f"    - 食堂数量：{len(canteens)}")
                for ct in canteens:
                    ctname = ct["name"]
                    aliases = ct.get("aliases") or []
                    location = ct.get("location_text") or ""
                    building = ct.get("building_or_floor") or ""
                    service = ct.get("service_type") or ""
                    audience = ct.get("audience") or ""
                    confidence = ct.get("confidence_level") or ""
                    src_count = len(sources_by_canteen.get(ct["id"], []))
                    parts = [f"      - {ctname}"]
                    meta = []
                    if aliases:
                        meta.append(f"别名：{', '.join(aliases)}")
                    if building:
                        meta.append(f"楼层/楼栋：{building}")
                    if location:
                        meta.append(f"位置：{location}")
                    if service:
                        meta.append(f"类型：{service}")
                    if audience:
                        meta.append(f"受众：{audience}")
                    if confidence:
                        meta.append(f"置信度：{confidence}")
                    if src_count:
                        meta.append(f"来源数：{src_count}")
                    if meta:
                        parts.append(" | ".join(meta))
                    lines.append(" ".join(parts))
            else:
                campus_sources = sources_by_campus.get(cid, [])
                if campus_sources:
                    lines.append(f"    - 该校区暂无食堂数据，但有 {len(campus_sources)} 条校区来源")
                else:
                    lines.append(f"    - 该校区暂无食堂数据")

        if orphan_canteens and any(c["school_id"] == sid for c in orphan_canteens):
            lines.append("- **未关联校区的食堂：**")
            for ct in orphan_canteens:
                if ct["school_id"] == sid:
                    lines.append(f"  - {ct['name']}")

        lines.append("")

    save_text("campus_directory_draft", "\n".join(lines))
    print(f"Generated campus_directory_draft.md with {len(schools_with_data)} schools")


if __name__ == "__main__":
    main()
