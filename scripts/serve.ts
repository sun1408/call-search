const ROOT = new URL('../docs/', import.meta.url).pathname;
const BASE = '/call-search/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(BASE, 302);
    if (!url.pathname.startsWith(BASE)) return new Response('not found', { status: 404 });
    let path = decodeURIComponent(url.pathname.slice(BASE.length));
    if (path === '' || path.endsWith('/')) path += 'index.html';
    if (path.split('/').includes('..')) return new Response('bad path', { status: 400 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const file = Bun.file(ROOT + path);
    if (!(await file.exists())) return new Response('not found', { status: 404 });
    const ext = path.slice(path.lastIndexOf('.'));
    return new Response(file, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' } });
  },
});

console.log(`serving ${ROOT} at http://localhost:${server.port}${BASE}`);
