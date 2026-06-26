#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Analyze campus directory data quality for proofreading."""

import json
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent


def load(name):
    with open(ROOT / f"{name}.json", "r", encoding="utf-8") as f:
        return json.load(f)


def save(name, data):
    with open(ROOT / f"{name}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def main():
    schools = load("schools")
    campuses = load("campuses")
    canteens = load("canteens")
    windows = load("windows")
    sources = load("sources")
    batches = load("import_batches")

    school_by_id = {s["id"]: s for s in schools}
    campus_by_id = {c["id"]: c for c in campuses}

    # Build relationships
    campuses_by_school = defaultdict(list)
    for c in campuses:
        campuses_by_school[c["school_id"]].append(c)

    canteens_by_school = defaultdict(list)
    canteens_by_campus = defaultdict(list)
    canteens_without_campus = []
    for c in canteens:
        canteens_by_school[c["school_id"]].append(c)
        if c["campus_id"]:
            canteens_by_campus[c["campus_id"]].append(c)
        else:
            canteens_without_campus.append(c)

    sources_by_school = defaultdict(list)
    for s in sources:
        sources_by_school[s["school_id"]].append(s)

    # 1. Coverage issues
    schools_without_campus = [s for s in schools if s["id"] not in campuses_by_school]
    schools_with_campus_but_no_canteen = []
    for s in schools:
        if s["id"] in campuses_by_school and s["id"] not in canteens_by_school:
            schools_with_campus_but_no_canteen.append(s)

    campuses_without_canteen = [
        c for c in campuses
        if c["id"] not in canteens_by_campus
    ]

    # 2. Duplicates
    duplicate_campus_names = []
    for school_id, campus_list in campuses_by_school.items():
        names = [c["name"] for c in campus_list]
        seen = set()
        for name in names:
            if name in seen:
                duplicate_campus_names.append({
                    "school_id": school_id,
                    "school_name": school_by_id.get(school_id, {}).get("name"),
                    "duplicate_name": name,
                })
                break
            seen.add(name)

    duplicate_canteen_names = []
    for campus_id, canteen_list in canteens_by_campus.items():
        names = [c["name"] for c in canteen_list]
        seen = set()
        dups = []
        for name in names:
            if name in seen:
                dups.append(name)
            seen.add(name)
        if dups:
            duplicate_canteen_names.append({
                "campus_id": campus_id,
                "campus_name": campus_by_id.get(campus_id, {}).get("name"),
                "school_name": campus_by_id.get(campus_id, {}).get("school_name"),
                "duplicate_names": list(set(dups)),
            })

    # Also check duplicate canteens across school without campus
    orphan_canteen_name_dup = []
    for school_id, canteen_list in canteens_by_school.items():
        names = [c["name"] for c in canteen_list if not c["campus_id"]]
        seen = set()
        dups = []
        for name in names:
            if name in seen:
                dups.append(name)
            seen.add(name)
        if dups:
            orphan_canteen_name_dup.append({
                "school_id": school_id,
                "school_name": school_by_id.get(school_id, {}).get("name"),
                "duplicate_names": list(set(dups)),
            })

    # 3. Status distribution
    campus_status = Counter(c["status"] for c in campuses)
    canteen_status = Counter(c["status"] for c in canteens)
    canteen_confidence = Counter(c.get("confidence_level") or "NULL" for c in canteens)

    # 4. Suspicious/generic names
    generic_canteen_keywords = ["食堂", "餐厅", "第一食堂", "第二食堂", "第三食堂",
                                "学生食堂", "教工食堂", "教职工食堂", "风味餐厅",
                                "清真食堂", "东区食堂", "西区食堂", "北区食堂", "南区食堂"]
    overly_generic = []
    for c in canteens:
        name = c["name"]
        # If name is just a generic keyword with no number/location specificity
        is_just_generic = any(name == kw for kw in ["食堂", "餐厅"])
        if is_just_generic:
            overly_generic.append({
                "id": c["id"],
                "school_name": c.get("school_name"),
                "campus_name": c.get("campus_name"),
                "name": name,
            })

    # 5. Missing key fields
    canteens_missing_location = [c for c in canteens if not c.get("location_text")]
    campuses_missing_address = [c for c in campuses if not c.get("address")]

    # 6. Source coverage
    schools_without_sources = [s for s in schools if s["id"] not in sources_by_school]
    canteens_with_source_count = sum(1 for s in sources if s.get("canteen_id"))
    campuses_with_source_count = sum(1 for s in sources if s.get("campus_id") and not s.get("canteen_id"))

    # 7. Province distribution
    province_dist = Counter(s.get("province") or "未知" for s in schools)
    top_provinces = province_dist.most_common(20)

    # 8. Campus per school distribution
    campus_counts = Counter(len(v) for v in campuses_by_school.values())

    # 9. Canteen per campus distribution
    canteen_per_campus = Counter(len(v) for v in canteens_by_campus.values())

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "schools": len(schools),
            "campuses": len(campuses),
            "canteens": len(canteens),
            "windows": len(windows),
            "sources": len(sources),
            "batches": len(batches),
        },
        "coverage_issues": {
            "schools_without_campus": {
                "count": len(schools_without_campus),
                "sample": [{"id": s["id"], "name": s["name"], "province": s.get("province")}
                           for s in schools_without_campus[:100]],
            },
            "schools_with_campus_but_no_canteen": {
                "count": len(schools_with_campus_but_no_canteen),
                "sample": [{"id": s["id"], "name": s["name"], "province": s.get("province")}
                           for s in schools_with_campus_but_no_canteen[:50]],
            },
            "campuses_without_canteen": {
                "count": len(campuses_without_canteen),
                "sample": [{"id": c["id"], "name": c["name"],
                            "school_name": c.get("school_name")}
                           for c in campuses_without_canteen[:100]],
            },
            "canteens_without_campus": {
                "count": len(canteens_without_campus),
                "sample": [{"id": c["id"], "name": c["name"],
                            "school_name": c.get("school_name")}
                           for c in canteens_without_campus[:100]],
            },
        },
        "duplicates": {
            "duplicate_campus_names_count": len(duplicate_campus_names),
            "duplicate_campus_names_sample": duplicate_campus_names[:50],
            "duplicate_canteen_names_in_campus_count": len(duplicate_canteen_names),
            "duplicate_canteen_names_in_campus_sample": duplicate_canteen_names[:50],
            "duplicate_orphan_canteen_names_count": len(orphan_canteen_name_dup),
            "duplicate_orphan_canteen_names_sample": orphan_canteen_name_dup[:30],
        },
        "distributions": {
            "campus_status": dict(campus_status),
            "canteen_status": dict(canteen_status),
            "canteen_confidence_level": dict(canteen_confidence),
            "top_provinces": top_provinces,
            "campus_counts_per_school": dict(campus_counts),
            "canteen_counts_per_campus": dict(canteen_per_campus),
        },
        "data_quality": {
            "overly_generic_canteen_names_count": len(overly_generic),
            "overly_generic_canteen_names_sample": overly_generic[:50],
            "canteens_missing_location_count": len(canteens_missing_location),
            "canteens_missing_location_sample": [
                {"id": c["id"], "name": c["name"],
                 "school_name": c.get("school_name"), "campus_name": c.get("campus_name")}
                for c in canteens_missing_location[:50]
            ],
            "campuses_missing_address_count": len(campuses_missing_address),
            "campuses_missing_address_sample": [
                {"id": c["id"], "name": c["name"], "school_name": c.get("school_name")}
                for c in campuses_missing_address[:50]
            ],
            "schools_without_sources_count": len(schools_without_sources),
            "schools_without_sources_sample": [
                {"id": s["id"], "name": s["name"], "province": s.get("province")}
                for s in schools_without_sources[:50]
            ],
            "sources_attached_to_canteens": canteens_with_source_count,
            "sources_attached_to_campuses_only": campuses_with_source_count,
        },
    }

    save("analysis_report", report)
    print(f"Analysis report saved. Highlights:")
    print(f"  Schools without campus: {len(schools_without_campus)}")
    print(f"  Schools with campus but no canteen: {len(schools_with_campus_but_no_canteen)}")
    print(f"  Campuses without canteen: {len(campuses_without_canteen)}")
    print(f"  Canteens without campus: {len(canteens_without_campus)}")
    print(f"  Duplicate campus names: {len(duplicate_campus_names)}")
    print(f"  Duplicate canteen names (within campus): {len(duplicate_canteen_names)}")
    print(f"  Overly generic canteen names: {len(overly_generic)}")


if __name__ == "__main__":
    main()
