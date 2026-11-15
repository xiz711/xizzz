/**
 * 在本地把 worker/api.js 的真实代码跑一遍，逐个接口核对。
 *
 * 用的是 node:sqlite 撑起的 D1 模拟层（tools/fake-d1.mjs），
 * 因此不需要安装 wrangler 也能验证后端逻辑是否正确。
 *
 * 用法：node tools/test-d1-api.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.mjs';
import { handleApi } from '../worker/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(ROOT, 'worker', 'schema.sql');

const db = new FakeD1(SCHEMA);
const env = { DB: db };

let pass = 0;
let fail = 0;

const call = async (method, p, body) => {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await handleApi(new Request('https://x' + p, init), env);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
};

/* ---------- 1. 空库读取 ---------- */
console.log('\n[1] 空库读取');
{
  const r = await call('GET', '/api/bootstrap');
  check('bootstrap 200', r.status === 200, 'status=' + r.status);
  check('styles 是空数组', Array.isArray(r.data.styles) && r.data.styles.length === 0);
  check('taxonomy 是空数组', Array.isArray(r.data.taxonomy));
  check('tags 是对象', r.data.tags && 'custom' in r.data.tags && 'hidden' in r.data.tags);
}

/* ---------- 2. 导入种子数据（走 /api/import） ---------- */
console.log('\n[2] 批量导入 data/styles.json');
const seedStyles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'styles.json'), 'utf8'));
const seedTax = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
{
  const r = await call('POST', '/api/import', { styles: seedStyles });
  check('import 200', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  check(`added = ${seedStyles.length}`, r.data.added === seedStyles.length, 'got ' + r.data.added);
  check('updated = 0', r.data.updated === 0);
  check('total 正确', r.data.total === seedStyles.length);

  const t = await call('PUT', '/api/taxonomy', seedTax);
  check('taxonomy PUT 200', t.status === 200);
  check('taxonomy 回写数量正确', t.data.taxonomy.length === seedTax.length);
}

/* ---------- 3. 读回并与原 JSON 逐字段对比 ---------- */
console.log('\n[3] 读回与原 JSON 逐字段对比（这是最关键的一项）');
{
  const r = await call('GET', '/api/styles');
  check('styles 数量一致', r.data.length === seedStyles.length, `${r.data.length} vs ${seedStyles.length}`);

  const byId = new Map(r.data.map((s) => [s.id, s]));
  let diffs = 0;
  const detail = [];
  for (const orig of seedStyles) {
    const got = byId.get(orig.id);
    if (!got) { diffs++; detail.push(`缺 ${orig.id}`); continue; }
    for (const [k, v] of Object.entries(orig)) {
      const a = JSON.stringify(v);
      const b = JSON.stringify(got[k]);
      if (a !== b) { diffs++; detail.push(`${orig.id}.${k}: ${String(a).slice(0, 40)} ≠ ${String(b).slice(0, 40)}`); }
    }
  }
  check('所有条目所有字段完全一致', diffs === 0, detail.slice(0, 5).join(' | '));

  const boot = await call('GET', '/api/bootstrap');
  const bstyles = boot.data.styles;
  const bmap = new Map(bstyles.map((s) => [s.id, s]));
  let bdiffs = 0;
  for (const orig of seedStyles) {
    const got = bmap.get(orig.id);
    if (!got || JSON.stringify(got.tags) !== JSON.stringify(orig.tags)) bdiffs++;
  }
  check('bootstrap 里的条目与原 JSON 一致', bdiffs === 0, 'diffs=' + bdiffs);
}

/* ---------- 4. 单条 CRUD ---------- */
console.log('\n[4] 单条增删改查');
{
  const single = await call('GET', '/api/styles/bauhaus');
  check('GET 单条 200', single.status === 200);
  check('单条 id 正确', single.data.id === 'bauhaus');
  check('嵌套数组保留（works）', Array.isArray(single.data.works) && single.data.works.length > 0);

  const missing = await call('GET', '/api/styles/不存在的东西');
  check('GET 不存在的条目 404', missing.status === 404);

  const created = await call('POST', '/api/styles', {
    nameZh: '测试风格', nameEn: 'Test Style', group: 'modernism',
    summary: '临时条目', tags: ['测试'], works: [{ title: 'x' }],
  });
  check('POST 201', created.status === 201, 'status=' + created.status);
  const newId = created.data.id;
  check('生成了 id', !!newId, 'id=' + newId);
  check('source = user', created.data.source === 'user');

  const updated = await call('PUT', `/api/styles/${encodeURIComponent(newId)}`, { nameZh: '测试风格（改）' });
  check('PUT 200', updated.status === 200);
  check('改名生效', updated.data.nameZh === '测试风格（改）');
  check('原字段未丢（summary 保留）', updated.data.summary === '临时条目', 'got ' + updated.data.summary);
  check('id 未被覆盖', updated.data.id === newId);

  const del = await call('DELETE', `/api/styles/${encodeURIComponent(newId)}`);
  check('DELETE 200', del.status === 200 && del.data.ok === true);
  const gone = await call('GET', `/api/styles/${encodeURIComponent(newId)}`);
  check('删除后 404', gone.status === 404);
}

/* ---------- 5. 文件夹增删（taxonomy） ---------- */
console.log('\n[5] 文件夹（taxonomy）增删改');
{
  const before = (await call('GET', '/api/taxonomy')).data;
  const added = [...before, { key: 'tmp-cat', nameZh: '临时类别', nameEn: 'Tmp', desc: '' }];
  const r1 = await call('PUT', '/api/taxonomy', added);
  check('新增后数量 +1', r1.data.taxonomy.length === before.length + 1);

  const renamed = r1.data.taxonomy.map((g) => (g.key === 'tmp-cat' ? { ...g, nameZh: '改过名' } : g));
  const r2 = await call('PUT', '/api/taxonomy', renamed);
  const got = r2.data.taxonomy.find((g) => g.key === 'tmp-cat');
  check('改名生效', got && got.nameZh === '改过名');

  const r3 = await call('PUT', '/api/taxonomy', r2.data.taxonomy.filter((g) => g.key !== 'tmp-cat'));
  check('删除后数量恢复', r3.data.taxonomy.length === before.length);
  check('其余类别未受影响的字段正确', r3.data.taxonomy[0].nameZh === before[0].nameZh);
  check('desc 字段往返正确', r3.data.taxonomy[0].desc === before[0].desc, 'got ' + String(r3.data.taxonomy[0].desc).slice(0, 40));
}

/* ---------- 6. 标签词表 ---------- */
console.log('\n[6] 标签词表');
{
  const r = await call('PUT', '/api/tags', { custom: ['新标签', '新标签', '  '], hidden: ['隐藏的'] });
  check('PUT 200', r.status === 200);
  check('去重与去空生效', r.data.tags.custom.length === 1 && r.data.tags.custom[0] === '新标签');
  const back = await call('GET', '/api/tags');
  check('读回与写入一致', JSON.stringify(back.data) === JSON.stringify({ custom: ['新标签'], hidden: ['隐藏的'] }), JSON.stringify(back.data));
  await call('PUT', '/api/tags', { custom: [], hidden: [] });
  check('清空后为空', JSON.stringify((await call('GET', '/api/tags')).data) === JSON.stringify({ custom: [], hidden: [] }));
}

/* ---------- 7. 错误与边界 ---------- */
console.log('\n[7] 错误与边界');
{
  const noName = await call('POST', '/api/styles', { nameEn: 'no name' });
  check('缺 nameZh → 400', noName.status === 400, 'status=' + noName.status);

  const badTax = await call('PUT', '/api/taxonomy', { not: 'array' });
  check('taxonomy 非数组 → 400', badTax.status === 400);

  const badTags = await call('PUT', '/api/tags', ['a']);
  check('tags 非对象 → 400', badTags.status === 400);

  const unknown = await call('GET', '/api/nope');
  check('未知接口 → 404', unknown.status === 404);

  const upload = await call('POST', '/api/upload', { dataUrl: 'data:image/png;base64,AAAA', filename: 'a.png' });
  check('未绑 R2 时 upload → 501 且说明原因', upload.status === 501 && upload.data.needsR2 === true, 'status=' + upload.status);

  const badUpload = await call('POST', '/api/upload', { dataUrl: 'not-a-data-url' });
  check('upload 无 R2 时优先报 501（不是 400）', badUpload.status === 501);
}

/* ---------- 8. 重复导入的幂等性 ---------- */
console.log('\n[8] 重复导入同一批数据（幂等性）');
{
  const r = await call('POST', '/api/import', { styles: seedStyles });
  check('全部按更新处理，不再新增', r.data.added === 0 && r.data.updated === seedStyles.length,
    `added=${r.data.added} updated=${r.data.updated}`);
  const total = (await call('GET', '/api/styles')).data.length;
  check('总数不变', total === seedStyles.length, `total=${total}`);
}

/* ---------- 结果 ---------- */
db.close();
console.log(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
