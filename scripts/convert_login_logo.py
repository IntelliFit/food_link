#!/usr/bin/env python3
"""
Convert login logo source image to a smaller login logo.

Default source is the COS-hosted original (wechat/source-login-logo.png).
Reads source, resizes to 256x256, and saves to apps/wechat/src/assets/login-logo.png.

Override source with --source for local files.
"""

from PIL import Image
import sys
from io import BytesIO
from pathlib import Path

import requests

DEFAULT_SOURCE_URL = "https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png"


def load_source_image(source: Path | None, source_url: str) -> Image.Image:
    if source is not None:
        if not source.exists():
            raise FileNotFoundError(f"source image not found: {source}")
        return Image.open(source)

    response = requests.get(source_url, timeout=30)
    response.raise_for_status()
    return Image.open(BytesIO(response.content))


def main() -> int:
    project_root = Path(__file__).parent.parent
    wechat_app_root = project_root / "apps" / "wechat"
    dest_path = wechat_app_root / "src" / "assets" / "login-logo.png"

    import argparse

    parser = argparse.ArgumentParser(description="Generate login-logo.png from source image")
    parser.add_argument("--source", type=Path, default=None, help="local source PNG path")
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL, help="remote source PNG URL")
    args = parser.parse_args()

    try:
        img = load_source_image(args.source, args.source_url)
    except FileNotFoundError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1
    except requests.RequestException as err:
        print(f"Error: failed to download source image: {err}", file=sys.stderr)
        return 1

    with img:
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
