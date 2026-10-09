/**
 * 形式风格图谱 · 本地数据服务
 * 零依赖。职责：
 *   1. 静态托管 public/
 *   2. 提供 JSON 读写 API，使站点内容可以持续扩充（新增/编辑/删除风格）
 *   3. 接收图片上传，落盘到 public/assets/uploads/
 * 数据文件：data/styles.json、data/taxonomy.json
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'assets', 'uploads');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const DATA_FILES = {
  styles: path.join(DATA_DIR, 'styles.json'),
  taxonomy: path.join(DATA_DIR, 'taxonomy.json'),
  meta: path.join(DATA_DIR, 'meta.json'),
  // 标签词表：条目里的标签是自由填写的，「可用标签」另存一份便于增删管理
  tags: path.join(DATA_DIR, 'tags.json'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/* ---------- 工具 ---------- */

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
};

const readBody = (req, limit = 25 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大（上限 25MB）'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const readJsonBody = async (req) => {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 400 });
  }
};

async function readData(key) {
  try {
    return JSON.parse(await fsp.readFile(DATA_FILES[key], 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      // meta 与 tags 是对象型数据，其余是数组
      if (key === 'meta') return {};
      if (key === 'tags') return { custom: [], hidden: [] };
      return [];
    }
    throw err;
  }
}

/** 原子写入：先写临时文件再改名，避免中途中断损坏数据 */
let writeChain = Promise.resolve();
function writeData(key, value) {
  writeChain = writeChain.then(async () => {
    const tmp = `${DATA_FILES[key]}.tmp`;
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rename(tmp, DATA_FILES[key]);
  });
  return writeChain;
}

const slug = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

const safeName = (s) =>
  path
    .basename(String(s || 'upload'))
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    .slice(-80);

/* ---------- 静态资源 ---------- */

async function serveStatic(req, res, urlPath) {
  // WHATWG URL 已对 pathname 做过一次百分号解码，这里再解一次会让含 % 的文件名抛错，故做保护
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    rel = urlPath;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      .end('<h1>404</h1><p>找不到该资源。<a href="/">返回图谱首页</a></p>');
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(302, { location: rel.replace(/\/?$/, '/') + 'index.html' }).end();
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).pipe(res);
}

/* ---------- API ---------- */

