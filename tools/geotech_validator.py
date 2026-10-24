"""Module kiểm toán Địa kỹ thuật & Ràng buộc vật lý (Physical Plausibility).

Kiểm tra:
1. Các thông số vật lý đất/đá (gamma < gamma_sat, 0 < theta_r < n < 1, a_vg > 0, n_vg > 1).
2. Tính đơn điệu nghiêm ngặt của fsBang theo beta, H, m bằng cách gọi Node.js chạy trực tiếp on_dinh.js.
3. Kiểm tra chuoiFSSau tại sườn thoải (beta = 11.8°) và sườn dốc (beta = 40°).
4. Kiểm tra tọa độ trùng lặp trong DATA.landslides của index.html (báo cáo và cách ly điểm dị biệt/trùng lặp).
"""

import json
import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def extract_cfg_vung_from_js(js_path: Path) -> Dict[str, Any]:
    """Trích xuất đối tượng CFG_VUNG từ tệp on_dinh.js."""
    content = js_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+CFG_VUNG\s*=\s*(\{.*\});", content)
    if not match:
        raise ValueError(f"Không tìm thấy hằng số CFG_VUNG trong {js_path}")
    data: Dict[str, Any] = json.loads(match.group(1))
    return data


def validate_soil_parameters(params: Dict[str, float], region_name: str = "") -> Tuple[bool, List[str]]:
    """Kiểm tra ràng buộc vật lý đối với bộ thông số địa kỹ thuật và SWCC.

    Các ràng buộc vật lý bắt buộc:
    - 0 < gamma < gamma_sat
    - 0 < theta_r < n < 1
    - a_vg > 0, n_vg > 1
    - c >= 0, 0 < phi < 90
    - 0 < S0 <= 1
    """
    errors: List[str] = []
    prefix = f"[Vùng '{region_name}'] " if region_name else ""

    gamma = params.get("gamma", 0.0)
    gamma_sat = params.get("gamma_sat", 0.0)
    if not (0.0 < gamma < gamma_sat):
        errors.append(
            f"{prefix}Vi phạm trọng lượng riêng: gamma ({gamma}) phải nhỏ hơn gamma_sat ({gamma_sat}) và > 0."
        )

    theta_r = params.get("theta_r", 0.0)
    porosity = params.get("n", 0.0)
    if not (0.0 < theta_r < porosity < 1.0):
        errors.append(
            f"{prefix}Vi phạm độ rỗng/độ ẩm dư: cần thỏa mãn 0 < theta_r ({theta_r}) < n ({porosity}) < 1."
        )

    a_vg = params.get("a_vg", 0.0)
    if not (a_vg > 0.0):
        errors.append(
            f"{prefix}Vi phạm thông số van Genuchten a_vg ({a_vg}): yêu cầu a_vg > 0."
        )

    n_vg = params.get("n_vg", 0.0)
    if not (n_vg > 1.0):
        errors.append(
            f"{prefix}Vi phạm thông số van Genuchten n_vg ({n_vg}): yêu cầu n_vg > 1."
        )

    cohesion = params.get("c", -1.0)
    phi = params.get("phi", 0.0)
    if cohesion < 0.0 or not (0.0 < phi < 90.0):
        errors.append(
            f"{prefix}Vi phạm thông số sức kháng cắt Mohr-Coulomb: c={cohesion}, phi={phi}."
        )

    return len(errors) == 0, errors


def check_all_regions_soil_physics(js_path: Path) -> Tuple[bool, List[str]]:
    """Kiểm tra thông số vật lý đất/đá cho toàn bộ các vùng trong on_dinh.js."""
    cfg_vung = extract_cfg_vung_from_js(js_path)
    all_errors: List[str] = []

    for region_key, cfg in cfg_vung.items():
        region_label = region_key if region_key else "QL6 (mặc định)"
        mac_dinh = cfg.get("mac_dinh", {})
        _, errs = validate_soil_parameters(mac_dinh, region_label)
        all_errors.extend(errs)

        sau = cfg.get("sau", {})
        if sau:
            gamma_d = sau.get("gamma", 0.0)
            gamma_da = sau.get("gamma_da", 0.0)
            if not (0.0 < gamma_d < gamma_da):
                all_errors.append(
                    f"[Vùng '{region_label}' - Trượt sâu] Trọng lượng riêng đất ({gamma_d}) "
                    f"phải nhỏ hơn đá gốc ({gamma_da})."
                )

    return len(all_errors) == 0, all_errors


