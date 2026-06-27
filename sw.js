const CACHE_NAME = '48sea-cache-auto';

// キャッシュしておくファイル（オフライン時のフォールバック用）
const urlsToCache = [
  './index.html',
  './manifest.json',
  './48seaLogo192.png',
  './48seaLogo512.png'
];

// 1. インストール時：最低限のファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  // 新しいSWを即座にアクティブにする（待機スキップ）
  self.skipWaiting();
});

// 2. アクティベート時：古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // 既存のタブも即座にこのSWの管理下に
  );
});

// 3. フェッチ：ネットワークファースト＋更新検知
self.addEventListener('fetch', (event) => {
  // http/https 以外（拡張機能など）は無視
  if (!event.request.url.startsWith('http')) return;

  // GAS（クラウド同期）など外部APIはキャッシュしない
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) {
    return; // ブラウザのデフォルト処理に任せる
  }

  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();

        // index.html が更新されていたら全クライアントに通知してリロード
        if (event.request.url.includes('index.html') || url.pathname === '/') {
          caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(event.request);
            if (cached) {
              const [cachedText, networkText] = await Promise.all([
                cached.clone().text(),
                responseToCache.clone().text()
              ]);
              if (cachedText !== networkText) {
                // 内容が変わっていたらキャッシュ更新 → 全クライアントにリロード指示
                await cache.put(event.request, responseToCache.clone());
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
              }
            } else {
              // キャッシュがなければそのまま保存
              await cache.put(event.request, responseToCache.clone());
            }
          });
        } else {
          // index.html 以外はそのままキャッシュ更新
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
      }
      return networkResponse;
    }).catch(() => {
      // オフライン時はキャッシュから返す
      return caches.match(event.request);
    })
  );
});
