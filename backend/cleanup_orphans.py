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
from datetime import datetime, timezone
from typing import List, Set

from dotenv import load_dotenv
from cos_storage import FOOD_IMAGES_BUCKET, delete_object, list_objects, resolve_object_key
from database import get_database_client

load_dotenv("backend/.env")

BUCKET = FOOD_IMAGES_BUCKET


def p(msg):
    print(msg, flush=True)


# --- Step 1: Collect all referenced image filenames from database ---

def paginated_query(table: str, select: str, limit=1000):
    """通过 PostgreSQL 查询客户端按 offset/limit 分页读取表。"""
    db = get_database_client()
    columns = ",".join(part.strip() for part in select.split(",") if part.strip())
    all_rows = []
    offset = 0
    while True:
        result = (
            db.table(table)
            .select(columns)
            .range(offset, offset + limit - 1)
            .execute()
        )
        rows = list(result.data or [])
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

    def extract(url_str):
        return resolve_object_key(url_str, BUCKET)

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
    """List all objects in food-images bucket via COS."""
    p("Listing all files in food-images bucket ...")
    all_files = []
    for item in list_objects(BUCKET):
        all_files.append(
            {
                "name": item.key,
                "metadata": {"size": item.size},
            }
        )
    p(f"  Total files in bucket: {len(all_files)}")
    return all_files


# --- Step 3: Delete orphans ---

def delete_files(filenames: List[str], batch_size=100):
    """Delete files via COS in batches."""
    total = len(filenames)
    deleted = 0
    failed = 0
    for i in range(0, total, batch_size):
        batch = filenames[i:i + batch_size]
        for name in batch:
            try:
                delete_object(BUCKET, name)
                deleted += 1
            except Exception as exc:  # noqa: BLE001
                p(f"  DELETE {name} failed: {exc}")
                failed += 1
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
