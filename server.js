import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createBrotliCompress, createGzip } from 'node:zlib';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(__dirname, 'public');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
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
    return { filePath, size: finalStat.size, mtimeMs: finalStat.mtimeMs };
  }

  return null;
}


function etagFor(filePath, size, mtimeMs) {
  return `W/"${Buffer.from(`${relative(publicDir, filePath)}:${size}:${Math.trunc(mtimeMs)}`).toString('base64url')}"`;
}

function isCompressible(contentType) {
  return /^(text\/|application\/(javascript|json))|image\/svg\+xml/.test(contentType);
}

function negotiatedEncoding(req, contentType, size) {
  if (req.method === 'HEAD' || size < 1024 || !isCompressible(contentType)) return null;

  const header = req.headers['accept-encoding'];
  if (!header) return null;

  // Parse Accept-Encoding into a map of { encoding: qValue }
  const encodingQualities = Object.create(null);
  for (const part of header.split(',')) {
    const [rawEncoding, ...params] = part.split(';');
    const encoding = rawEncoding.trim().toLowerCase();
    if (!encoding) continue;

    let q = 1;
    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'q' && value !== undefined) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) q = parsed;
        break;
      }
    }

    encodingQualities[encoding] = q;
  }

  const getQ = (encoding) => {
    const key = encoding.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(encodingQualities, key)) {
      return encodingQualities[key];
    }
    // '*' wildcard applies to any encoding except 'identity'
    if (key !== 'identity' && Object.prototype.hasOwnProperty.call(encodingQualities, '*')) {
      return encodingQualities['*'];
    }
    if (key === 'identity') {
      // identity is 1.0 by default unless explicitly overridden
      return Object.prototype.hasOwnProperty.call(encodingQualities, 'identity')
        ? encodingQualities['identity']
        : 1;
    }
    return 0;
  };

  const brQ = getQ('br');
  const gzipQ = getQ('gzip');

  // Respect q=0 (explicitly disabled) and return null if neither is acceptable
  if (brQ <= 0 && gzipQ <= 0) return null;

  // Prefer the encoding with higher q; prefer br on a tie
  if (brQ >= gzipQ && brQ > 0) return 'br';
  if (gzipQ > 0) return 'gzip';

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

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendText(res, 400, 'Bad Request');
  }

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
  const size = staticFile?.size ?? fallbackStat?.size;
  const mtimeMs = staticFile?.mtimeMs ?? fallbackStat?.mtimeMs;

  if (size == null || mtimeMs == null) {
    return sendText(res, 404, 'Not Found');
  }

  const contentType = mimeTypes.get(extname(filePath)) || 'application/octet-stream';
  const etag = etagFor(filePath, size, mtimeMs);

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'cache-control': cacheHeader(filePath),
      etag,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    });
    return res.end();
  }

  const encoding = negotiatedEncoding(req, contentType, size);
  const headers = {
    'content-type': contentType,
    'cache-control': cacheHeader(filePath),
    etag,
    vary: 'Accept-Encoding',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin'
  };

  if (encoding) {
    headers['content-encoding'] = encoding;
  } else {
    headers['content-length'] = size;
  }

  res.writeHead(200, headers);

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    if (!res.headersSent) {
      sendText(res, 500, 'Internal Server Error');
    } else {
      res.destroy(error);
    }
  });

  if (!encoding) {
    return stream.pipe(res);
  }

  const compressor = encoding === 'br' ? createBrotliCompress() : createGzip();
  pipeline(stream, compressor, res, (error) => {
    if (error && !res.destroyed) {
      res.destroy(error);
    }
  });
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
