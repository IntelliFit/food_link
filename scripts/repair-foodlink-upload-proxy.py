#!/usr/bin/env python3
"""Run as root on the FoodLink host to isolate Nginx upload buffering."""

import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import tempfile

CONFIG = Path("/etc/nginx/conf.d/foodlink.conf")
TEMP_DIR = Path("/var/lib/nginx/foodlink-body")
TMPFILES = Path("/etc/tmpfiles.d/foodlink-nginx-upload.conf")
HOSTS = {"api.healthymax.cn", "dev.api.healthymax.cn"}


def configure(text):
    edits = []
    found = set()
    for match in re.finditer(r"(?m)^server\s*\{", text):
        start = match.start()
        depth = 1
        end = match.end()
        while end < len(text) and depth:
            depth += (text[end] == "{") - (text[end] == "}")
            end += 1
        if depth:
            raise RuntimeError("Unclosed server block")
        block = text[start:end]
        host_match = re.search(r"(?m)^\s*server_name\s+([^;]+);", block)
        if not host_match or host_match[1].strip() not in HOSTS:
            continue
        if not re.search(r"(?m)^\s*listen\s+[^;]*\b443\b", block):
            continue
        host = host_match[1].strip()
        if host in found:
            raise RuntimeError("Duplicate HTTPS host: " + host)
        found.add(host)
        existing = re.findall(r"(?m)^\s*client_body_temp_path\s+([^;]+);", block)
        if existing:
            if existing != [str(TEMP_DIR)]:
                raise RuntimeError("Unexpected upload directory for " + host)
            continue
        directive = "\n    # 食探上传使用独立目录，避免公共临时目录权限影响图片上传。\n    client_body_temp_path " + str(TEMP_DIR) + ";"
        offset = start + host_match.end()
        edits.append((offset, directive))
    if found != HOSTS:
        raise RuntimeError("Expected both FoodLink HTTPS API hosts")
    for offset, directive in reversed(edits):
        text = text[:offset] + directive + text[offset:]
    return text


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Run as root on the FoodLink server")
    if CONFIG.is_symlink() or not CONFIG.is_file():
        raise RuntimeError("Expected a regular FoodLink Nginx config")
    if TEMP_DIR.is_symlink() or TEMP_DIR.resolve().parent != Path("/var/lib/nginx"):
        raise RuntimeError("Unexpected upload directory")
    if TMPFILES.is_symlink():
        raise RuntimeError("Unexpected tmpfiles symlink")
    original = CONFIG.read_bytes()
    updated = configure(original.decode("utf-8")).encode("utf-8")
    rule = "d " + str(TEMP_DIR) + " 0700 www-data www-data -\n"
    if TMPFILES.exists() and TMPFILES.read_text() != rule:
        raise RuntimeError("Existing tmpfiles configuration differs")
    user = pwd.getpwnam("www-data")
    backup_root = Path("/var/backups/foodlink-nginx-upload")
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="repair-", dir=backup_root))
    shutil.copy2(CONFIG, backup / "foodlink.conf")
    had_tmpfiles = TMPFILES.exists()
    if had_tmpfiles:
        shutil.copy2(TMPFILES, backup / TMPFILES.name)
    TEMP_DIR.mkdir(mode=0o700, exist_ok=True)
    os.chown(TEMP_DIR, user.pw_uid, user.pw_gid)
    os.chmod(TEMP_DIR, 0o700)
    if CONFIG.read_bytes() != original:
        raise RuntimeError("Nginx config changed concurrently; retry inspection")
    try:
        if updated != original:
            CONFIG.write_bytes(updated)
        TMPFILES.write_text(rule)
        os.chmod(TMPFILES, 0o644)
        subprocess.run(["nginx", "-t"], check=True)
        if updated != original:
            subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except Exception:
        shutil.copy2(backup / "foodlink.conf", CONFIG)
        if had_tmpfiles:
            shutil.copy2(backup / TMPFILES.name, TMPFILES)
        else:
            TMPFILES.unlink(missing_ok=True)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
        raise
    print(json.dumps({"hosts": sorted(HOSTS), "temp_directory": str(TEMP_DIR),
                      "backup": str(backup), "config_changed": updated != original,
                      "sha256": hashlib.sha256(updated).hexdigest()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
