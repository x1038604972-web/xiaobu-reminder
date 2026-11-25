const CACHE='xiaobu-20261125-xb5';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./ava-96.png','./body-320.png','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
      .then(()=>self.clients.matchAll({type:'window',includeUncontrolled:true}))
      .then(clients=>Promise.all(clients.map(c=>c.navigate(c.url).catch(()=>{}))))
  );
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const isPage=e.request.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/');
  if(isPage){
    e.respondWith(fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    const copy=res.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    return res;
  }).catch(()=>caches.match('./index.html'))));
});

/* ══════════════════════════════════════════════════
   系统通知
   安卓 Chrome 不允许页面直接 new Notification()，
   必须由 Service Worker 的 showNotification 发出，
   这样才会出现在系统通知栏 / 其他 App 上方横幅。
   ══════════════════════════════════════════════════ */

/* 页面也可以让 SW 代发（例如切到后台后仍要保证弹出） */
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type==='notify'){
    self.registration.showNotification(d.title||'小步',d.opts||{});
  }
});

/* 点通知本体 = 打开 App；点「完成」「推迟 10 分钟」= 直接执行 */
self.addEventListener('notificationclick',e=>{
  const n=e.notification;
  n.close();
  const data=n.data||{};
  const act=e.action==='done'?'done':e.action==='later'?'later':'open';

  const url=new URL('./',self.location.href);
  if(data.id)url.searchParams.set('id',data.id);
  url.searchParams.set('act',act);

  e.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of list){
      try{
        if(new URL(c.url).origin===self.location.origin){
          c.postMessage({type:'xb-act',act:act,id:data.id});
          if(act==='open')await c.focus();
          return;
        }
      }catch(err){}
    }
    if(self.clients.openWindow)await self.clients.openWindow(url.href);
  })());
});

/* Web Push：以后接服务器定时推送用（现在不发也不影响） */
self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch(err){d={title:'小步',body:e.data?e.data.text():'到点了'};}
  const level=d.level===3?3:(d.level||1);
  e.waitUntil(self.registration.showNotification(d.title||'小步 · 到点了',{
    body:d.body||'',
    tag:'push-'+(d.id||Date.now()),
    renotify:true,
    requireInteraction:level===3,
    vibrate:level===3?[0,180,90,180,90,320]:[0,120,60,120],
    icon:'icon.svg',
    badge:'icon.svg',
    data:{id:d.id,ts:d.ts},
    actions:[{action:'done',title:'完成'},{action:'later',title:'推迟 10 分钟'}]
  }));
});
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil(Promise.resolve());
});