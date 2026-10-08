import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreviewClient, PreviewAPIError } from './preview-client.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/browser-client.js': ['src/browser-client.js', 'text/javascript; charset=utf-8'],
  '/workspace.js': ['src/workspace.js', 'text/javascript; charset=utf-8'],
  '/logo.svg': ['public/logo.svg', 'image/svg+xml'] };
const MAX_BODY = 32_768;
const WORKSPACE_IDLE_MS = 120_000;
const sessionRoute = /^\/api\/sessions\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?:\/(resize|navigate|input|screenshot|stream))?$/i;

async function jsonBody(req) {
  let size = 0; const chunks = [];
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) { const err = new Error('Request body too large'); err.status = 413; throw err; }
    chunks.push(part);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const err = new Error('Expected JSON object'); err.status = 400; throw err; }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    const err = new Error('Expected JSON object'); err.status = 400; throw err;
  }
  return parsed;
}
function errorStatus(error) {
  if (error instanceof PreviewAPIError) return error.status;
  if (typeof error.status === 'number') return error.status;
  if (/invalid|viewport|URL|required/i.test(error.message)) return 400;
  return 502;
}

export function createLocalAppServer({ token = process.env.PFX_RESPONSIVE_CORE_TOKEN, coreURL = 'http://127.0.0.1:4177',
  port = 4188, host = '127.0.0.1', fetchImpl = fetch } = {}) {
  if (host !== '127.0.0.1') throw new Error('Local app must bind to IPv4 loopback');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local app port');
  const client = typeof token === 'string' && token.length >= 24
    ? new PreviewClient({ baseURL: coreURL, token, fetchImpl }) : null;
  const workspaces = new Map();
  const origin = () => `http://127.0.0.1:${server.address()?.port ?? port}`;
  const baseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    // Firefox and WebKit send Origin: null for same-origin POSTs when the
    // document uses `no-referrer`. `same-origin` keeps outbound Referer
    // suppressed for other origins without weakening strict Origin checking.
    'referrer-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY' };
  const send = (res, code, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, { ...baseHeaders, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const cleanup = async (key) => {
    const owner = workspaces.get(key);
    if (!owner) return;
    workspaces.delete(key);
    for (const abort of owner.streams) abort.abort();
    await Promise.allSettled([...owner.sessions].map(id => client?.close(id)));
  };
  const server = createServer(async (req, res) => {
    const url = req.url?.split('?')[0] || '/';
    // Require a canonical Host to block DNS rebinding into the loopback service.
    if (req.headers.host !== new URL(origin()).host) return send(res, 403, { error: 'Host forbidden' });
    if (url in MIME && req.method === 'GET') {
      const [file, mime] = MIME[url];
      try {
        const buffer = await readFile(join(root, file));
        res.writeHead(200, { ...baseHeaders, 'content-type': mime,
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
        res.end(buffer);
      } catch { send(res, 500, { error: 'App file unavailable' }); }
      return;
    }
    if (!url.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    // All API requests must come from this exact local application, and carry a
    // non-simple header. Cross-origin forms, images, fetch and DNS rebinding fail.
    if (req.headers['x-pfx-app'] !== '1' ||
      (req.headers.origin && req.headers.origin !== origin()) ||
      ![undefined, 'same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
      return send(res, 403, { error: 'Local application required' });
    }
    if (req.method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return send(res, 415, { error: 'JSON content type required' });
    }
    if (url === '/api/bootstrap' && req.method === 'GET') {
      if (workspaces.size >= 32) return send(res, 429, { error: 'Too many local workspaces' });
      const key = randomBytes(32).toString('hex');
      workspaces.set(key, { sessions: new Set(), streams: new Set(), pendingCreates: 0, lastSeen: Date.now() });
      return send(res, 200, { workspaceKey: key, configured: !!client, maxViews: 4 });
    }
    const key = req.headers['x-pfx-workspace'];
    const owner = typeof key === 'string' ? workspaces.get(key) : undefined;
    if (!owner) return send(res, 401, { error: 'Workspace expired. Reload the app.' });
    owner.lastSeen = Date.now();
    if (url === '/api/status' && req.method === 'GET') {
      if (!client) return send(res, 200, { state: 'unconfigured' });
      try {
        const response = await fetchImpl(`${client.baseURL}/health`, { signal: AbortSignal.timeout(2400), redirect: 'error', cache: 'no-store' });
        if (!response.ok) return send(res, 200, { state: 'offline' });
        // /health is unauthenticated. Test a deliberately nonexistent session
        // to distinguish an accepted credential (404) from an invalid one (401).
        const auth = await fetchImpl(`${client.baseURL}/sessions/00000000-0000-0000-0000-000000000000/screenshot`, {
          headers: { authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(2400)
        });
        return send(res, 200, { state: auth.status === 404 ? 'online' : auth.status === 401 ? 'unauthorized' : 'offline' });
      } catch { return send(res, 200, { state: 'offline' }); }
    }
    if (url === '/api/workspace/close' && req.method === 'POST') {
      send(res, 200, { closed: true });
      void cleanup(key);
      return;
    }
    if (!client) return send(res, 503, { error: 'Core is not configured on this computer' });
    try {
      if (url === '/api/sessions' && req.method === 'POST') {
        if (owner.sessions.size + owner.pendingCreates >= 4) return send(res, 409, { error: 'Maximum 4 previews' });
        const details = await jsonBody(req);
        owner.pendingCreates++;
        let created;
        try { created = await client.create(details); }
        finally { owner.pendingCreates--; }
        if (!workspaces.has(key) || res.destroyed) { await client.close(created.id).catch(() => {}); return; }
        owner.sessions.add(created.id);
        return send(res, 201, created);
      }
      const match = sessionRoute.exec(url);
      if (!match) return send(res, 404, { error: 'Not found' });
      const [, id, action] = match;
      if (!owner.sessions.has(id)) return send(res, 404, { error: 'View not found' });
      if (req.method === 'DELETE' && !action) {
        const result = await client.close(id);
        owner.sessions.delete(id);
        return send(res, 200, result);
      }
      if (req.method === 'POST' && action === 'resize') return send(res, 200, await client.resize(id, await jsonBody(req)));
      if (req.method === 'POST' && action === 'navigate') {
        const body = await jsonBody(req);
        return send(res, 200, await client.navigate(id, body.url));
      }
      if (req.method === 'POST' && action === 'input') return send(res, 200, await client.input(id, await jsonBody(req)));
      if (req.method === 'GET' && action === 'screenshot') {
        const screenshot = await client.screenshot(id);
        if (res.destroyed) return;
        res.writeHead(200, { ...baseHeaders, 'content-type': 'image/png', 'content-length': screenshot.byteLength });
        res.end(screenshot); return;
      }
      if (req.method === 'GET' && action === 'stream') {
        res.writeHead(200, { ...baseHeaders, 'content-type': 'text/event-stream; charset=utf-8', 'connection': 'keep-alive' });
        res.write('retry: 1500\n\n');
        const controller = new AbortController();
        owner.streams.add(controller);
        res.once('close', () => controller.abort());
        try {
          for await (const frame of client.stream(id, { signal: controller.signal })) {
            if (res.destroyed || controller.signal.aborted || !workspaces.has(key)) break;
            if (!res.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`)) {
              await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
            }
          }
        } catch (error) {
          if (!controller.signal.aborted && !res.writableEnded && !res.destroyed) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Core stream disconnected' })}\n\n`);
          }
        } finally { owner.streams.delete(controller); if (!res.writableEnded) res.end(); }
        return;
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = errorStatus(error);
      return send(res, status, { error: status === 502 ? 'Unable to reach preview Core' : error.message });
    }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, item] of workspaces) if (now - item.lastSeen > WORKSPACE_IDLE_MS) void cleanup(key);
  }, 30_000);
  timer.unref();
  return {
    server,
    get origin() { return origin(); },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      });
      return origin();
    },
    async close() {
      clearInterval(timer);
      await Promise.allSettled([...workspaces.keys()].map(cleanup));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PFX_RESPONSIVE_PORT || 4188);
  const app = createLocalAppServer({ port });
  app.listen().then(url => {
    console.log(`PFx Responsive local app: ${url}`);
    if (!process.env.PFX_RESPONSIVE_CORE_TOKEN) console.log('Core token not configured; the app will show disconnected state.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => void app.close().then(() => process.exit(0)));
}
