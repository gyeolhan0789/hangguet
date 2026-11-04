// 기준: 사용자 요청(2026-11-04), Node HTTP/fs 공식 API. FE의 실제 모델 파일을 그대로 제공한다.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../../frontend/public');
const threeDir = resolve(here, '../../frontend/node_modules/three');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.glb':'model/gltf-binary', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };

export function resolveAsset(rawUrl) {
  const pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  const [root, relative] = pathname.startsWith('/interview/duck/')
    ? [resolve(publicDir, 'interview/duck'), pathname.slice('/interview/duck/'.length)]
    : pathname.startsWith('/vendor/three/')
      ? [threeDir, pathname.slice('/vendor/three/'.length)]
      : [here, pathname === '/' ? 'index.html' : pathname.slice(1)];
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep) || file.endsWith(`${sep}server.mjs`)) return null;
  return file;
}

const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  try {
    const path = resolveAsset(request.url);
    if (!path || !statSync(path).isFile()) throw new Error('not found');
    const stat = statSync(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('파일을 찾을 수 없습니다.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Duck preview: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
