"""Bộ Unit Test (unittest) kiểm thử mô hình địa kỹ thuật on_dinh.js và các công cụ kiểm toán."""

import unittest
from pathlib import Path

from tools.backup_manager import BackupManager
from tools.geotech_validator import (
    check_all_regions_soil_physics,
    check_fs_monotonicity_and_back_analysis,
    check_landslide_duplicates_in_html,
    evaluate_on_dinh_via_node,
    validate_soil_parameters,
)


class TestGeotechValidatorAndOnDinh(unittest.TestCase):
    """Kiểm thử toàn diện các ràng buộc vật lý địa kỹ thuật và mô hình on_dinh.js."""

    @classmethod
    def setUpClass(cls) -> None:
        """Thiết lập đường dẫn thư mục gốc của dự án."""
        cls.project_root = Path(__file__).resolve().parent.parent
        cls.js_path = cls.project_root / "on_dinh.js"
        cls.html_path = cls.project_root / "index.html"

    def test_backup_integrity(self) -> None:
        """Đảm bảo thư mục _backup_origin nguyên vẹn 100% và chỉ có các tệp được phép thay đổi."""
        manager = BackupManager(self.project_root)
        if not manager.manifest_path.exists():
            self.skipTest("Bỏ qua kiểm tra _backup_origin trên môi trường CI đám mây.")
        is_valid, errors = manager.verify_backup_integrity()
        self.assertTrue(is_valid, f"Lỗi toàn vẹn _backup_origin: {errors}")

        status = manager.check_workspace_status()
        self.assertIn("on_dinh.js", status["modified"])
        self.assertEqual(len(status["missing_in_workspace"]), 0)

    def test_soil_physical_constraints_all_regions(self) -> None:
        """Kiểm tra thông số đất/đá trong CFG_VUNG thỏa mãn các bất đẳng thức vật lý."""
        ok, errors = check_all_regions_soil_physics(self.js_path)
        self.assertTrue(ok, f"Phát hiện vi phạm thông số vật lý đất/đá: {errors}")

    def test_validate_soil_parameters_rejects_invalid_physics(self) -> None:
        """Kiểm tra hàm validate_soil_parameters bắt đúng các trường hợp vi phạm vật lý."""
        invalid_params = {
            "gamma": 21.0,
            "gamma_sat": 20.0,  # Vi phạm gamma < gamma_sat
            "theta_r": 0.50,
            "n": 0.45,          # Vi phạm theta_r < n
            "a_vg": -0.01,      # Vi phạm a_vg > 0
            "n_vg": 0.95,       # Vi phạm n_vg > 1
            "c": 10.0,
            "phi": 25.0,
        }
        ok, errors = validate_soil_parameters(invalid_params, "TestInvalid")
        self.assertFalse(ok)
        self.assertEqual(len(errors), 4)

    def test_fs_bang_strict_monotonicity_and_chuoi_fs_sau(self) -> None:
        """Kiểm tra tính đơn điệu nghiêm ngặt của fsBang(beta, H, m) và chuoiFSSau qua Node.js."""
        ok, errors = check_fs_monotonicity_and_back_analysis(self.js_path)
        self.assertTrue(ok, f"Lỗi đơn điệu hoặc phân tích ngược trong on_dinh.js: {errors}")

        node_res = evaluate_on_dinh_via_node(self.js_path)
        for vung, info in node_res["regions"].items():
            self.assertEqual(info["viol_beta"], 0, f"Vùng {vung}: vi phạm đơn điệu beta")
            self.assertEqual(info["viol_H"], 0, f"Vùng {vung}: vi phạm đơn điệu H")
            self.assertEqual(info["viol_m"], 0, f"Vùng {vung}: vi phạm đơn điệu m")

            # Sườn thoải 11.8°: FS không bị ép giảm về FS_ref (1.3)
            self.assertGreater(
                info["gentle"]["seq_first_FS"],
                2.0,
                f"Vùng {vung}: FS sườn thoải 11.8° phải > 2.0 (thực tế: {info['gentle']['seq_first_FS']})",
            )
            # Sườn dốc 40°: f0 < FS_ref nên FS ở trạng thái khô (m=0) phải được nâng lên >= FS_ref
            self.assertGreaterEqual(
                info["steep"]["seq_first_FS"],
                info["steep"]["FS_ref"],
                f"Vùng {vung}: FS sườn dốc 40° khi m=0 phải >= FS_ref",
            )

    def test_landslide_duplicates_check(self) -> None:
        """Kiểm tra hàm rà soát tọa độ trùng lặp trong DATA.landslides của index.html."""
        ok, duplicates = check_landslide_duplicates_in_html(self.html_path)
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(duplicates, list)


if __name__ == "__main__":
    unittest.main()