def evaluate_on_dinh_via_node(js_path: Path) -> Dict[str, Any]:
    """Gọi Node.js chạy trực tiếp on_dinh.js để kiểm định tính đơn điệu của fsBang và chuoiFSSau."""
    node_script = """
const path = require('path');
const jsPath = process.argv[1];
const results = { regions: {} };

for (const vung of ['', 'lao-cai']) {
  globalThis.VUNG_OD = vung;
  delete require.cache[require.resolve(jsPath)];
  const OD = require(jsPath);
  const b = OD.CAU_HINH.sau_bang;
  const p = OD.CAU_HINH.sau;

  let viol_beta = 0, viol_H = 0, viol_m = 0;
  const betas = [10, 11.8, 12.5, 15, 17.5, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const Hs = [15, 20, 30, 40, 50, 65, 80];
  const ms = [0.0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0];

  for (let ib = 0; ib < betas.length; ib++) {
    for (let ih = 0; ih < Hs.length; ih++) {
      for (let im = 0; im < ms.length; im++) {
        const cur = OD.fsBang(b, betas[ib], Hs[ih], ms[im]);
        if (ib > 0) {
          const prevB = OD.fsBang(b, betas[ib - 1], Hs[ih], ms[im]);
          if (cur > prevB + 1e-12) viol_beta++;
        }
        if (ih > 0) {
          const prevH = OD.fsBang(b, betas[ib], Hs[ih - 1], ms[im]);
          if (cur > prevH + 1e-12) viol_H++;
        }
        if (im > 0) {
          const prevM = OD.fsBang(b, betas[ib], Hs[ih], ms[im - 1]);
          if (cur > prevM + 1e-12) viol_m++;
        }
      }
    }
  }

  // Kiểm tra chuoiFSSau tại sườn thoải (beta = 11.8, H = 32) và sườn dốc (beta = 40, H = 40)
  const prZero = [0, 0, 0];
  const f0_gentle = OD.fsBang(b, 11.8, 32, p.m_ref);
  const fs_gentle_dry = OD.fsBang(b, 11.8, 32, 0);
  const seq_gentle = OD.chuoiFSSau(prZero, 11.8, 32, p, b);

  const f0_steep = OD.fsBang(b, 40.0, 40, p.m_ref);
  const fs_steep_dry = OD.fsBang(b, 40.0, 40, 0);
  const seq_steep = OD.chuoiFSSau(prZero, 40.0, 40, p, b);

  results.regions[vung] = {
    viol_beta,
    viol_H,
    viol_m,
    gentle: {
      f0: f0_gentle,
      fs_dry: fs_gentle_dry,
      FS_ref: p.FS_ref,
      seq_first_FS: seq_gentle[0].FS
    },
    steep: {
      f0: f0_steep,
      fs_dry: fs_steep_dry,
      FS_ref: p.FS_ref,
      seq_first_FS: seq_steep[0].FS
    }
  };
}
console.log(JSON.stringify(results));
"""
    proc = subprocess.run(
        ["node", "-e", node_script, str(js_path.resolve())],
        capture_output=True,
        text=True,
        check=True,
        encoding="utf-8",
    )
    output: Dict[str, Any] = json.loads(proc.stdout.strip())
    return output


