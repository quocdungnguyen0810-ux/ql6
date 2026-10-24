"""Công cụ quản lý và kiểm tra tính toàn vẹn bản sao lưu gốc (_backup_origin).

Đảm bảo an toàn tuyệt đối cho dữ liệu gốc của dự án Digital Dự báo Sạt trượt
thông qua đối chiếu mã băm SHA-256 với manifest.
"""

import argparse
import hashlib
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Tuple, TypedDict

logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


class FileManifestEntry(TypedDict):
    """Cấu trúc thông tin của một tệp trong backup_manifest.json."""

    size: int
    sha256: str


class BackupStatusReport(TypedDict):
    """Báo cáo trạng thái đối chiếu giữa thư mục gốc và bản sao lưu."""

    unchanged: List[str]
    modified: List[str]
    missing_in_workspace: List[str]


def compute_sha256(file_path: Path) -> str:
    """Tính mã băm SHA-256 của một tệp tin."""
    hasher = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class BackupManager:
    """Quản lý đối chiếu, xác thực và khôi phục dữ liệu từ _backup_origin."""

    def __init__(self, project_root: Path) -> None:
        """Khởi tạo BackupManager với đường dẫn thư mục gốc dự án."""
        self.project_root: Path = project_root.resolve()
        self.backup_dir: Path = self.project_root / "_backup_origin"
        self.working_tree_dir: Path = self.backup_dir / "working_tree"
        self.manifest_path: Path = self.backup_dir / "backup_manifest.json"

    def load_manifest(self) -> Dict[str, FileManifestEntry]:
        """Đọc và trả về nội dung backup_manifest.json."""
        if not self.manifest_path.exists():
            raise FileNotFoundError(
                f"Không tìm thấy tệp manifest tại: {self.manifest_path}"
            )
        with self.manifest_path.open("r", encoding="utf-8") as f:
            data: Dict[str, FileManifestEntry] = json.load(f)
        return data

    def verify_backup_integrity(self) -> Tuple[bool, List[str]]:
        """Kiểm tra tính toàn vẹn của toàn bộ tệp trong _backup_origin.

        Returns:
            Tuple gồm (trạng thái hợp lệ, danh sách lỗi nếu có).
        """
        manifest = self.load_manifest()
        errors: List[str] = []

        for rel_path, meta in manifest.items():
            backup_file = self.working_tree_dir / rel_path
            if not backup_file.exists():
                errors.append(f"Thiếu tệp sao lưu: {rel_path}")
                continue

            actual_size = backup_file.stat().st_size
            if actual_size != meta["size"]:
                errors.append(
                    f"Sai kích thước tệp sao lưu {rel_path}: "
                    f"kỳ vọng {meta['size']}, thực tế {actual_size}"
                )
                continue

            actual_hash = compute_sha256(backup_file)
            if actual_hash != meta["sha256"]:
                errors.append(
                    f"Sai mã băm SHA-256 tệp sao lưu {rel_path}: "
                    f"kỳ vọng {meta['sha256']}, thực tế {actual_hash}"
                )

        is_valid = len(errors) == 0
        if is_valid:
            logger.info(
                "Đã xác thực %d tệp trong _backup_origin: Toàn vẹn 100%%.",
                len(manifest),
            )
        else:
            for err in errors:
                logger.error(err)
        return is_valid, errors

    def check_workspace_status(self) -> BackupStatusReport:
        """Kiểm tra trạng thái các tệp trong thư mục làm việc so với bản gốc."""
        manifest = self.load_manifest()
        unchanged: List[str] = []
        modified: List[str] = []
        missing: List[str] = []

        for rel_path, meta in manifest.items():
            ws_file = self.project_root / rel_path
            if not ws_file.exists():
                missing.append(rel_path)
                continue

            actual_hash = compute_sha256(ws_file)
            if actual_hash == meta["sha256"]:
                unchanged.append(rel_path)
            else:
                modified.append(rel_path)

        return {
            "unchanged": unchanged,
            "modified": modified,
            "missing_in_workspace": missing,
        }

    def restore_files(
        self, target_files: List[str] | None = None
    ) -> List[str]:
        """Khôi phục các tệp từ _backup_origin về thư mục làm việc.

        Args:
            target_files: Danh sách đường dẫn tương đối cần khôi phục.
                Nếu là None, khôi phục toàn bộ các tệp bị thay đổi hoặc thiếu.

        Returns:
            Danh sách các tệp đã được khôi phục thành công.
        """
        is_valid, errors = self.verify_backup_integrity()
        if not is_valid:
            raise RuntimeError(
                f"Bản sao lưu gốc không toàn vẹn, hủy khôi phục: {errors}"
            )

        manifest = self.load_manifest()
        if target_files is None:
            status = self.check_workspace_status()
            files_to_restore = (
                status["modified"] + status["missing_in_workspace"]
            )
        else:
            files_to_restore = target_files

        restored: List[str] = []
        for rel_path in files_to_restore:
            if rel_path not in manifest:
                raise KeyError(
                    f"Tệp '{rel_path}' không tồn tại trong backup_manifest.json"
                )
            src = self.working_tree_dir / rel_path
            dst = self.project_root / rel_path
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            restored.append(rel_path)
            logger.info("Đã khôi phục tệp từ bản gốc: %s", rel_path)

        return restored


def main() -> int:
    """Hàm thực thi dòng lệnh (CLI) cho công cụ quản lý sao lưu."""
    parser = argparse.ArgumentParser(
        description="Công cụ kiểm tra và khôi phục bản sao lưu _backup_origin."
    )
    parser.add_argument(
        "action",
        choices=["status", "verify", "restore"],
        help="Hành động: status (trạng thái), verify (kiểm tra), restore (khôi phục)",
    )
    parser.add_argument(
        "--files",
        nargs="*",
        default=None,
        help="Danh sách tệp cụ thể cần khôi phục (chỉ dùng với restore)",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    manager = BackupManager(project_root)

    if args.action == "verify":
        valid, _ = manager.verify_backup_integrity()
        return 0 if valid else 1

    if args.action == "status":
        report = manager.check_workspace_status()
        logger.info(
            "Tổng kết trạng thái: %d nguyên vẹn, %d đã sửa đổi, %d bị thiếu.",
            len(report["unchanged"]),
            len(report["modified"]),
            len(report["missing_in_workspace"]),
        )
        for mod in report["modified"]:
            logger.info("  [ĐÃ SỬA ĐỔI] %s", mod)
        for mis in report["missing_in_workspace"]:
            logger.warning("  [BỊ THIẾU]   %s", mis)
        return 0

    if args.action == "restore":
        restored = manager.restore_files(args.files)
        logger.info("Hoàn tất khôi phục %d tệp.", len(restored))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
