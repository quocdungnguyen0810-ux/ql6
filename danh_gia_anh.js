// Bản quyền © 2026 PGS. TS. Nguyễn Châu Lân, Trường Đại học Giao thông vận tải. Bảo lưu mọi quyền – xem LICENSE.
// Đánh giá mái dốc từ ảnh có tọa độ – chạy hoàn toàn trên trình duyệt, ẢNH KHÔNG GỬI ĐI ĐÂU.
//  1. Vị trí: GPS trong EXIF của ảnh -> nếu không có: vị trí máy hoặc chọn trên bản đồ.
//  2. Địa hình: lưới 5×5 điểm cách 60 m, cao độ DEM Copernicus 90 m (Open-Meteo Elevation API) -> độ dốc (Horn),
//     hướng dốc, chênh cao; góc mái tính toán = độ dốc lớn nhất của lưới (hoặc góc người dùng đo).
//  3. Mưa tại đúng điểm: 45 ngày qua + 4 ngày tới, 82 kịch bản tổ hợp -> ngưỡng mưa của vùng (Mai Châu hoặc QĐ 18/2021) và FS.
//  4. Ảnh: phân loại điểm ảnh – thực vật, đất, đá/đất sáng mới lộ, bóng tối, bầu trời -> ghi chú hiện trạng mái.
//  5. Bối cảnh: khoảng cách tới tuyến (QL6 hoặc các quốc lộ của vùng), điểm dự báo gần nhất, điểm trượt đã điều tra, điểm nguy cơ của Cục Đường bộ.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KQ = [];                       // các lần đánh giá trong phiên
  const anhLayer = L.layerGroup().addTo(map);
  let chonBanDo = null;                // hàm chờ người dùng bấm bản đồ

  /* ---------- EXIF: GPS, thời điểm chụp, hướng chụp (JPEG) ---------- */
  function docExif(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o < v.byteLength - 10) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
      if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break;
      o += 2 + len;
    }
    return null;
  }
  function tiff(v, t) {
    const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
    const ifd = p => { const n = u16(p), r = {}; for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; r[u16(e)] = {count: u32(e + 4), vo: e + 8}; } return r; };
    const rat = (e, i) => { const p = t + u32(e.vo) + i * 8, d = u32(p + 4); return d ? u32(p) / d : 0; };
    const ascii = e => { const p = e.count > 4 ? t + u32(e.vo) : e.vo; let s = ''; for (let i = 0; i < e.count - 1; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; };
    const out = {}, i0 = ifd(t + u32(t + 4));
    if (i0[0x8769]) { const ex = ifd(t + u32(i0[0x8769].vo)); if (ex[0x9003]) out.thoiDiem = ascii(ex[0x9003]); }
    if (i0[0x8825]) {
      const g = ifd(t + u32(i0[0x8825].vo)), dms = e => rat(e, 0) + rat(e, 1) / 60 + rat(e, 2) / 3600, ref = e => String.fromCharCode(v.getUint8(e.vo));
      if (g[2] && g[4]) {
        let la = dms(g[2]), lo = dms(g[4]);
        if (g[1] && ref(g[1]) === 'S') la = -la; if (g[3] && ref(g[3]) === 'W') lo = -lo;
        if (la || lo) { out.lat = la; out.lon = lo; }
      }
      if (g[0x11]) out.huongChup = rat(g[0x11], 0);
      if (g[6]) out.caoDoGPS = rat(g[6], 0);
    }
    return out;
  }

  /* ---------- Phân tích ảnh: phân loại điểm ảnh ---------- */
  const MAU_LOP = {tv: [46, 158, 91], dat: [181, 101, 29], sang: [245, 245, 240], toi: [60, 60, 70], troi: [120, 170, 230]};
  function phanTichAnh(img) {
    const W = 220, H = Math.max(1, Math.round(img.naturalHeight * W / img.naturalWidth));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H), px = d.data, dem = {tv: 0, dat: 0, sang: 0, toi: 0, troi: 0};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const br = (r + g + b) / 3, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      let k;
      if (y < H * 0.45 && ((b > r + 12 && b >= g && br > 140) || (br > 215 && sat < 0.08))) k = 'troi';
      else if (g > r + 6 && g >= b && 2 * g - r - b > 18) k = 'tv';
      else if (br < 55) k = 'toi';
      else if (br > 160 && sat < 0.22) k = 'sang';
      else if (r >= g && r > b + 12) k = 'dat';
      else k = br > 120 ? 'sang' : 'toi';
      dem[k]++; const c = MAU_LOP[k]; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
    cx.putImageData(d, 0, 0);
    const mat = W * H - dem.troi || 1, pt = k => Math.round(100 * dem[k] / mat);
    const r = {tv: pt('tv'), dat: pt('dat'), sang: pt('sang'), toi: pt('toi'), troi: Math.round(100 * dem.troi / (W * H)), lopPhu: cv.toDataURL('image/png')};
    const gc = [];
    if (r.tv >= 60) gc.push('Mặt mái phủ thực vật tốt (' + r.tv + '%): bề mặt ít xói, nhưng rễ cây không giữ được mặt trượt sâu.');
    else if (r.tv < 30) gc.push('Mặt mái ít thực vật (' + r.tv + '%): nước mưa ngấm và xói bề mặt nhanh hơn.');
    if (r.dat + r.sang >= 50) gc.push('Đất đá lộ chiếm ' + (r.dat + r.sang) + '% mặt mái: dễ xói, cần xem có rãnh xói, vết nứt đỉnh mái không.');
    if (r.sang >= 25) gc.push('Nhiều vùng sáng màu (' + r.sang + '%): có thể là đá hoặc đất mới lộ do sạt, đào mới – nên kiểm tra hiện trường.');
    if (r.toi >= 35) gc.push('Ảnh nhiều vùng tối (' + r.toi + '%): thiếu sáng hoặc bóng vách, kết quả phân loại kém tin cậy.');
    r.goiYDa = r.sang >= 45 && r.tv < 30;
    r.ghiChu = gc;
    return r;
  }

  /* ---------- Địa hình từ DEM ---------- */
  async function diaHinh(lat, lon) {
    const N = 5, S = 60, dLat = S / 111320, dLon = S / (111320 * Math.cos(lat * Math.PI / 180)), la = [], lo = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { la.push((lat + (2 - i) * dLat).toFixed(6)); lo.push((lon + (j - 2) * dLon).toFixed(6)); }
    const r = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + la.join(',') + '&longitude=' + lo.join(','));
    if (!r.ok) throw new Error('Không lấy được cao độ (DEM)');
    const z = (await r.json()).elevation; if (!z || z.length !== N * N) throw new Error('Số liệu cao độ thiếu');
    const Z = (i, j) => z[i * N + j], doc = [];
    let tam = null;
    for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {      // Horn (1981)
      const dzdx = ((Z(i - 1, j + 1) + 2 * Z(i, j + 1) + Z(i + 1, j + 1)) - (Z(i - 1, j - 1) + 2 * Z(i, j - 1) + Z(i + 1, j - 1))) / (8 * S);
      const dzdy = ((Z(i - 1, j - 1) + 2 * Z(i - 1, j) + Z(i - 1, j + 1)) - (Z(i + 1, j - 1) + 2 * Z(i + 1, j) + Z(i + 1, j + 1))) / (8 * S);
      const sl = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI; doc.push(sl);
      if (i === 2 && j === 2) {
        let asp = Math.atan2(-dzdx, -dzdy) * 180 / Math.PI; if (asp < 0) asp += 360;      // hướng mái quay mặt về (0 = Bắc)
        tam = {doc: sl, huong: asp};
      }
    }
    return {caoDo: Z(2, 2), docTam: tam.doc, docMax: Math.max(...doc), huong: tam.huong, chenhCao: Math.max(...z) - Math.min(...z)};
  }
  const HUONG8 = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
  const huongTxt = a => HUONG8[Math.round(a / 45) % 8];

  /* ---------- Mưa và ổn định tại điểm ---------- */
  async function muaVaOnDinh(lat, lon, beta, laDa, zone) {
    const q = 'latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) + '&daily=precipitation_sum&timezone=Asia%2FBangkok';
    const [rf, re, rg] = await Promise.all([
      fetch('https://api.open-meteo.com/v1/forecast?' + q + '&past_days=' + (PAST_DAYS + PAD_FS) + '&forecast_days=4' + (typeof MO_HINH_MUA === 'string' ? MO_HINH_MUA : '')),
      fetch('https://ensemble-api.open-meteo.com/v1/ensemble?' + q + '&forecast_days=4&models=' + ENS_MODELS).catch(() => null),
      QD18 ? fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) + '&hourly=precipitation&past_days=3&forecast_days=4&timezone=Asia%2FBangkok').catch(() => null) : Promise.resolve(null)]);
    if (!rf.ok) throw new Error('Không lấy được mưa dự báo');
    let gio = null;
    try {
      if (rg && rg.ok) {
        const jg = await rg.json(), l = Array.isArray(jg) ? jg[0] : jg;
        if (l && l.hourly) { gio = {}; l.hourly.time.forEach((t, i) => { const d = t.slice(0, 10); gio[d] = Math.max(gio[d] || 0, l.hourly.precipitation[i] || 0); }); }
      }
    } catch (_) {}
    const d = chuanMua(await rf.json()).daily, prF = d.precipitation_sum.map(v => v || 0), tmF = d.time, off = prF.length - (PAST_DAYS + 4);
    const lop = QD18 ? lopNguyCo(beta) : null;
    const pr = prF.slice(off), tm = tmF.slice(off), days = evalStation(pr, tm, laDa, lop, gio);
    let ens = null; try { if (re && re.ok) ens = await re.json(); } catch (_) {}
    const m = ens ? ensMembers(ens) : {times: [], cols: []};
    const pe = ensProb(pr, tm, m.times, m.cols, laDa, lop);
    if (pe) days.forEach((o, k) => { if (pe[k]) { o.ens = pe[k]; const pl = probLevel(pe[k]); if (pl > o.lv) { o.lv = pl; o.byEns = true; } } });
    let od = null, chart = null;
    if (!laDa && window.OD) {
      const id = 'anh', p = OD.thamSo({id, zone: zone || 'KV1'}, null, {nguon: 'DEM', diem: {[id]: {doc: beta}}});
      const ser = OD.chuoiFS(prF, p), a0 = off + PAST_DAYS - 14;
      chart = {t: tmF.slice(a0), P: prF.slice(a0), FS: ser.slice(a0).map(x => x.FS), nguong: p.nguong};
      let fe = null;
      if (m.cols.length) {
        const idx = {}; m.times.forEach((t, i) => idx[t] = i); const tl = [0, 1, 2, 3].map(k => off + PAST_DAYS + k);
        fe = OD.xacSuat(prF, tl, m.cols.map(c => tl.map(t => ((tmF[t] in idx) ? c[idx[tmF[t]]] : prF[t]) || 0)), p);
      }
      days.forEach((o, k) => {
        o.fs = ser[off + PAST_DAYS + k]; o.fsLv = OD.mucFS(o.fs.FS, p);
        if (o.fsLv >= 2 && o.fsLv > o.lv) { o.lv = o.fsLv; o.byFs = true; }
        if (fe && fe[k]) { o.fsEns = fe[k]; const pl = OD.mucXacSuat(fe[k], P_HI, P_MID); if (pl >= 2 && pl > o.lv) { o.lv = pl; o.byFs = true; } }
      });
      od = {beta: p.beta_tinh, D: p.D, FSkho: OD.fsKho(p)};
      const sau = OD.chuoiFSSau ? OD.chuoiFSSau(prF, beta, OD.hinhHocSau({}).H) : null;      // trượt sâu tại điểm ảnh
      if (sau) { chart.FS_sau = sau.slice(a0).map(x => x.FS); od.sau = {beta, H: OD.hinhHocSau({}).H, nguon: 'góc mái ảnh/DEM'};
        days.forEach((o, k) => { o.fsSau = sau[off + PAST_DAYS + k]; o.fsSauLv = OD.mucFSSau(o.fsSau.FS);
          if (o.fsSauLv >= 2 && o.fsSauLv > o.lv) { o.lv = o.fsSauLv; o.bySau = true; } }); }
    }
    return {days, od, chart, nEns: m.cols.length};
  }

  /* ---------- Bối cảnh tuyến ---------- */
  function boiCanh(lat, lon) {
    const ll = L.latLng(lat, lon), dist = xy => map.distance(ll, [xy[1], xy[0]]);
    let dTuyen = Infinity;
    for (const R of ROUTES) for (let i = 1; i < R.length; i++) {   // khoảng cách tới đoạn thẳng (gần đúng trên mặt phẳng)
      const a = R[i - 1], b = R[i], k = Math.cos(lat * Math.PI / 180) * 111320, kk = 111320;
      const ax = (a[0] - lon) * k, ay = (a[1] - lat) * kk, bx = (b[0] - lon) * k, by = (b[1] - lat) * kk;
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) || 1)));
      dTuyen = Math.min(dTuyen, Math.hypot(ax + t * dx, ay + t * dy));
    }
    const gan = DATA.stations.map(s => ({s, d: dist(s.xy)})).sort((a, b) => a.d - b.d)[0];
    const trUot = DATA.landslides.filter(p => dist(p) <= 1000).length;
    const nguyCo = DATA.official.filter(o => dist(o.xy) <= 1000).map(o => o.ten);
    return {dTuyen, gan, trUot, nguyCo};
  }

  /* ---------- Giao diện ---------- */
  function trangThai(t) { $('anh-tt').textContent = t; }
  async function viTriMay() {
    return new Promise((ok, loi) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(
      p => ok({lat: p.coords.latitude, lon: p.coords.longitude, nguon: 'vị trí máy (±' + Math.round(p.coords.accuracy) + ' m)'}),
      () => loi(new Error('Không lấy được vị trí máy')), {enableHighAccuracy: true, timeout: 15000}) : loi(new Error('Trình duyệt không hỗ trợ định vị')));
  }
  function choBanDo() {
    trangThai('Bấm vào bản đồ tại vị trí mái dốc trong ảnh…');
    if (window.innerWidth < 820) $('map').scrollIntoView({behavior: 'smooth'});
    return new Promise(ok => { chonBanDo = e => { chonBanDo = null; ok({lat: e.latlng.lat, lon: e.latlng.lng, nguon: 'chọn trên bản đồ'}); }; });
  }
  map.on('click', e => { if (chonBanDo) chonBanDo(e); });

  async function xuLy(file) {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode().catch(() => { URL.revokeObjectURL(url); throw new Error('Không đọc được ảnh ' + file.name + ' (nên dùng JPEG)'); });
    let ex = null; try { ex = docExif(await file.arrayBuffer()); } catch (_) {}
    let vt = ex && ex.lat != null ? {lat: ex.lat, lon: ex.lon, nguon: 'GPS trong ảnh'} : null;
    if (!vt) {
      const c = $('anh-vitri').value;
      trangThai('Ảnh ' + file.name + ' không có tọa độ GPS. ' + (c === 'may' ? 'Đang lấy vị trí máy…' : ''));
      vt = c === 'may' ? await viTriMay().catch(() => choBanDo()) : await choBanDo();
    }
    trangThai('Đang phân tích ảnh, địa hình, mưa tại ' + vt.lat.toFixed(5) + ', ' + vt.lon.toFixed(5) + '…');
    const anh = phanTichAnh(img);
    const loai = $('anh-loai').value, laDa = loai === 'da' || (loai === 'tu' && anh.goiYDa);
    const dh = await diaHinh(vt.lat, vt.lon);
    const goc = parseFloat(($('anh-goc').value || '').replace(',', '.'));
    const beta = isFinite(goc) && goc > 0 && goc < 90 ? goc : dh.docMax;
    const bc = boiCanh(vt.lat, vt.lon);
    const md = await muaVaOnDinh(vt.lat, vt.lon, beta, laDa, bc.gan ? bc.gan.s.zone : 'KV1');
    const r = {ten: file.name, url, vt, ex: ex || {}, anh, laDa, loai, dh, beta, nguonGoc: isFinite(goc) && goc > 0 && goc < 90 ? 'đo tại hiện trường' : 'DEM (sườn dốc nhất trong 120 m)', md, bc, luc: new Date()};
    KQ.unshift(r); veKQ(r); return r;
  }

  function muc(r) { return Math.max(...r.md.days.map(d => d.lv)); }
  function veKQ(r) {
    const d0 = r.md.days[0], lv = muc(r), kd = r.md.days.findIndex(d => d.lv === lv);
    const o = r.md.od, f = d0.fs;
    const hang = (a, b) => '<tr><td>' + a + '</td><td>' + b + '</td></tr>';
    let h = '<div class="anh-kq" style="border-left-color:' + LV_COL[lv] + '"><div class="anh-dau"><img src="' + r.url + '" alt="Ảnh mái dốc ' + esc(r.ten) + '">' +
      '<div><b style="color:' + (lv === 1 ? '#7a5d00' : LV_COL[lv]) + '">' + LV_TXT[lv] + '</b> ' + (lv ? '(' + DAY_TXT[kd].toLowerCase() + ')' : 'trong 4 ngày tới') + '<br>' +
      '<small>' + esc(r.ten) + ' · ' + r.vt.lat.toFixed(5) + ', ' + r.vt.lon.toFixed(5) + ' (' + esc(r.vt.nguon) + ')' + (r.ex.thoiDiem ? ' · chụp ' + esc(r.ex.thoiDiem.slice(0, 16).replace(/:/, '-').replace(/:/, '-')) : '') + '</small></div></div>';
    h += '<table class="anh-bang">' +
      hang('Vị trí', 'cách ' + TEN_TUYEN + ' ' + (r.bc.dTuyen < 1000 ? Math.round(r.bc.dTuyen) + ' m' : fmtVN(r.bc.dTuyen / 1000, 1) + ' km') + '; điểm dự báo gần nhất ' + esc(r.bc.gan.s.id) + ' (' + fmtVN(r.bc.gan.d / 1000, 1) + ' km)') +
      hang('Trong bán kính 1 km', r.bc.trUot + ' điểm trượt đã điều tra' + (r.bc.nguyCo.length ? '; điểm nguy cơ Cục ĐB: ' + r.bc.nguyCo.map(esc).join(', ') : '')) +
      hang('Địa hình (DEM)', 'cao độ ' + Math.round(r.dh.caoDo) + ' m; dốc tại điểm ' + fmtVN(r.dh.docTam, 0) + '°, dốc nhất ' + fmtVN(r.dh.docMax, 0) + '°; mái quay hướng ' + huongTxt(r.dh.huong) + '; chênh cao ' + Math.round(r.dh.chenhCao) + ' m trong 240 m') +
      hang('Mưa hôm nay', muaTxt(d0) + (d0.ens ? '; xác suất đạt mức cao nhất ' + Math.round(d0.ens.p3 * 100) + '%' : ''));
    if (r.laDa) h += hang('Ổn định', 'Mái đá' + (r.loai === 'tu' ? ' (nhận từ ảnh)' : '') + ': mô hình đất theo mưa không áp dụng; ổn định vách đá do hệ khe nứt quyết định – cần đo thế nằm khe nứt tại hiện trường để phân tích động học.');
    else h += hang('Hệ số an toàn FS', '<b style="color:' + (d0.fsLv === 1 ? '#7a5d00' : LV_COL[d0.fsLv]) + '">' + fmtVN(f.FS, 2) + '</b> hôm nay (khô ' + fmtVN(o.FSkho, 2) + '); 3 ngày tới: ' +
        r.md.days.slice(1).map(x => fmtVN(x.fs.FS, 2) + (x.fsEns ? ' (' + Math.round(x.fsEns.p1 * 100) + '% FS&lt;1)' : '')).join(' · ')) +
      hang('Thông số tính', 'góc mái ' + fmtVN(r.beta, 0) + '° (' + r.nguonGoc + '), tầng phủ ' + fmtVN(o.D, 1) + ' m, đới ngấm ' + fmtVN(f.h, 1) + ' m' + (f.hw > 0 ? ', nước treo ' + fmtVN(f.hw, 1) + ' m' : '')) +
      (d0.fsSau ? hang('Trượt sâu', 'FS <b style="color:' + (d0.fsSauLv === 1 ? '#7a5d00' : LV_COL[d0.fsSauLv]) + '">' + fmtVN(d0.fsSau.FS, 2) + '</b> hôm nay, nước ngầm dâng ' +
        Math.round(d0.fsSau.m * 100) + '% tầng phủ; 3 ngày tới: ' + r.md.days.slice(1).map(x => fmtVN(x.fsSau.FS, 2)).join(' · ')) : '');
    h += hang('Từ ảnh', 'thực vật ' + r.anh.tv + '%, đất ' + r.anh.dat + '%, đá/đất sáng ' + r.anh.sang + '%, bóng tối ' + r.anh.toi + '%') + '</table>';
    if (r.anh.ghiChu.length) h += '<ul class="anh-gc">' + r.anh.ghiChu.map(x => '<li>' + x + '</li>').join('') + '</ul>';
    if (!r.laDa && r.md.chart) h += fsSvg(r.md.chart, 0);
    h += '<details><summary>Ảnh phân loại bề mặt</summary><img src="' + r.anh.lopPhu + '" alt="Phân loại: xanh lá thực vật, nâu đất, trắng đá hoặc đất sáng, xám tối bóng, xanh trời" style="width:100%;border-radius:6px;margin-top:4px">' +
      '<small>Xanh lá: thực vật · nâu: đất · trắng: đá/đất sáng · xám: bóng tối · xanh dương: trời (không tính)</small></details>';
    h += '<p class="note"><b>Khuyến cáo:</b> ' + HUONG_DAN[lv][0] + '</p>';
    h += '<p class="note">Đánh giá sơ bộ từ ảnh, DEM 90 m và mưa mô hình; không thay cho khảo sát địa chất. Ảnh chỉ xử lý trên máy này, không gửi đi.</p></div>';
    const el = document.createElement('div'); el.innerHTML = h; $('anh-kq').prepend(el.firstChild);
    L.marker([r.vt.lat, r.vt.lon], {icon: L.divIcon({className: '', html: '<div class="anh-mk" style="background:' + LV_COL[lv] + '">📷</div>', iconSize: [26, 26], iconAnchor: [13, 13]})})
      .bindPopup('<div class="pop"><b>' + esc(r.ten) + '</b><br><img src="' + r.url + '" style="width:200px;border-radius:6px;margin:4px 0"><br><b style="color:' + LV_COL[lv] + '">' + LV_TXT[lv] + '</b>' +
        (r.laDa ? '<br>Mái đá – cần đo khe nứt' : '<br>FS hôm nay ' + fmtVN(f.FS, 2) + ', góc mái ' + fmtVN(r.beta, 0) + '°') + '</div>').addTo(anhLayer).openPopup();
    map.setView([r.vt.lat, r.vt.lon], Math.max(map.getZoom(), 13));
    $('anh-tai').hidden = false;
  }

  function taiGeoJSON() {
    const g = {type: 'FeatureCollection', name: 'danh_gia_mai_doc_tu_anh', features: KQ.map(r => ({type: 'Feature',
      geometry: {type: 'Point', coordinates: [+r.vt.lon.toFixed(6), +r.vt.lat.toFixed(6)]},
      properties: {anh: r.ten, nguon_vi_tri: r.vt.nguon, thoi_diem_chup: r.ex.thoiDiem || null, danh_gia_luc: r.luc.toISOString(),
        muc: muc(r), muc_chu: LV_TXT[muc(r)], loai_mai: r.laDa ? 'đá' : 'đất', goc_mai: +r.beta.toFixed(1), nguon_goc: r.nguonGoc,
        doc_dem_tam: +r.dh.docTam.toFixed(1), doc_dem_max: +r.dh.docMax.toFixed(1), huong_mai: huongTxt(r.dh.huong), cao_do: Math.round(r.dh.caoDo),
        ngay: r.md.days.map(d => d.date), mua_mm: r.md.days.map(d => +d.P.toFixed(1)), fs: r.laDa ? null : r.md.days.map(d => +d.fs.FS.toFixed(3)),
        xac_suat_fs_nho_hon_1: r.laDa ? null : r.md.days.map(d => d.fsEns ? d.fsEns.p1 : null),
        thuc_vat_pt: r.anh.tv, dat_pt: r.anh.dat, da_sang_pt: r.anh.sang, cach_tuyen_m: Math.round(r.bc.dTuyen)}}))};
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(g, null, 1)], {type: 'application/geo+json'}));
    a.download = 'danh_gia_mai_doc_' + new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) + '.geojson'; a.click();
  }

  $('anh-file').addEventListener('change', async e => {
    const fs = [...e.target.files]; if (!fs.length) return;
    for (const f of fs) {
      try { await xuLy(f); trangThai('Đã đánh giá ' + KQ.length + ' ảnh.'); }
      catch (err) { trangThai('Lỗi với ảnh ' + f.name + ': ' + err.message); }
    }
    e.target.value = '';
  });
  $('anh-tai').onclick = taiGeoJSON;
  window.DANH_GIA_ANH = {docExif, phanTichAnh, diaHinh, KQ};
})();
