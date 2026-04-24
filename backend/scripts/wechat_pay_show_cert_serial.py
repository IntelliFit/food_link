#!/usr/bin/env python3
"""
从「商户 API 证书」PEM 文件读取序列号，用于核对 WECHAT_PAY_SERIAL_NO。

用法（在 backend 目录下，证书与 apiclient_key.pem 为同一套）：
  python scripts/wechat_pay_show_cert_serial.py /path/to/apiclient_cert.pem

将输出的「序列号(HEX)」与微信商户平台「账户中心 → API 安全 → 商户API证书」中的
证书序列号对比，须完全一致（仅大小写/空格可忽略，.env 里已做去空格、转大写）。

注意：不要用「微信支付平台证书」的序列号填 WECHAT_PAY_SERIAL_NO。
"""
from __future__ import annotations

import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.backends import default_backend


def main() -> None:
    if len(sys.argv) < 2:
        print("用法: python scripts/wechat_pay_show_cert_serial.py <apiclient_cert.pem 路径>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1]).expanduser().resolve()
    if not path.is_file():
        print(f"文件不存在: {path}", file=sys.stderr)
        sys.exit(1)

    pem = path.read_bytes()
    cert = x509.load_pem_x509_certificate(pem, default_backend())
    n = cert.serial_number
    hex_upper = format(n, "X")
    print("证书文件:", path)
    print("序列号(十进制):", n)
    print("序列号(HEX 大写，推荐与 .env 中 WECHAT_PAY_SERIAL_NO 对比):", hex_upper)
    print()
    print("若与商户平台不一致：请确认打开的是「商户API证书」而非「平台证书」。")


if __name__ == "__main__":
    main()
