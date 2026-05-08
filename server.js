import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(__dirname, 'public');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function sendText(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function isInsidePublicDir(filePath) {
  const rel = relative(publicDir, filePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveStaticFile(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPath).replace(/^([/\\])+/, '');
  let filePath = join(publicDir, normalizedPath);

  if (!isInsidePublicDir(filePath)) {
    return null;
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (fileStat?.isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  const finalStat = await stat(filePath).catch(() => null);
  if (finalStat?.isFile() && isInsidePublicDir(filePath)) {
    return { filePath, size: finalStat.size };
  }

  return null;
}

function cacheHeader(filePath) {
  return extname(filePath) === '.html'
    ? 'no-cache'
    : 'public, max-age=31536000, immutable';
}

async function handleRequest(req, res) {
  if (req.url === undefined) {
    return sendText(res, 400, 'Bad Request');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    return sendText(res, 200, 'ok', { 'cache-control': 'no-store' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return sendText(res, 405, 'Method Not Allowed');
  }

  let staticFile = null;
  try {
    staticFile = await resolveStaticFile(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad Request');
  }

  const fallbackFile = join(publicDir, 'index.html');
  const filePath = staticFile?.filePath || fallbackFile;
  const fallbackStat = staticFile ? null : await stat(fallbackFile).catch(() => null);
  const size = staticFile?.size || fallbackStat?.size;

  if (!size) {
    return sendText(res, 404, 'Not Found');
  }

  res.writeHead(200, {
    'content-type': mimeTypes.get(extname(filePath)) || 'application/octet-stream',
    'content-length': size,
    'cache-control': cacheHeader(filePath),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  });

  if (req.method === 'HEAD') {
    return res.end();
  }

  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Unhandled request error:', error);
    if (!res.headersSent) {
      sendText(res, 500, 'Internal Server Error');
    } else {
      res.destroy(error);
    }
  });
});

server.listen(port, host, () => {
  console.log(`Spiral static server listening on http://${host}:${port}`);
});
