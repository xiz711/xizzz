/**
 * 端到端测试 worker/index.js 的路由：
 *   /api/*            → api.js（走 D1）
 *   /assets/uploads/* → R2（这里用假桶）
 *   其它              → 静态资源（这里用文件系统假绑定）
 *
 * 这样不需要 wrangler 就能验证「入口 → API → 静态」整条链路。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.mjs';
import worker from '../worker/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/* 假的静态资源绑定：直接读 public/ */
const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('not found', { status: 404 });
    }
    const ext = path.extname(file);
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2', '.json': 'application/json',
    }[ext] || 'application/octet-stream';
    return new Response(fs.readFileSync(file), { headers: { 'content-type': mime } });
  },
};

/* 假的 R2 桶 */
const store = new Map();
const UPLOADS = {
  async put(key, bytes, opts) {
    store.set(key, { bytes, ct: opts?.httpMetadata?.contentType });
    return { key };
  },
  async get(key) {
    const v = store.get(key);
    if (!v) return null;
    return {
      body: v.bytes,
      httpEtag: 'W/"fake"',
      httpMetadata: { contentType: v.ct },
    };
  },
  async delete(key) { store.delete(key); },
};

const db = new FakeD1(path.join(ROOT, 'worker', 'schema.sql'));
const env = { DB: db, ASSETS, UPLOADS };

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
};

const hit = async (p, init) => {
  const req = new Request('https://xizzz.example' + p, init);
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  return { status: res.status, ct: res.headers.get('content-type') || '', body: text };
};

console.log('\n[A] 静态资源');
{
  const r = await hit('/');
  check('GET / → 200 html', r.status === 200 && r.ct.includes('text/html'), r.status + ' ' + r.ct);
  check('返回的是真实的 index.html', r.body.includes('<title>形式风格图谱'), r.body.slice(0, 80));

  const js = await hit('/assets/app.js');
  check('GET /assets/app.js → 200 js', js.status === 200 && js.ct.includes('javascript'), js.ct);
  check('app.js 有实际内容', js.body.length > 50000, 'len=' + js.body.length);

  const seed = await hit('/assets/seed.js');
  check('GET /assets/seed.js → 200 js（离线兜底可用）', seed.status === 200 && seed.ct.includes('javascript'), seed.status + ' ' + seed.ct);
  check('seed.js 含 seedStyles 导出', seed.body.includes('export const seedStyles'));

  const css = await hit('/assets/app.css');
  check('GET /assets/app.css → 200 css', css.status === 200 && css.ct.includes('css'));
}

console.log('\n[B] API 路由');
{
  const b = await hit('/api/bootstrap');
  check('/api/bootstrap → 200 json', b.status === 200 && b.ct.includes('json'), b.status + ' ' + b.ct);
  const d = JSON.parse(b.body);
  check('空库时 styles 为空数组', Array.isArray(d.styles) && d.styles.length === 0);

  const seedStyles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'styles.json'), 'utf8'));
  const imp = await hit('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ styles: seedStyles }),
  });
  check('POST /api/import → 200', imp.status === 200, imp.body.slice(0, 100));

  const b2 = JSON.parse((await hit('/api/bootstrap')).body);
  check(`导入后 bootstrap 返回 ${seedStyles.length} 条`, b2.styles.length === seedStyles.length, 'got ' + b2.styles.length);
  check('条目带完整 detail（figures）', Array.isArray(b2.styles[0].figures) && b2.styles[0].figures.length > 0);

  const one = await hit('/api/styles/bauhaus');
  check('GET /api/styles/bauhaus → 200', one.status === 200);

  const nf = await hit('/api/styles/zzz-nope');
  check('GET 不存在 → 404', nf.status === 404, 'status=' + nf.status);

  const junk = await hit('/api/whatever');
  check('未知接口 → 404', junk.status === 404);
}

console.log('\n[C] 图片上传（R2 假桶）');
{
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const up = await hit('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl: png, filename: 'My Photo.png' }),
  });
  check('POST /api/upload → 201', up.status === 201, up.body.slice(0, 120));
  const info = JSON.parse(up.body);
  check('返回的 url 以 /assets/uploads/ 开头', String(info.url).startsWith('/assets/uploads/'), info.url);
  check('文件名被规范化（无空格/中文）', /^\/assets\/uploads\/[a-z0-9-]+\.png$/.test(info.url), info.url);

  const img = await hit(info.url);
  check('上传后能从 /assets/uploads/ 读回', img.status === 200, 'status=' + img.status);
  check('content-type 是 image/png', img.ct.includes('image/png'), img.ct);
}

console.log('\n[D] 无 R2 时的降级');
{
  const noR2 = { DB: db, ASSETS };
  const res = await worker.fetch(new Request('https://x/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl: 'data:image/png;base64,AAAA' }),
  }), noR2, {});
  check('未绑 R2 → 501 且带 needsR2 说明', res.status === 501, 'status=' + res.status);
  const j = JSON.parse(await res.text());
  check('错误信息说明了原因', typeof j.error === 'string' && j.error.includes('R2'), String(j.error).slice(0, 60));
}

db.close();
console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
