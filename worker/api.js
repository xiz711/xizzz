/**
 * form-atlas API —— 跑在 Cloudflare Workers 上，数据存在 D1。
 *
 * 这是 server.mjs 的对应实现：**HTTP 契约完全一致**，前端一行都不用改。
 * 差别只在存储：原来读写 data/*.json，现在读写 D1。
 *
 * 关于图片上传：Workers 没有文件系统，上传改走 R2。没绑 R2 时
 * /api/upload 返回 501 并说明原因，而不是静默失败。
 */

/* ---------- 小工具（与 server.mjs 保持一致） ---------- */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** 与 server.mjs 的 slug 完全相同，保证 id 生成规则不变 */
const slug = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

const badRequest = (msg) => json({ error: msg }, 400);

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

const uniq = (v) => [...new Set((Array.isArray(v) ? v : [])
  .map((x) => String(x || '').trim()).filter(Boolean))];

/* ---------- 行 <-> JSON 的映射 ---------- */

/**
 * 放进 detail 的嵌套字段：从不参与查询，所以整体存 JSON。
 * 判断标准是「数组类型」—— 所有数组字段都进 detail，这样以后数据里
 * 新增数组字段也会自动被保留，不会因为忘记加进白名单而丢失。
 * （标量字段走真正的列，见 styleToRow。）
 */
const SCALAR_KEYS = new Set([
  'id', 'group', 'order', 'nameZh', 'nameEn', 'era', 'region',
  'summary', 'origin', 'critique', 'source', 'createdAt', 'updatedAt',
]);

function splitStyle(s) {
  const scalars = {};
  const detail = {};
  for (const [k, v] of Object.entries(s || {})) {
    if (SCALAR_KEYS.has(k)) scalars[k] = v;
    else detail[k] = v;   // 数组与任何额外字段都保留在 detail 里
  }
  return { scalars, detail };
}

