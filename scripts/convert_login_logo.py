#!/usr/bin/env python3
"""
Convert assets/image.png to a smaller login logo.
Reads from assets/image.png, resizes to 256x256, and saves to src/assets/login-logo.png.
"""

from PIL import Image
import sys
from pathlib import Path


def main() -> int:
    project_root = Path(__file__).parent.parent
    source_path = project_root / "assets" / "image.png"
    dest_path = project_root / "src" / "assets" / "login-logo.png"

    if not source_path.exists():
        print(f"Error: source image not found: {source_path}", file=sys.stderr)
        return 1

    with Image.open(source_path) as img:
        # Convert to RGBA if needed (handle palette or other modes)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")

        # Resize to 256x256 using Lanczos for quality
        resized = img.resize((256, 256), Image.LANCZOS)

        # Ensure destination directory exists
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Save as PNG
        resized.save(dest_path, "PNG")

    size_kb = dest_path.stat().st_size / 1024
    print(f"Saved: {dest_path} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
