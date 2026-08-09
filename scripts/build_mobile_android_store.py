#!/usr/bin/env python3
"""Build signed Android APK and AAB artifacts without uploading them."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps" / "mobile"
ANDROID = MOBILE / "android"
DIST = ROOT / "dist" / "mobile-store"


def run(command: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build signed Food Link Android store artifacts")
    parser.add_argument("--apk-only", action="store_true", help="Build only the installable APK")
    parser.add_argument("--aab-only", action="store_true", help="Build only the Android App Bundle")
    args = parser.parse_args()
    if args.apk_only and args.aab_only:
        parser.error("--apk-only and --aab-only cannot be used together")

    app_config = json.loads((MOBILE / "app.json").read_text(encoding="utf-8"))["expo"]
    root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = str(root_package["version"])
    build_number = int(app_config["android"]["versionCode"])

    env = os.environ.copy()
    env["NODE_ENV"] = "production"
    env["EXPO_PUBLIC_API_BASE_URL"] = "https://api.healthymax.cn"
    env["EXPO_PUBLIC_SHARE_BASE_URL"] = "https://healthymax.cn"
    env["EXPO_PUBLIC_WECHAT_APP_ID"] = str(app_config["extra"]["wechatAppId"])

    gradlew = "gradlew.bat" if os.name == "nt" else "./gradlew"
    tasks = ["assembleRelease", "bundleRelease"]
    if args.apk_only:
        tasks = ["assembleRelease"]
    elif args.aab_only:
        tasks = ["bundleRelease"]

    run([str(ANDROID / gradlew), *tasks], cwd=ANDROID, env=env)
    DIST.mkdir(parents=True, exist_ok=True)

    outputs: list[Path] = []
    if "assembleRelease" in tasks:
        source = ANDROID / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
        target = DIST / f"foodlink-{version}-{build_number}-release.apk"
        shutil.copy2(source, target)
        outputs.append(target)
    if "bundleRelease" in tasks:
        source = ANDROID / "app" / "build" / "outputs" / "bundle" / "release" / "app-release.aab"
        target = DIST / f"foodlink-{version}-{build_number}-release.aab"
        shutil.copy2(source, target)
        outputs.append(target)

    print("Store artifacts:")
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
