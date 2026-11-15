/**
 * 本地「真实 HTTP」开发服务器 —— 用真正的 worker/index.js 处理请求。
 *
 * 为什么需要它：沙箱里跑不了 `wrangler dev`（它依赖 workerd 这个原生二进制，
 * 与 sh.exe 一样会被命名管道限制挡住）。这个脚本用 node:http 起一个真实端口，
 * 把请求交给**同一份** worker 代码，并用 node:sqlite 提供 D1。
 * 因此它是除 miniflare 之外最接近真实的运行方式，也方便手动点着验收。
 *
 * 用法：
 *   node tools/serve-local.mjs            # 默认 4173
 *   PORT=4180 node tools/serve-local.mjs
 *
 * 首次会把 worker/seed.sql 灌进内存库；没有 seed.sql 就是空库。
 * 数据在内存里，进程退出即丢 —— 适合验收，不适合存东西。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.mjs';
import worker from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
};

/* ---- D1：内存 SQLite + schema + seed ---- */
const db = new FakeD1(path.join(ROOT, 'worker', 'schema.sql'));
const seedFile = path.join(ROOT, 'worker', 'seed.sql');
let seeded = 0;
if (fs.existsSync(seedFile)) {
  db.db.exec(fs.readFileSync(seedFile, 'utf8'));
  seeded = db.db.prepare('SELECT COUNT(*) AS n FROM styles').get().n;
}

/* ---- 假 R2：内存 Map，便于验证上传链路 ---- */
const objects = new Map();
const UPLOADS = {
  async put(key, bytes, opts) {
    objects.set(key, { bytes: Buffer.from(bytes), ct: opts?.httpMetadata?.contentType });
    return { key };
  },
  async get(key) {
    const v = objects.get(key);
    if (!v) return null;
    return { body: v.bytes, httpEtag: `W/"${v.bytes.length}"`, httpMetadata: { contentType: v.ct } };
  },
  async delete(key) { objects.delete(key); },
};

/* ---- 静态资源：读 public/ ---- */
const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel) rel = 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('not found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' },
    });
  },
};

const env = { DB: db, ASSETS, UPLOADS };

/* ---- 把 node:http 的请求转成 Web Request，再把 Response 写回去 ---- */
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }

    const request = new Request(`http://${req.headers.host || '127.0.0.1'}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });

    const response = await worker.fetch(request, env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('内部错误: ' + (err?.message || err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地真实 Worker 服务已启动 → http://127.0.0.1:${PORT}`);
  console.log(`数据: 内存 D1${seeded ? `（已灌入 ${seeded} 则条目）` : '（空库，先跑 migrate-to-d1.mjs --sql）'}`);
  console.log('入口是 worker/index.js 本身，与部署到 Cloudflare 的代码完全一致');
});
