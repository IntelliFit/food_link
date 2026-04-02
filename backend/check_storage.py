"""Query storage via Storage API to get real bucket sizes, including folder recursion."""
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv("backend/.env")

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}

def retry_request(method, url, **kwargs):
    for attempt in range(3):
        try:
            r = requests.request(method, url, timeout=30, **kwargs)
            return r
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                raise

def list_buckets():
    r = retry_request("GET", f"{URL}/storage/v1/bucket", headers=HEADERS)
    r.raise_for_status()
    return r.json()

def list_all_objects(bucket_id, prefix="", limit=1000):
    """Recursively list all objects in a bucket."""
    all_objects = []
    offset = 0
    while True:
        body = {
            "prefix": prefix,
            "limit": limit,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }
        r = retry_request(
            "POST",
            f"{URL}/storage/v1/object/list/{bucket_id}",
            headers=HEADERS,
            json=body,
        )
        if r.status_code != 200:
            print(f"  WARN: list {bucket_id}/{prefix} returned {r.status_code}")
            break
        items = r.json()
        if not items:
            break
        for item in items:
            meta = item.get("metadata")
            if meta is None:
                sub_prefix = f"{prefix}{item['name']}/" if prefix else f"{item['name']}/"
                all_objects.extend(list_all_objects(bucket_id, sub_prefix, limit))
            else:
                item["_full_path"] = f"{prefix}{item['name']}"
                all_objects.append(item)
        if len(items) < limit:
            break
        offset += limit
    return all_objects

def p(msg):
    print(msg, flush=True)

if __name__ == "__main__":
    buckets = list_buckets()
    p("=== Buckets ===")
    for b in buckets:
        p(f"  {b['id']} (public={b.get('public', '?')})")

    p("")
    grand_total = 0
    grand_count = 0

    for b in buckets:
        bid = b["id"]
        p(f"Scanning {bid} ...")
        objects = list_all_objects(bid)
        total_bytes = 0
        for obj in objects:
            meta = obj.get("metadata") or {}
            sz = meta.get("size", 0)
            if isinstance(sz, (int, float)):
                total_bytes += sz
        mb = total_bytes / 1048576
        grand_total += total_bytes
        grand_count += len(objects)
        p(f"  => {bid}: {len(objects)} files, {mb:.2f} MB")

    p(f"\n=== GRAND TOTAL: {grand_count} objects, {grand_total/1048576:.2f} MB ({grand_total/1073741824:.3f} GB) ===")
