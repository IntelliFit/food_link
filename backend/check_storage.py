"""Query COS buckets to get real object counts and sizes."""
from dotenv import load_dotenv

from cos_storage import (
    FOOD_IMAGES_BUCKET,
    HEALTH_REPORTS_BUCKET,
    ICON_BUCKET,
    USER_AVATARS_BUCKET,
    is_private_bucket,
    list_objects,
)

load_dotenv("backend/.env")


def p(msg):
    print(msg, flush=True)


if __name__ == "__main__":
    buckets = [
        FOOD_IMAGES_BUCKET,
        HEALTH_REPORTS_BUCKET,
        USER_AVATARS_BUCKET,
        ICON_BUCKET,
    ]
    p("=== Buckets ===")
    for bucket in buckets:
        p(f"  {bucket} (private={is_private_bucket(bucket)})")

    p("")
    grand_total = 0
    grand_count = 0

    for bucket in buckets:
        p(f"Scanning {bucket} ...")
        objects = list_objects(bucket)
        total_bytes = sum(obj.size for obj in objects)
        mb = total_bytes / 1048576
        grand_total += total_bytes
        grand_count += len(objects)
        p(f"  => {bucket}: {len(objects)} files, {mb:.2f} MB")

    p(f"\n=== GRAND TOTAL: {grand_count} objects, {grand_total/1048576:.2f} MB ({grand_total/1073741824:.3f} GB) ===")
