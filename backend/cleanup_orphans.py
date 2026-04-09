"""
Find and delete orphan files in food-images bucket.
Orphan = file not referenced by any database record.

Tables that reference food-images:
  - analysis_tasks.image_urls (jsonb array)
  - user_food_records.image_url (text, single URL)
  - public_food_library.image_url (text)

Usage:
  python backend/cleanup_orphans.py --dry-run      # only report
  python backend/cleanup_orphans.py --execute       # actually delete
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import List, Set

import requests
from dotenv import load_dotenv

load_dotenv("backend/.env")

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

STORAGE_HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}

REST_HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
}

BUCKET = "food-images"


def p(msg):
    print(msg, flush=True)


def retry_get(url, headers=None, params=None, retries=3):
    for i in range(retries):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=30)
            return r
        except Exception:
            if i < retries - 1:
                time.sleep(2 ** i)
            else:
                raise


def retry_post(url, headers=None, json_data=None, retries=3):
    for i in range(retries):
        try:
            r = requests.post(url, headers=headers, json=json_data, timeout=30)
            return r
        except Exception:
            if i < retries - 1:
                time.sleep(2 ** i)
            else:
                raise


# --- Step 1: Collect all referenced image filenames from database ---

def paginated_query(table: str, select: str, limit=1000):
    """Paginate through a PostgREST table using offset/limit."""
    base = f"{URL}/rest/v1"
    all_rows = []
    offset = 0
    while True:
        r = retry_get(
            f"{base}/{table}",
            headers=REST_HEADERS,
            params={"select": select, "limit": str(limit), "offset": str(offset)},
        )
        if r.status_code != 200:
            p(f"  WARN: {table} returned {r.status_code}: {r.text[:200]}")
            break
        rows = r.json()
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < limit:
            break
        offset += limit
    return all_rows


def get_referenced_filenames() -> Set[str]:
    """Query all DB tables that reference food-images and extract filenames."""
    referenced = set()
    food_images_prefix = f"{URL}/storage/v1/object/public/{BUCKET}/"

    def extract(url_str):
        """Extract filename from a food-images URL."""
        if not isinstance(url_str, str):
            return None
        if food_images_prefix in url_str:
            return url_str.split(food_images_prefix)[-1]
        if f"/storage/v1/object/{BUCKET}/" in url_str:
            return url_str.split(f"/storage/v1/object/{BUCKET}/")[-1]
        if url_str.endswith(".jpg") or url_str.endswith(".png") or url_str.endswith(".jpeg") or url_str.endswith(".webp"):
            return url_str.rsplit("/", 1)[-1] if "/" in url_str else url_str
        return None

    def extract_all_from_field(value):
        """Extract filenames from a field that could be string, list, or JSON."""
        results = []
        if not value:
            return results
        if isinstance(value, list):
            for item in value:
                fname = extract(item) if isinstance(item, str) else None
                if fname:
                    results.append(fname)
        elif isinstance(value, str):
            if value.startswith("["):
                try:
                    lst = json.loads(value)
                    return extract_all_from_field(lst)
                except Exception:
                    pass
            fname = extract(value)
            if fname:
                results.append(fname)
        return results

    # 1) analysis_tasks: image_url (single) + image_paths (array)
    p("Querying analysis_tasks ...")
    rows = paginated_query("analysis_tasks", "image_url,image_paths")
    for row in rows:
        for col in ["image_url", "image_paths"]:
            for fname in extract_all_from_field(row.get(col)):
                referenced.add(fname)
    p(f"  analysis_tasks: {len(rows)} rows -> {len(referenced)} unique filenames")

    # 2) user_food_records: image_path (single) + image_paths (array)
    p("Querying user_food_records ...")
    before = len(referenced)
    rows = paginated_query("user_food_records", "image_path,image_paths")
    for row in rows:
        for col in ["image_path", "image_paths"]:
            for fname in extract_all_from_field(row.get(col)):
                referenced.add(fname)
    p(f"  user_food_records: {len(rows)} rows -> +{len(referenced) - before} new")

    # 3) public_food_library: image_path (single) + image_paths (array)
    p("Querying public_food_library ...")
    before = len(referenced)
    rows = paginated_query("public_food_library", "image_path,image_paths")
    for row in rows:
        for col in ["image_path", "image_paths"]:
            for fname in extract_all_from_field(row.get(col)):
                referenced.add(fname)
    p(f"  public_food_library: {len(rows)} rows -> +{len(referenced) - before} new")

    p(f"Total referenced filenames: {len(referenced)}")
    return referenced


# --- Step 2: List all files in bucket ---

def list_all_bucket_files() -> List[dict]:
    """List all objects in food-images bucket via Storage API."""
    p("Listing all files in food-images bucket ...")
    all_files = []
    offset = 0
    limit = 1000
    while True:
        r = retry_post(
            f"{URL}/storage/v1/object/list/{BUCKET}",
            headers=STORAGE_HEADERS,
            json_data={
                "prefix": "",
                "limit": limit,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            },
        )
        if r.status_code != 200:
            p(f"  WARN: list returned {r.status_code}")
            break
        items = r.json()
        if not items:
            break
        for item in items:
            meta = item.get("metadata")
            if meta is not None:
                all_files.append(item)
        if len(items) < limit:
            break
        offset += limit
    p(f"  Total files in bucket: {len(all_files)}")
    return all_files


# --- Step 3: Delete orphans ---

def delete_files(filenames: List[str], batch_size=100):
    """Delete files via Storage API in batches."""
    total = len(filenames)
    deleted = 0
    failed = 0
    for i in range(0, total, batch_size):
        batch = filenames[i:i + batch_size]
        prefixed = [f"{name}" for name in batch]
        r = requests.delete(
            f"{URL}/storage/v1/object/{BUCKET}",
            headers=STORAGE_HEADERS,
            json={"prefixes": prefixed},
            timeout=60,
        )
        if r.status_code == 200:
            deleted += len(batch)
        else:
            p(f"  DELETE batch {i}-{i+len(batch)} failed: {r.status_code} {r.text[:200]}")
            failed += len(batch)
        if (i + batch_size) % 500 == 0 or i + batch_size >= total:
            p(f"  Progress: {min(i + batch_size, total)}/{total} (deleted={deleted}, failed={failed})")
    return deleted, failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    if args.execute:
        args.dry_run = False

    referenced = get_referenced_filenames()
    all_files = list_all_bucket_files()

    orphans = []
    orphan_bytes = 0
    referenced_bytes = 0
    for f in all_files:
        name = f["name"]
        meta = f.get("metadata") or {}
        size = meta.get("size", 0)
        if name.startswith("."):
            continue
        if name in referenced:
            referenced_bytes += size
        else:
            orphans.append(f)
            orphan_bytes += size

    p(f"\n=== ANALYSIS ===")
    p(f"Total files: {len(all_files)}")
    p(f"Referenced files: {len(all_files) - len(orphans)}")
    p(f"Referenced size: {referenced_bytes / 1048576:.2f} MB")
    p(f"Orphan files: {len(orphans)}")
    p(f"Orphan size: {orphan_bytes / 1048576:.2f} MB")

    if not orphans:
        p("No orphans to delete.")
        return

    report_path = f"backend/reports/orphan-report-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    report = {
        "summary": {
            "total_files": len(all_files),
            "referenced": len(all_files) - len(orphans),
            "orphans": len(orphans),
            "orphan_size_mb": round(orphan_bytes / 1048576, 2),
            "mode": "dry-run" if args.dry_run else "execute",
        },
        "orphan_files": [
            {
                "name": o["name"],
                "size": (o.get("metadata") or {}).get("size", 0),
                "created_at": o.get("created_at", ""),
            }
            for o in orphans
        ],
    }
    with open(report_path, "w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=2)
    p(f"Report saved to: {report_path}")

    if args.dry_run:
        p("\n[DRY RUN] No files deleted. Use --execute to delete.")
        # Show some samples
        p("\nSample orphan files (first 20):")
        for o in orphans[:20]:
            sz = (o.get("metadata") or {}).get("size", 0)
            p(f"  {o['name']}  ({sz / 1024:.1f} KB)  created={o.get('created_at', '?')}")
    else:
        p(f"\n[EXECUTE] Deleting {len(orphans)} orphan files ...")
        orphan_names = [o["name"] for o in orphans]
        deleted, failed = delete_files(orphan_names)
        p(f"\nDone: deleted={deleted}, failed={failed}")
        p(f"Freed (estimated): {orphan_bytes / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
