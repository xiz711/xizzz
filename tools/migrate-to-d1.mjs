/**
 * 把 data/*.json 迁移进 D1（SQLite）。
 *
 * 两种用法：
 *   1) 生成 SQL 文件，交给 wrangler 执行（推荐）
 *        node tools/migrate-to-d1.mjs --sql > worker/seed.sql
 *        npx wrangler d1 execute form-atlas --file=worker/seed.sql --remote
 *
 *   2) 直接写进一个本地 SQLite 文件（用于本地核对）
 *        node tools/migrate-to-d1.mjs --db ./local.sqlite
 *
 * 迁移逻辑与 worker/api.js 的 styleToRow 保持一致，避免两边规则漂移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

/** 与 worker/api.js 的 splitStyle 同一套规则：标量进列，其余进 detail */
const SCALAR_KEYS = new Set([
  'id', 'group', 'order', 'nameZh', 'nameEn', 'era', 'region',
  'summary', 'origin', 'critique', 'source', 'createdAt', 'updatedAt',
]);

const styles = read('styles.json');
const taxonomy = read('taxonomy.json');
let tags = { custom: [], hidden: [] };
try { tags = read('tags.json'); } catch { /* 没有就用空词表 */ }

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : 'NULL');

function styleRow(s, i) {
  const detail = {};
  for (const [k, v] of Object.entries(s || {})) {
    if (!SCALAR_KEYS.has(k)) detail[k] = v;
  }
  return {
    id: s.id,
    grp: s.group ?? '',
    sort_order: Number.isFinite(Number(s.order)) ? Number(s.order) : (i + 1) * 10,
    name_zh: s.nameZh ?? '',
    name_en: s.nameEn ?? '',
    era: s.era ?? '',
    region: s.region ?? '',
    summary: s.summary ?? '',
    origin: s.origin ?? '',
    critique: s.critique ?? '',
    detail: JSON.stringify(detail),
    source: s.source || 'kb',
    created_at: s.createdAt || null,
    updated_at: s.updatedAt || new Date().toISOString(),
  };
}

const lines = [];
lines.push('-- 由 tools/migrate-to-d1.mjs 生成，请勿手工编辑');
lines.push(`-- 条目 ${styles.length} 则 / 类别 ${taxonomy.length} 个`);
lines.push('');
lines.push('DELETE FROM styles;');
lines.push('DELETE FROM taxonomy;');
lines.push('DELETE FROM tag_vocab;');
lines.push('');

styles.forEach((s, i) => {
  const r = styleRow(s, i);
  lines.push(
    'INSERT INTO styles (id, grp, sort_order, name_zh, name_en, era, region, summary, origin, critique, detail, source, created_at, updated_at) VALUES ('
    + [q(r.id), q(r.grp), n(r.sort_order), q(r.name_zh), q(r.name_en), q(r.era), q(r.region),
       q(r.summary), q(r.origin), q(r.critique), q(r.detail), q(r.source), q(r.created_at), q(r.updated_at)].join(', ')
    + ');'
  );
});

lines.push('');
taxonomy.forEach((g, i) => {
  lines.push(
    'INSERT INTO taxonomy (key, name_zh, name_en, descr, cover, sort_order) VALUES ('
    + [q(g.key), q(g.nameZh), q(g.nameEn ?? ''), q(g.desc ?? ''), g.cover ? q(g.cover) : 'NULL', String(i)].join(', ')
    + ');'
  );
});

lines.push('');
for (const name of tags.custom || []) {
  lines.push(`INSERT INTO tag_vocab (kind, name) VALUES ('custom', ${q(name)});`);
}
for (const name of tags.hidden || []) {
  lines.push(`INSERT INTO tag_vocab (kind, name) VALUES ('hidden', ${q(name)});`);
}
lines.push('');

const sql = lines.join('\n');
const argv = process.argv.slice(2);

if (argv.includes('--sql') || argv.length === 0) {
  if (argv.includes('--sql')) {
    process.stdout.write(sql);
  } else {
    const out = path.join(ROOT, 'worker', 'seed.sql');
    fs.writeFileSync(out, sql, 'utf8');
    console.log(`已写出 ${path.relative(ROOT, out)}：条目 ${styles.length} / 类别 ${taxonomy.length}`);
  }
} else if (argv.includes('--db')) {
  const file = argv[argv.indexOf('--db') + 1];
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
  db.exec(sql);
  const c = db.prepare('SELECT COUNT(*) AS n FROM styles').get();
  const t = db.prepare('SELECT COUNT(*) AS n FROM taxonomy').get();
  console.log(`已写入 ${file}：条目 ${c.n} / 类别 ${t.n}`);
  db.close();
}
