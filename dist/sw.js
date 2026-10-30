const BASE = new URL('./', self.location.href).pathname;
const CACHE_NAME = 'siyai-mobile-v2-' + BASE;
const CORE = ['', 'assets/tailwind.css', 'manifest.webmanifest', 'assets/image-7a7b1ace07c669e5.png'].map(path => BASE + path);
function canCache(response) { return response.ok && !response.redirected && response.type !== 'opaque'; }
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(CORE.map(async path => {
            try {
                const response = await fetch(path, {cache:'reload',credentials:'same-origin'});
                if (canCache(response)) await cache.put(path,response);
            } catch {}
        }));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith('siyai-mobile-v2-') && name.endsWith(BASE) && name !== CACHE_NAME).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
    // Authentication, external services and all submissions stay on the network.
    if (request.method !== 'GET' || url.origin !== self.location.origin || !(path === '' || path === 'index.html' || path?.startsWith('assets/') || path === 'manifest.webmanifest')) return;
    event.respondWith((async () => {
        let cache;
        try { cache = await caches.open(CACHE_NAME); } catch { return fetch(request); }
        const immutableImage = /^assets\/(image|author|sleep)-[a-f0-9]+\.png$/.test(path);
        if (immutableImage) {
            try { const cached = await cache.match(request); if (cached) return cached; } catch {}
        }
        try {
            const response = await fetch(request);
            if (canCache(response)) { try { await cache.put(request,response.clone()); } catch {} }
            return response;
        } catch {
            try {
                const cached = await cache.match(request) || (path === '' || path === 'index.html' ? await cache.match(BASE) : null);
                if (cached) return cached;
            } catch {}
            return new Response('Для первого открытия нужен интернет. Подключись к сети и попробуй ещё раз.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
        }
    })());
});
