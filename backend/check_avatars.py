"""Quick check user-avatars and icon buckets."""
import os
import requests
from dotenv import load_dotenv

load_dotenv("backend/.env")
URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def list_page(bucket, prefix="", limit=1000, offset=0):
    r = requests.post(
        f"{URL}/storage/v1/object/list/{bucket}",
        headers=H,
        json={"prefix": prefix, "limit": limit, "offset": offset,
              "sortBy": {"column": "name", "order": "asc"}},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

for bucket in ["user-avatars", "icon"]:
    print(f"--- {bucket} ---", flush=True)
    items = list_page(bucket)
    folders = [i for i in items if i.get("metadata") is None]
    files = [i for i in items if i.get("metadata") is not None]
    total_bytes = sum(i["metadata"].get("size", 0) for i in files)
    print(f"  Top-level: {len(files)} files, {len(folders)} folders", flush=True)
    print(f"  File size sum: {total_bytes / 1048576:.2f} MB", flush=True)
    for f in folders[:10]:
        print(f"  FOLDER: {f['name']}/", flush=True)
    for f in files[:10]:
        sz = f["metadata"].get("size", 0)
        print(f"  FILE: {f['name']} ({sz} bytes)", flush=True)

    if folders:
        for fld in folders:
            fname = fld["name"]
            sub = list_page(bucket, prefix=f"{fname}/")
            sub_files = [i for i in sub if i.get("metadata") is not None]
            sub_folders = [i for i in sub if i.get("metadata") is None]
            sub_bytes = sum(i["metadata"].get("size", 0) for i in sub_files)
            print(f"  -> {fname}/: {len(sub_files)} files, {len(sub_folders)} subfolders, {sub_bytes/1048576:.2f} MB", flush=True)
    print(flush=True)
