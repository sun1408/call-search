import { CSP } from './core/csp';
import { Store } from './core/store';

declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __SHELL__: string[];

const SHELL_CACHE = `cs-shell-${__VERSION__}`;
const VENDOR_CACHE = 'cs-vendor-v1';
const SCOPE = new URL('./', self.location.href).pathname;

function secured(response: Response): Response {
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(__SHELL__.map((path) => new Request(new URL(path, self.location.href), { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('cs-shell-') && key !== SHELL_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const store = await Store.open(indexedDB);
    try {
      for (const value of form.getAll('audio')) {
        if (value instanceof File && value.size > 0) {
          await store.addInbox({ kind: 'audio', name: value.name || '공유한 녹음', type: value.type, lastModified: value.lastModified, blob: value });
        }
      }
      for (const value of form.getAll('textfile')) {
        if (value instanceof File && value.size > 0) {
          await store.addInbox({ kind: 'text', name: value.name || '공유한 글', type: value.type || 'text/plain', lastModified: value.lastModified, text: await value.text() });
        }
      }
      const text = [form.get('text'), form.get('url')].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join('\n');
      const title = form.get('title');
      if (text || (typeof title === 'string' && title.trim())) {
        await store.addInbox({ kind: 'text', name: '공유한 글', type: 'text/plain', lastModified: Date.now(), text, title: typeof title === 'string' ? title.trim() : undefined });
      }
    } finally {
      store.close();
    }
    return Response.redirect(`${SCOPE}?share=1#/import`, 303);
  } catch (error) {
    console.error('share target failed', error);
    return Response.redirect(`${SCOPE}?share-error=1`, 303);
  }
}

async function serveShell(request: Request): Promise<Response> {
  const cached = await caches.match(new URL('index.html', self.location.href).href, { cacheName: SHELL_CACHE });
  if (cached) return secured(cached);
  return secured(await fetch(request));
}

async function serveAsset(request: Request, url: URL): Promise<Response> {
  const shell = await caches.match(url.href, { cacheName: SHELL_CACHE, ignoreSearch: true });
  if (shell) return request.destination === 'worker' ? secured(shell) : shell;
  if (url.pathname.startsWith(`${SCOPE}vendor/`)) {
    const cache = await caches.open(VENDOR_CACHE);
    const hit = await cache.match(url.href, { ignoreSearch: true });
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) await cache.put(url.href, response.clone());
    return response;
  }
  const response = await fetch(request);
  return request.destination === 'worker' ? secured(response) : response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (request.method === 'POST' && url.pathname === `${SCOPE}share-target`) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') event.respondWith(serveShell(request));
  else event.respondWith(serveAsset(request, url));
});
