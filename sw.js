// Bản quyền © 2026 PGS. TS. Nguyễn Châu Lân, Trường Đại học Giao thông vận tải. Bảo lưu mọi quyền – xem LICENSE.
// Service worker: mở được app khi mất mạng (hiện dự báo lần cuối), cập nhật khi có mạng.
const CACHE = "ql6-v19";
const SHELL = ['./', './index.html', './on_dinh.js', './danh_gia_anh.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png', './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png', './vendor/leaflet/images/marker-icon-2x.png', './vendor/leaflet/images/marker-shadow.png',
  './chinh-sach-rieng-tu.html', './lao-cai/', './lao-cai/index.html', './lao-cai/manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  // Dự báo mưa, số liệu cảnh báo/vệ tinh và trang chính: ưu tiên mạng, mất mạng thì dùng bản lưu gần nhất
  if (url.includes('open-meteo.com') || url.includes('/data/') || url.includes('on_dinh.js') || url.includes('danh_gia_anh.js') || e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: e.request.mode === 'navigate'})));
    return;
  }
  // Thư viện, icon, ô bản đồ: ưu tiên bản lưu
  e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => {
    if (r && r.ok && (url.includes('tile.openstreetmap') || url.includes('opentopomap') || url.includes('arcgisonline') || url.includes('fonts.g'))) {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp));
    }
    return r;
  })));
});
