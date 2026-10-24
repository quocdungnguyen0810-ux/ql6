"""Công cụ tự động đồng bộ dữ liệu cảnh báo từ kho gốc (Upstream) và kiểm định Địa kỹ thuật.

Cho phép kéo thư mục `data/` và `lao-cai/data/` mới nhất từ kho gốc của PGS. TS. Nguyễn Châu Lân
(https://github.com/chaulan1981/Du-bao-sat-truot-QL6.git), chạy kiểm tra ràng buộc vật lý
(Physical Plausibility) qua `tools/geotech_validator.py`, và tự động commit + push lên GitHub `ql6`.
"""

from __future__ import annotations

import argparse
import datetime
import logging
import subprocess
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("SyncUpstream")

UPSTREAM_URL = "https://github.com/chaulan1981/Du-bao-sat-truot-QL6.git"


def run_cmd(cmd: list[str], cwd: Path) -> str:
    """Thực thi lệnh hệ thống và trả về stdout."""
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def sync_from_upstream(project_root: Path, auto_push: bool = True) -> int:
    """Đồng bộ dữ liệu từ upstream/main, kiểm định địa kỹ thuật và đẩy lên origin/main."""
    remotes = run_cmd(["git", "remote"], project_root).splitlines()
    if "upstream" not in remotes:
        logger.info("Thêm remote upstream: %s", UPSTREAM_URL)
        run_cmd(["git", "remote", "add", "upstream", UPSTREAM_URL], project_root)

    logger.info("Đang tải dữ liệu mới nhất từ upstream/main...")
    run_cmd(["git", "fetch", "upstream", "main", "--depth=1"], project_root)

    logger.info("Cập nhật thư mục data/ và lao-cai/data/ từ upstream/main (giữ nguyên mã nguồn đã nâng cấp)...")
    run_cmd(["git", "checkout", "upstream/main", "--", "data/", "lao-cai/data/"], project_root)

    logger.info("Chạy kiểm định ràng buộc vật lý Địa kỹ thuật (geotech_validator.py)...")
    subprocess.run([sys.executable, "tools/geotech_validator.py"], cwd=project_root, check=True)

    status = run_cmd(["git", "status", "--porcelain", "data/", "lao-cai/data/"], project_root)
    if not status:
        logger.info("Dữ liệu cảnh báo đã ở trạng thái mới nhất, không cần tạo commit mới.")
        return 0

    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    run_cmd(["git", "add", "data/", "lao-cai/data/"], project_root)
    run_cmd(["git", "commit", "-m", f"Đồng bộ dữ liệu tự động {now_utc}"], project_root)
    logger.info("Đã tạo commit đồng bộ dữ liệu: %s", now_utc)

    if auto_push:
        logger.info("Đang đẩy dữ liệu mới lên origin/main...")
        run_cmd(["git", "push", "origin", "main"], project_root)
        logger.info("Đã đẩy thành công lên GitHub (origin/main).")

    return 0


def main() -> int:
    """Điểm vào CLI của công cụ đồng bộ dữ liệu."""
    parser = argparse.ArgumentParser(description="Đồng bộ dữ liệu từ upstream và kiểm định địa kỹ thuật.")
    parser.add_argument("--no-push", action="store_true", help="Chỉ đồng bộ và commit cục bộ, không push.")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    return sync_from_upstream(project_root, auto_push=not args.no_push)


if __name__ == "__main__":
    sys.exit(main())
