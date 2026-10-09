/**
 * 内容合并工具
 * 用法: node tools/merge-styles.mjs tools/_batch2.json
 * 把批次文件（条目数组）并入 data/styles.json：同 id 覆盖，新 id 追加，按 group + order 重排。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'data', 'styles.json');

const GROUP_ORDER = ['modernism', 'postmodern', 'digital', 'heritage', 'editorial'];
const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/merge-styles.mjs <批次文件…>');
  process.exit(1);
}

const existing = JSON.parse(await fs.readFile(TARGET, 'utf8'));
const byId = new Map(existing.map((s) => [s.id, s]));

let added = 0;
let updated = 0;
for (const f of files) {
  const batch = JSON.parse(await fs.readFile(path.resolve(ROOT, f), 'utf8'));
  for (const item of batch) {
    if (!item.id || !item.nameZh) {
      console.warn('跳过无效条目:', item && item.id);
      continue;
    }
    if (byId.has(item.id)) {
      byId.set(item.id, { ...byId.get(item.id), ...item });
      updated++;
    } else {
      byId.set(item.id, { source: 'kb', ...item });
      added++;
    }
  }
}

const rank = (s) => {
  const gi = GROUP_ORDER.indexOf(s.group);
  return [gi < 0 ? 99 : gi, Number(s.order) || 500, s.nameZh];
};
const merged = [...byId.values()].sort((a, b) => {
  const [g1, o1, n1] = rank(a);
  const [g2, o2, n2] = rank(b);
  return g1 - g2 || o1 - o2 || String(n1).localeCompare(String(n2), 'zh');
});

await fs.writeFile(TARGET, JSON.stringify(merged, null, 2), 'utf8');
console.log(`完成：新增 ${added} 条，更新 ${updated} 条，总计 ${merged.length} 条`);
console.log('分组统计:', merged.reduce((m, s) => ((m[s.group] = (m[s.group] || 0) + 1), m), {}));
