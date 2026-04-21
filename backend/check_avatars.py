"""Quick check user-avatars and icon buckets on COS."""
from collections import defaultdict

from dotenv import load_dotenv

from cos_storage import ICON_BUCKET, USER_AVATARS_BUCKET, list_objects

load_dotenv("backend/.env")


for bucket in [USER_AVATARS_BUCKET, ICON_BUCKET]:
    print(f"--- {bucket} ---", flush=True)
    items = list_objects(bucket)
    top_level_files = [item for item in items if "/" not in item.key]
    top_level_dirs = sorted({item.key.split("/", 1)[0] for item in items if "/" in item.key})
    total_bytes = sum(item.size for item in top_level_files)
    print(f"  Top-level: {len(top_level_files)} files, {len(top_level_dirs)} folders", flush=True)
    print(f"  File size sum: {total_bytes / 1048576:.2f} MB", flush=True)
    for folder in top_level_dirs[:10]:
        print(f"  FOLDER: {folder}/", flush=True)
    for item in top_level_files[:10]:
        print(f"  FILE: {item.key} ({item.size} bytes)", flush=True)

    grouped = defaultdict(list)
    for item in items:
        if "/" in item.key:
            root, _ = item.key.split("/", 1)
            grouped[root].append(item)
    if grouped:
        for root, root_items in list(grouped.items())[:10]:
            root_bytes = sum(item.size for item in root_items)
            print(
                f"  -> {root}/: {len(root_items)} files, 0 subfolders, {root_bytes / 1048576:.2f} MB",
                flush=True,
            )
    print(flush=True)
