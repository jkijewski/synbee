import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

// Serves the built single-page UI; unknown non-API paths fall back to index.html.
export function serveWeb(app: FastifyInstance, root: string): void {
  const base = path.resolve(root);
  app.get('/*', async (req, reply) => {
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0]!);
    } catch {
      return reply.code(400).send({ error: 'Bad address' });
    }
    if (urlPath.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    let file = path.resolve(base, '.' + urlPath);
    if (!file.startsWith(base + path.sep) && file !== base) return reply.code(404).send({ error: 'Not found' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'The web UI is not built' });
    const ext = path.extname(file);
    reply.header('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (ext === '.html') {
      reply.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'");
      reply.header('X-Frame-Options', 'SAMEORIGIN');
    }
    return reply.send(fs.createReadStream(file));
  });
}
