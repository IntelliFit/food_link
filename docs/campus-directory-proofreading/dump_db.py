#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dump campus directory data from PostgreSQL for proofreading."""

import json
import yaml
import psycopg2
import psycopg2.extras
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / ".." / ".." / "backend" / "config.yaml"


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg["database"]


def connect(cfg):
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg["port"],
        dbname=cfg["name"],
        user=cfg["user"],
        password=cfg["password"],
        sslmode=cfg.get("sslmode", "disable"),
    )


def fetch(conn, sql, params=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params or ())
        return [dict(row) for row in cur.fetchall()]


def to_json(data, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def main():
    cfg = load_config()
    conn = connect(cfg)
    print(f"Connected to {cfg['host']}:{cfg['port']}/{cfg['name']}")

    # 1. Schools
    schools = fetch(conn, """
        SELECT id, name, province, city, level, is_985, is_211, status, logo_url, created_at
        FROM schools
        WHERE status = 'active'
        ORDER BY province NULLS LAST, city NULLS LAST, name
    """)
    to_json(schools, ROOT / "schools.json")
    print(f"Dumped {len(schools)} schools")

    # 2. Campuses
    campuses = fetch(conn, """
        SELECT c.id, c.school_id, c.name, c.aliases, c.address, c.campus_type,
               c.source_url, c.status, c.sort_order, c.created_at, c.updated_at,
               s.name AS school_name
        FROM school_campuses c
        JOIN schools s ON s.id = c.school_id
        WHERE s.status = 'active'
        ORDER BY s.name, c.sort_order, c.name
    """)
    to_json(campuses, ROOT / "campuses.json")
    print(f"Dumped {len(campuses)} campuses")

    # 3. Canteens
    canteens = fetch(conn, """
        SELECT c.id, c.school_id, c.campus_id, c.name, c.aliases, c.location_text,
               c.building_or_floor, c.service_type, c.audience, c.meal_periods,
               c.opening_hours_raw, c.payment_methods, c.halal_or_ethnic,
               c.visitor_available, c.source_url, c.source_org, c.source_type,
               c.confidence_level, c.status, c.review_note, c.sort_order,
               c.created_at, c.updated_at,
               s.name AS school_name,
               sc.name AS campus_name
        FROM school_canteens c
        JOIN schools s ON s.id = c.school_id
        LEFT JOIN school_campuses sc ON sc.id = c.campus_id
        WHERE s.status = 'active'
        ORDER BY s.name, sc.name NULLS LAST, c.sort_order, c.name
    """)
    to_json(canteens, ROOT / "canteens.json")
    print(f"Dumped {len(canteens)} canteens")

    # 4. Windows
    windows = fetch(conn, """
        SELECT w.id, w.school_id, w.campus_id, w.canteen_id, w.name, w.aliases,
               w.floor, w.source_url, w.status, w.sort_order, w.created_at, w.updated_at,
               s.name AS school_name,
               sc.name AS campus_name,
               ct.name AS canteen_name
        FROM canteen_windows w
        JOIN schools s ON s.id = w.school_id
        LEFT JOIN school_campuses sc ON sc.id = w.campus_id
        LEFT JOIN school_canteens ct ON ct.id = w.canteen_id
        WHERE s.status = 'active'
        ORDER BY s.name, sc.name NULLS LAST, ct.name NULLS LAST, w.sort_order, w.name
    """)
    to_json(windows, ROOT / "windows.json")
    print(f"Dumped {len(windows)} windows")

    # 5. Import batches
    batches = fetch(conn, """
        SELECT id, name, region, source_scope, status,
               total_schools, total_campuses, total_canteens, total_windows, total_sources,
               notes, created_by, reviewed_by, reviewed_at, created_at, updated_at
        FROM campus_directory_import_batches
        ORDER BY created_at DESC
    """)
    to_json(batches, ROOT / "import_batches.json")
    print(f"Dumped {len(batches)} import batches")

    # 6. Sources
    sources = fetch(conn, """
        SELECT s.id, s.batch_id, s.school_id, s.campus_id, s.canteen_id,
               s.source_url, s.source_title, s.source_org, s.source_type,
               s.evidence_level, s.evidence_excerpt, s.review_status,
               s.source_published_at, s.collected_at, s.created_at, s.updated_at,
               sch.name AS school_name,
               sc.name AS campus_name,
               ct.name AS canteen_name
        FROM campus_directory_sources s
        JOIN schools sch ON sch.id = s.school_id
        LEFT JOIN school_campuses sc ON sc.id = s.campus_id
        LEFT JOIN school_canteens ct ON ct.id = s.canteen_id
        ORDER BY sch.name, sc.name NULLS LAST, ct.name NULLS LAST, s.created_at DESC
    """)
    to_json(sources, ROOT / "sources.json")
    print(f"Dumped {len(sources)} sources")

    # Summary stats
    summary = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "school_count": len(schools),
        "campus_count": len(campuses),
        "canteen_count": len(canteens),
        "window_count": len(windows),
        "batch_count": len(batches),
        "source_count": len(sources),
    }
    to_json(summary, ROOT / "summary.json")
    print("Done.")


if __name__ == "__main__":
    main()