async function handleApi(req, res, url, pathnameOverride) {
  // 每段都已由 URL 解析器解码，因此含中文的 id 必须再解一次百分号编码才能匹配
  const seg = (pathnameOverride || url.pathname)
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const [resource, id, action] = seg;
  const method = req.method || 'GET';

  // GET /api/bootstrap —— 一次性取回全部内容
  if (resource === 'bootstrap' && method === 'GET') {
    const [styles, taxonomy, meta, tags] = await Promise.all([
      readData('styles'),
      readData('taxonomy'),
      readData('meta'),
      readData('tags'),
    ]);
    return json(res, 200, { styles, taxonomy, meta, tags });
  }

  if (resource === 'taxonomy') {
    if (method === 'GET') return json(res, 200, await readData('taxonomy'));
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body)) throw Object.assign(new Error('taxonomy 必须是数组'), { code: 400 });
      await writeData('taxonomy', body);
      return json(res, 200, { ok: true, taxonomy: body });
    }
  }

  // 标签词表：{ custom: string[], hidden: string[] }
  // custom —— 手工新增、条目里可能还没人用的标签
  // hidden —— 从「可用标签」里移除掉的标签（条目上的标签本身不动，随时能加回来）
  if (resource === 'tags') {
    if (method === 'GET') return json(res, 200, await readData('tags'));
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw Object.assign(new Error('tags 必须是对象'), { code: 400 });
      }
      const clean = (v) => [...new Set((Array.isArray(v) ? v : [])
        .map((x) => String(x || '').trim()).filter(Boolean))];
      const next = { custom: clean(body.custom), hidden: clean(body.hidden) };
      await writeData('tags', next);
      return json(res, 200, { ok: true, tags: next });
    }
  }

  if (resource === 'meta') {
    if (method === 'GET') return json(res, 200, await readData('meta'));
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      await writeData('meta', body && typeof body === 'object' ? body : {});
      return json(res, 200, { ok: true });
    }
  }

  if (resource === 'upload' && method === 'POST') {
    const { dataUrl, filename } = await readJsonBody(req);
    const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
      String(dataUrl || '')
    );
    if (!m) throw Object.assign(new Error('仅支持 png/jpeg/webp/gif/avif 的 base64 data URL'), { code: 400 });
    const ext = m[1] === 'image/jpeg' ? '.jpg' : `.${m[1].split('/')[1]}`;
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (buf.length > 12 * 1024 * 1024) throw Object.assign(new Error('图片超过 12MB'), { code: 413 });
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const name = `${stamp}-${Date.now().toString(36)}-${slug(path.basename(filename || 'img', path.extname(filename || '')))}${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return json(res, 201, { ok: true, url: `/assets/uploads/${name}`, bytes: buf.length });
  }

  if (resource === 'styles') {
    const styles = await readData('styles');

    if (method === 'GET' && !id) return json(res, 200, styles);
    if (method === 'GET' && id) {
      const found = styles.find((s) => s.id === id);
      return found ? json(res, 200, found) : json(res, 404, { error: '未找到该风格' });
    }

    if (method === 'POST' && !id) {
      const body = await readJsonBody(req);
      if (!body || !body.nameZh) throw Object.assign(new Error('缺少 nameZh'), { code: 400 });
      // 显式传入 id 时以调用方为准；否则由名称生成。用 encodeURIComponent 判断是否只剩
      // ASCII，避免把中文名生成的 id 再塞进 URL 时经历一次不必要的百分号编码。
      let newId = body.id
        ? slug(body.id)
        : (() => {
            const s = slug(body.nameEn || body.nameZh);
            return encodeURIComponent(s) === s ? s : `entry-${Date.now().toString(36)}`;
          })();
      while (styles.some((x) => x.id === newId)) newId = `${newId}-${Math.random().toString(36).slice(2, 5)}`;
      const entry = {
        ...body,
        id: newId,
        source: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      styles.push(entry);
      await writeData('styles', styles);
      return json(res, 201, entry);
    }

    if (method === 'PUT' && id) {
      const body = await readJsonBody(req);
      const i = styles.findIndex((s) => s.id === id);
      if (i < 0) return json(res, 404, { error: '未找到该风格' });
      styles[i] = { ...styles[i], ...body, id, updatedAt: new Date().toISOString() };
      await writeData('styles', styles);
      return json(res, 200, styles[i]);
    }

    if (method === 'DELETE' && id) {
      const i = styles.findIndex((s) => s.id === id);
      if (i < 0) return json(res, 404, { error: '未找到该风格' });
      const [removed] = styles.splice(i, 1);
      await writeData('styles', styles);
      // 顺手清理该条目上传的图片（仅限本站 uploads 目录）
      if (url.searchParams.get('purge') === '1') {
        const urls = new Set();
        const walk = (v) => {
          if (!v) return;
          if (typeof v === 'string') {
            if (v.startsWith('/assets/uploads/')) urls.add(v);
          } else if (Array.isArray(v)) v.forEach(walk);
          else if (typeof v === 'object') Object.values(v).forEach(walk);
        };
        walk(removed);
        for (const u of urls) {
          await fsp.rm(path.join(PUBLIC_DIR, u.replace(/^\//, '')), { force: true }).catch(() => {});
        }
      }
      return json(res, 200, { ok: true, id });
    }
  }

  // 内容包导入 / 导出：便于备份与批量扩充
  if (resource === 'import' && method === 'POST') {
    const body = await readJsonBody(req);
    const incoming = Array.isArray(body) ? body : body.styles;
    if (!Array.isArray(incoming)) throw Object.assign(new Error('导入内容必须是数组或 {styles:[]}'), { code: 400 });
    const styles = await readData('styles');
    let added = 0;
    let updated = 0;
    for (const raw of incoming) {
      if (!raw || !raw.nameZh) continue;
      const entry = { ...raw, source: raw.source || 'user', updatedAt: new Date().toISOString() };
      const i = entry.id ? styles.findIndex((s) => s.id === entry.id) : -1;
      if (i >= 0) {
        styles[i] = { ...styles[i], ...entry };
        updated++;
      } else {
        let newId = slug(entry.id || entry.nameEn || entry.nameZh);
        while (styles.some((s) => s.id === newId)) newId = `${newId}-${Math.random().toString(36).slice(2, 5)}`;
        styles.push({ ...entry, id: newId, createdAt: new Date().toISOString() });
        added++;
      }
    }
    await writeData('styles', styles);
    return json(res, 200, { ok: true, added, updated, total: styles.length });
  }

  return json(res, 404, { error: `未知接口 /api/${seg.join('/')}` });
}

/* ---------- 启动 ---------- */

const server = http.createServer(async (req, res) => {
  // URL 解析必须容错：形如 "//" 的请求路径会让 new URL 抛错，
  // 若放在 try 之外，一个畸形请求就能让整个服务退出。
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad Request');
    return;
  }
  // 折叠重复斜杠，避免 "//api//styles" 这类路径绕过前缀判断
  const pathname = url.pathname.replace(/\/{2,}/g, '/');

  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, url, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed');
      return;
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    const code = err.code && Number.isInteger(err.code) ? err.code : 500;
    if (code === 500) console.error('[error]', pathname, err);
    json(res, code, { error: err.message || '服务器内部错误' });
  }
});

// 兜底：任何未捕获的异常都不应让知识库变成打不开的页面
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

await fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
server.listen(PORT, HOST, () => {
  console.log(`形式风格图谱已启动 → http://${HOST}:${PORT}`);
});
