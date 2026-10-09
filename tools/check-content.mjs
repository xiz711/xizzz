/**
 * 内容体检
 * 用法: node tools/check-content.mjs
 * 检查条目字段完整性、类别归属、标签粒度、识别依据条数，并统计词汇复用情况。
 * 目的是把「一眼看不出」的内容问题（缺字段、标签同义重复、识别依据太空）变成可执行的清单。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styles = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'styles.json'), 'utf8'));
const taxonomy = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));

const REQ_STR = ['id', 'nameZh', 'nameEn', 'group', 'era', 'region', 'summary', 'origin', 'critique'];
const REQ_ARR = ['features', 'identify', 'tags', 'works', 'confusions'];
const MIN = { features: 5, identify: 4, tags: 6, works: 2, confusions: 1 };

const problems = [];
const warnings = [];
const seenIds = new Set();

for (const s of styles) {
  const tag = s.id || s.nameZh || '(缺 id)';
  for (const k of REQ_STR) if (!s[k] || !String(s[k]).trim()) problems.push(`${tag}: 缺少 ${k}`);
  for (const k of REQ_ARR) {
    if (!Array.isArray(s[k]) || !s[k].length) problems.push(`${tag}: 缺少 ${k}`);
    else if (s[k].length < MIN[k]) warnings.push(`${tag}: ${k} 只有 ${s[k].length} 条（建议 ≥ ${MIN[k]}）`);
  }
  if (seenIds.has(s.id)) problems.push(`${tag}: id 重复`);
  seenIds.add(s.id);
  if (!taxonomy.some((g) => g.key === s.group)) problems.push(`${tag}: 类别 ${s.group} 不在 taxonomy.json 中`);
  if (s.summary && s.summary.length < 60) warnings.push(`${tag}: summary 偏短（${s.summary.length} 字）`);
  if (s.critique && s.critique.length < 40) warnings.push(`${tag}: critique 偏短（${s.critique.length} 字）`);
  for (const w of s.works || []) {
    if (!w.title) problems.push(`${tag}: 有作品缺 title`);
    if (!w.author) warnings.push(`${tag}: 作品「${w.title}」缺作者`);
    if (!w.year) warnings.push(`${tag}: 作品「${w.title}」缺年份`);
  }
}

// 标签粒度：同一批次撰写时容易出现「网格 / 网格系统」这类同义分裂
const tagMap = new Map();
for (const s of styles) for (const t of s.tags || []) {
  if (!tagMap.has(t)) tagMap.set(t, []);
  tagMap.get(t).push(s.id);
}
const nearDup = [];
const keys = [...tagMap.keys()];
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i];
    const b = keys[j];
    if (a.length < 6 && b.length < 6) continue;
    if (a.includes(b) || b.includes(a)) nearDup.push(`${a}  ⊃  ${b}`);
  }
}
const single = [...tagMap.entries()].filter(([, v]) => v.length === 1);

console.log('=== 形式风格图谱 · 内容体检 ===');
console.log(`条目 ${styles.length} 则 / 类别 ${taxonomy.length} 个 / 唯一标签 ${tagMap.size} 个`);
console.log('分组:', taxonomy.map((g) => `${g.nameZh}(${styles.filter((s) => s.group === g.key).length})`).join(' '));
console.log(`作品合计 ${styles.reduce((n, s) => n + (s.works || []).length, 0)} 件`);
console.log('');
console.log(`[错误] ${problems.length} 项`);
problems.forEach((p) => console.log('  ✗ ' + p));
console.log(`[提醒] ${warnings.length} 项`);
warnings.forEach((p) => console.log('  ! ' + p));
console.log('');
console.log(`[标签复用] 只出现在 1 则条目里的标签：${single.length} 个（占比 ${Math.round((single.length / tagMap.size) * 100)}%）`);
console.log('  提示：独占标签过多会让标签反查失去意义；共用标签（如下）才是有效的检索线索。');
console.log('  被 2 则以上共用的标签：' +
  [...tagMap.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length)
    .map(([t, v]) => `${t}(${v.length})`).join(' '));
console.log('');
console.log(`[疑似同义标签] ${nearDup.length} 组`);
nearDup.slice(0, 40).forEach((d) => console.log('  ~ ' + d));

process.exit(problems.length ? 1 : 0);
