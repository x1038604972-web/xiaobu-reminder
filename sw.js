/* 小步 Service Worker
   ─ 缓存只碰自己的前缀（xiaobu-），绝不动同源其他站点的 Cache Storage
   ─ 页面导航：网络优先 + 缓存兜底；静态资源：缓存优先 + 后台更新
   ─ 其他来源（CDN / Supabase）：直接透传，失败就是失败，不拿 index.html 冒充
*/
const PREFIX = 'xiaobu-';
const CACHE='xiaobu-20261126-xb7';
const OFFLINE_HTML = './index.html';

const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './ava-96.png',
  './body-320.png', './hero-hills.png', './ic-set.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

/* 新手导览演示资源：单独预缓存，单张失败不影响核心离线能力（首屏仍能离线启动） */
const GUIDE_ASSETS = ['./guide/demo.json',
  './guide/01-today.jpg', './guide/02-voice.jpg', './guide/03-xiaobu.jpg',
  './guide/04-card.jpg', './guide/05-habit.jpg', './guide/06-terminus.jpg',
  './guide/07-calendar.jpg', './guide/08-fx.jpg', './guide/09-elder.jpg'];

const STATIC_RE = /\.(?:css|js|mjs|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|json)$/i;
const scopeUrl = new URL(self.registration.scope);

function inScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.indexOf(scopeUrl.pathname) === 0;
}
function isOurCache(name) {
  return typeof name === 'string' && name.indexOf(PREFIX) === 0;
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(async c => {
        await c.addAll(ASSETS);
        await Promise.allSettled(GUIDE_ASSETS.map(u => c.add(u)));
      })
      .then(() => self.skipWaiting())
  );
});

/* 只清理 xiaobu- 前缀的旧缓存；不 navigate 其他客户端（避免升级时白屏/串页） */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => isOurCache(k) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 非本应用范围内（CDN、Supabase、其他站）→ 原样透传，不缓存、不兜底 */
  if (!inScope(url)) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');

  if (isPage) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(OFFLINE_HTML, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(OFFLINE_HTML).then(hit => hit || caches.match('./')))
    );
    return;
  }

  if (STATIC_RE.test(url.pathname)) {
    /* 缓存优先 + 后台静默更新；离线时直接用缓存 */
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => null);
        if (hit) { net.catch(() => {}); return hit; }
        return net.then(res => res || Response.error());
      })
    );
    return;
  }

  /* 其他同源请求：网络优先，失败就失败（不冒充 HTML） */
  e.respondWith(
    fetch(req).catch(() => caches.match(req).then(hit => hit || Response.error()))
  );
});

/* ══════════ 系统通知（安卓 Chrome 必须走 showNotification） ══════════ */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'notify') {
    self.registration.showNotification(d.title || '小步', d.opts || {});
  }
});

/* 点通知本体 = 打开 App；点「完成」「推迟 10 分钟」直接执行 */
self.addEventListener('notificationclick', e => {
  const n = e.notification;
  n.close();
  const data = n.data || {};
  const act = e.action === 'done' ? 'done' : e.action === 'later' ? 'later' : 'open';

  const url = new URL('./', self.location.href);
  if (data.id) url.searchParams.set('id', data.id);
  url.searchParams.set('act', act);

  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      try {
        if (new URL(c.url).origin === self.location.origin) {
          c.postMessage({ type: 'xb-act', act: act, id: data.id });
          if (act === 'open') await c.focus();
          return;
        }
      } catch (err) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(url.href);
  })());
});

/* Web Push：以后接服务器定时推送用（现在不发也不影响） */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '小步', body: e.data ? e.data.text() : '到点了' }; }
  const level = d.level === 3 ? 3 : (d.level || 1);
  e.waitUntil(self.registration.showNotification(d.title || '小步 · 到点了', {
    body: d.body || '',
    tag: 'push-' + (d.id || Date.now()),
    renotify: true,
    requireInteraction: level === 3,
    vibrate: level === 3 ? [0, 180, 90, 180, 90, 320] : [0, 120, 60, 120],
    icon: 'icon.svg',
    badge: 'icon.svg',
    data: { id: d.id, ts: d.ts },
    actions: [{ action: 'done', title: '完成' }, { action: 'later', title: '推迟 10 分钟' }]
  }));
});
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(Promise.resolve());
});