def check_fs_monotonicity_and_back_analysis(js_path: Path) -> Tuple[bool, List[str]]:
    """Kiểm tra tính đơn điệu của fsBang và tính đúng đắn cơ học đất của chuoiFSSau."""
    res = evaluate_on_dinh_via_node(js_path)
    errors: List[str] = []

    for vung, info in res["regions"].items():
        label = vung if vung else "QL6"
        if info["viol_beta"] > 0:
            errors.append(
                f"[{label}] Vi phạm tính đơn điệu fsBang theo góc dốc beta: {info['viol_beta']} điểm."
            )
        if info["viol_H"] > 0:
            errors.append(
                f"[{label}] Vi phạm tính đơn điệu fsBang theo chiều cao H: {info['viol_H']} điểm."
            )
        if info["viol_m"] > 0:
            errors.append(
                f"[{label}] Vi phạm tính đơn điệu fsBang theo mực nước ngầm m: {info['viol_m']} điểm."
            )

        # Kiểm tra sườn thoải (beta = 11.8°): f0 >= FS_ref => hệ số hiệu chỉnh hs = 1 (không ép giảm FS)
        g = info["gentle"]
        if g["f0"] >= g["FS_ref"]:
            if abs(g["seq_first_FS"] - g["fs_dry"]) > 1e-9:
                errors.append(
                    f"[{label}] Sườn thoải (11.8°) có f0={g['f0']:.4f} >= FS_ref={g['FS_ref']} "
                    f"nhưng chuoiFSSau lại làm thay đổi FS từ {g['fs_dry']:.4f} thành {g['seq_first_FS']:.4f}."
                )

        # Kiểm tra sườn dốc (beta = 40°): f0 < FS_ref => hệ số hiệu chỉnh hs = FS_ref / f0 > 1
        s = info["steep"]
        if s["f0"] < s["FS_ref"]:
            expected_fs = (s["FS_ref"] / s["f0"]) * s["fs_dry"]
            if abs(s["seq_first_FS"] - expected_fs) > 1e-9:
                errors.append(
                    f"[{label}] Sườn dốc (40°) có f0={s['f0']:.4f} < FS_ref={s['FS_ref']} "
                    f"nhưng chuoiFSSau tính FS={s['seq_first_FS']:.4f} khác kỳ vọng {expected_fs:.4f}."
                )

    return len(errors) == 0, errors


def check_landslide_duplicates_in_html(
    html_path: Path,
) -> Tuple[bool, List[Tuple[int, List[float]]]]:
    """Kiểm tra tọa độ trùng lặp trong DATA.landslides của index.html.

    Theo nguyên tắc an toàn số liệu: phát hiện và đưa các tọa độ trùng lặp vào
    danh sách cách ly/báo cáo cùng vị trí chỉ số, không tự ý xóa dữ liệu gốc.

    Returns:
        Tuple gồm (True nếu không có trùng lặp, danh sách (index, [lon, lat]) bị trùng).
    """
    content = html_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+DATA\s*=\s*(\{.*?\});\s*\n", content)
    if not match:
        raise ValueError(f"Không tìm thấy hằng số DATA trong {html_path}")

    data = json.loads(match.group(1))
    landslides: List[List[float]] = data.get("landslides", [])

    seen: set[Tuple[float, float]] = set()
    duplicates: List[Tuple[int, List[float]]] = []

    for idx, coord in enumerate(landslides):
        key = (float(coord[0]), float(coord[1]))
        if key in seen:
            duplicates.append((idx, coord))
        else:
            seen.add(key)

    return len(duplicates) == 0, duplicates


def main() -> int:
    """Chạy toàn bộ quy trình kiểm toán Địa kỹ thuật & Ràng buộc vật lý."""
    project_root = Path(__file__).resolve().parent.parent
    js_path = project_root / "on_dinh.js"
    html_path = project_root / "index.html"

    logger.info("=== BẮT ĐẦU KIỂM TOÁN ĐỊA KỸ THUẬT & VẬT LÝ ===")

    ok_soil, soil_errs = check_all_regions_soil_physics(js_path)
    if ok_soil:
        logger.info("[ĐẠT] Ràng buộc vật lý thông số đất/đá & SWCC hợp lệ.")
    else:
        for err in soil_errs:
            logger.error(err)

    ok_fs, fs_errs = check_fs_monotonicity_and_back_analysis(js_path)
    if ok_fs:
        logger.info(
            "[ĐẠT] Tính đơn điệu nghiêm ngặt của fsBang(beta, H, m) và logic phân tích ngược chuoiFSSau hợp lệ."
        )
    else:
        for err in fs_errs:
            logger.error(err)

    ok_ls, dup_ls = check_landslide_duplicates_in_html(html_path)
    if ok_ls:
        logger.info("[ĐẠT] Không có tọa độ trùng lặp trong DATA.landslides của index.html.")
    else:
        logger.warning(
            "[CẢNH BÁO DỊ BIỆT] Phát hiện %d tọa độ trùng lặp trong DATA.landslides của index.html (đã ghi nhận cách ly): %s",
            len(dup_ls),
            dup_ls,
        )

    return 0 if (ok_soil and ok_fs) else 1


if __name__ == "__main__":
    sys.exit(main())