function rowToStyle(row) {
  if (!row) return null;
  let detail = {};
  try { detail = row.detail ? JSON.parse(row.detail) : {}; } catch { detail = {}; }
  return {
    id: row.id,
    group: row.grp ?? '',
    order: row.sort_order ?? 0,
    nameZh: row.name_zh ?? '',
    nameEn: row.name_en ?? '',
    era: row.era ?? '',
    region: row.region ?? '',
    summary: row.summary ?? '',
    origin: row.origin ?? '',
    critique: row.critique ?? '',
    ...detail,
    source: row.source ?? 'kb',
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

function styleToRow(s, { isNew = false } = {}) {
  const { detail } = splitStyle(s);
  return {
    id: s.id,
    grp: s.group ?? '',
    sort_order: Number.isFinite(Number(s.order)) ? Number(s.order) : 500,
    name_zh: s.nameZh ?? '',
    name_en: s.nameEn ?? '',
    era: s.era ?? '',
    region: s.region ?? '',
    summary: s.summary ?? '',
    origin: s.origin ?? '',
    critique: s.critique ?? '',
    detail: JSON.stringify(detail),
    source: s.source || 'kb',
    created_at: isNew ? new Date().toISOString() : (s.createdAt || null),
    updated_at: new Date().toISOString(),
  };
}

function rowToTaxonomy(row) {
  return {
    key: row.key,
    nameZh: row.name_zh ?? '',
    nameEn: row.name_en ?? '',
    desc: row.descr ?? '',
    ...(row.cover ? { cover: row.cover } : {}),
  };
}

/* ---------- 读 ---------- */

const allStyles = async (db) => {
  const { results } = await db.prepare(
    'SELECT * FROM styles ORDER BY sort_order ASC, name_zh ASC'
  ).all();
  return (results || []).map(rowToStyle);
};

const allTaxonomy = async (db) => {
  const { results } = await db.prepare(
    'SELECT * FROM taxonomy ORDER BY sort_order ASC, key ASC'
  ).all();
  return (results || []).map(rowToTaxonomy);
};

async function readTagVocab(db) {
  const { results } = await db.prepare('SELECT kind, name FROM tag_vocab ORDER BY id ASC').all();
  const out = { custom: [], hidden: [] };
  for (const r of results || []) {
    if (r.kind === 'custom') out.custom.push(r.name);
    else if (r.kind === 'hidden') out.hidden.push(r.name);
  }
  return out;
}

async function readMeta(db) {
  const { results } = await db.prepare('SELECT key, value FROM app_meta').all();
  const out = {};
  for (const r of results || []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

/* ---------- 主处理 ---------- */

export async function handleApi(request, env) {
  const db = env.DB;
  if (!db) return json({ error: '没有绑定 D1 数据库（env.DB）' }, 500);

  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    .map((s) => decodeURIComponent(s));
  const [resource, id] = seg;
  const method = request.method.toUpperCase();

  try {
    /* ---- GET /api/bootstrap ---- */
    if (resource === 'bootstrap' && method === 'GET') {
      const [styles, taxonomy, meta, tags] = await Promise.all([
        allStyles(db), allTaxonomy(db), readMeta(db), readTagVocab(db),
      ]);
      return json({ styles, taxonomy, meta, tags });
    }

    /* ---- taxonomy ---- */
    if (resource === 'taxonomy') {
      if (method === 'GET') return json(await allTaxonomy(db));
      if (method === 'PUT') {
        const body = await readJson(request);
        if (!Array.isArray(body)) return badRequest('taxonomy 必须是数组');
        // 整体替换：先清空再写入，与「覆盖写文件」语义一致
        await db.prepare('DELETE FROM taxonomy').run();
        for (let i = 0; i < body.length; i++) {
          const g = body[i] || {};
          if (!g.key) continue;
          await db.prepare(
            `INSERT INTO taxonomy (key, name_zh, name_en, descr, cover, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            String(g.key), String(g.nameZh ?? ''), String(g.nameEn ?? ''),
            String(g.desc ?? ''), g.cover ? String(g.cover) : null, i,
          ).run();
        }
        return json({ ok: true, taxonomy: await allTaxonomy(db) });
      }
    }

    /* ---- tags 词表 ---- */
    if (resource === 'tags') {
      if (method === 'GET') return json(await readTagVocab(db));
      if (method === 'PUT') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return badRequest('tags 必须是对象');
        }
        const custom = uniq(body.custom);
        const hidden = uniq(body.hidden);
        await db.prepare('DELETE FROM tag_vocab').run();
        for (const name of custom) {
          await db.prepare('INSERT INTO tag_vocab (kind, name) VALUES (?, ?)').bind('custom', name).run();
        }
        for (const name of hidden) {
          await db.prepare('INSERT INTO tag_vocab (kind, name) VALUES (?, ?)').bind('hidden', name).run();
        }
        return json({ ok: true, tags: { custom, hidden } });
      }
    }

    /* ---- meta ---- */
    if (resource === 'meta') {
      if (method === 'GET') return json(await readMeta(db));
      if (method === 'PUT') {
        const body = await readJson(request);
        const obj = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
        await db.prepare('DELETE FROM app_meta').run();
        for (const [k, v] of Object.entries(obj)) {
          await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)')
            .bind(String(k), JSON.stringify(v)).run();
        }
        return json({ ok: true });
      }
    }

    /* ---- 图片上传：需要 R2 ---- */
    if (resource === 'upload' && method === 'POST') {
      const bucket = env.UPLOADS;
      if (!bucket) {
        return json({
          error: '未绑定 R2 存储桶，无法保存图片。请在 wrangler.toml 里配置 [[r2_buckets]]（binding = "UPLOADS"）。',
          needsR2: true,
        }, 501);
      }
      const { dataUrl, filename } = await readJson(request);
      const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/
        .exec(String(dataUrl || ''));
      if (!m) return badRequest('仅支持 png/jpeg/webp/gif/avif 的 base64 data URL');
      const ext = m[1] === 'image/jpeg' ? '.jpg' : `.${m[1].split('/')[1]}`;
      const base = slug(String(filename || '').replace(/\.[^.]+$/, '')) || 'img';
      const name = `${base}-${Date.now().toString(36)}${ext}`;
      const bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      if (bytes.length > 12 * 1024 * 1024) return badRequest('图片超过 12MB');
      await bucket.put(`uploads/${name}`, bytes, {
        httpMetadata: { contentType: m[1] },
      });
      // 通过 Worker 自己的 /assets/uploads/* 提供读取（见 index.js）
      return json({ ok: true, url: `/assets/uploads/${name}`, bytes: bytes.length }, 201);
    }

    /* ---- styles ---- */
    if (resource === 'styles') {
      if (method === 'GET' && !id) return json(await allStyles(db));
      if (method === 'GET' && id) {
        const row = await db.prepare('SELECT * FROM styles WHERE id = ?').bind(id).first();
        return row ? json(rowToStyle(row)) : json({ error: '未找到该艺术家' }, 404);
      }

      if (method === 'POST' && !id) {
        const body = await readJson(request);
        if (!body || !body.nameZh) return badRequest('缺少 nameZh');
        let newId = body.id
          ? slug(body.id)
          : (() => {
              const s = slug(body.nameEn || body.nameZh);
              return encodeURIComponent(s) === s ? s : `entry-${Date.now().toString(36)}`;
            })();
        // 与文件版一致：撞 id 就加随机后缀
        for (let guard = 0; guard < 50; guard++) {
          const hit = await db.prepare('SELECT 1 AS x FROM styles WHERE id = ?').bind(newId).first();
          if (!hit) break;
          newId = `${newId}-${Math.random().toString(36).slice(2, 5)}`;
        }
        const entry = {
          ...body,
          id: newId,
          source: 'user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const r = styleToRow(entry, { isNew: true });
        await db.prepare(
          `INSERT INTO styles (id, grp, sort_order, name_zh, name_en, era, region,
             summary, origin, critique, detail, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          r.id, r.grp, r.sort_order, r.name_zh, r.name_en, r.era, r.region,
          r.summary, r.origin, r.critique, r.detail, r.source, r.created_at, r.updated_at,
        ).run();
        return json(entry, 201);
      }

      if (method === 'PUT' && id) {
        const body = await readJson(request);
        const row = await db.prepare('SELECT * FROM styles WHERE id = ?').bind(id).first();
        if (!row) return json({ error: '未找到该艺术家' }, 404);
        // 与文件版一致：浅合并，id 不可被覆盖
        const merged = { ...rowToStyle(row), ...body, id };
        const r = styleToRow(merged);
        await db.prepare(
          `UPDATE styles SET grp=?, sort_order=?, name_zh=?, name_en=?, era=?, region=?,
             summary=?, origin=?, critique=?, detail=?, source=?, updated_at=?
           WHERE id=?`
        ).bind(
          r.grp, r.sort_order, r.name_zh, r.name_en, r.era, r.region,
          r.summary, r.origin, r.critique, r.detail, r.source, r.updated_at, id,
        ).run();
        const after = await db.prepare('SELECT * FROM styles WHERE id = ?').bind(id).first();
        return json(rowToStyle(after));
      }

      if (method === 'DELETE' && id) {
        const row = await db.prepare('SELECT * FROM styles WHERE id = ?').bind(id).first();
        if (!row) return json({ error: '未找到该艺术家' }, 404);
        const removed = rowToStyle(row);
        await db.prepare('DELETE FROM styles WHERE id = ?').bind(id).run();
        // ?purge=1 时清理它引用的图片（R2）
        if (url.searchParams.get('purge') === '1' && env.UPLOADS) {
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
            const key = u.replace(/^\/assets\//, '');
            await env.UPLOADS.delete(key).catch(() => {});
          }
        }
        return json({ ok: true, id });
      }
    }

    /* ---- 批量导入 ---- */
    if (resource === 'import' && method === 'POST') {
      const body = await readJson(request);
      const incoming = Array.isArray(body) ? body : body && body.styles;
      if (!Array.isArray(incoming)) return badRequest('导入内容必须是数组或 {styles:[]}');
      let added = 0;
      let updated = 0;
      for (const raw of incoming) {
        if (!raw || !raw.nameZh) continue;
        const entry = { ...raw, source: raw.source || 'user', updatedAt: new Date().toISOString() };
        const exists = entry.id
          ? await db.prepare('SELECT * FROM styles WHERE id = ?').bind(entry.id).first()
          : null;
        if (exists) {
          const merged = { ...rowToStyle(exists), ...entry };
          const r = styleToRow(merged);
          await db.prepare(
            `UPDATE styles SET grp=?, sort_order=?, name_zh=?, name_en=?, era=?, region=?,
               summary=?, origin=?, critique=?, detail=?, source=?, updated_at=?
             WHERE id=?`
          ).bind(
            r.grp, r.sort_order, r.name_zh, r.name_en, r.era, r.region,
            r.summary, r.origin, r.critique, r.detail, r.source, r.updated_at, entry.id,
          ).run();
          updated++;
        } else {
          let newId = slug(entry.id || entry.nameEn || entry.nameZh);
          for (let guard = 0; guard < 50; guard++) {
            const hit = await db.prepare('SELECT 1 AS x FROM styles WHERE id = ?').bind(newId).first();
            if (!hit) break;
            newId = `${newId}-${Math.random().toString(36).slice(2, 5)}`;
          }
          const r = styleToRow({ ...entry, id: newId, createdAt: new Date().toISOString() }, { isNew: true });
          await db.prepare(
            `INSERT INTO styles (id, grp, sort_order, name_zh, name_en, era, region,
               summary, origin, critique, detail, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            r.id, r.grp, r.sort_order, r.name_zh, r.name_en, r.era, r.region,
            r.summary, r.origin, r.critique, r.detail, r.source, r.created_at, r.updated_at,
          ).run();
          added++;
        }
      }
      const { results } = await db.prepare('SELECT COUNT(*) AS n FROM styles').all();
      return json({ ok: true, added, updated, total: results?.[0]?.n ?? 0 });
    }

    return json({ error: `未知接口 /api/${seg.join('/')}` }, 404);
  } catch (err) {
    return json({ error: err && err.message ? err.message : '服务器内部错误' }, 400);
  }
}
