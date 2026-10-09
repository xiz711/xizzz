/**
 * 生成 public/assets/seed.js
 * 把 data/ 下的内容内联成 ES 模块，作为接口不可用时的离线兜底：
 * 此时直接双击 public/index.html 也能浏览全部条目（只读，无法保存）。
 *
 * ⚠️ 路径必须是 public/assets/ 而不是 public/：
 *   前端在 public/assets/app.js 里用 `import('./seed.js')` 动态加载兜底数据，
 *   相对 app.js 解析出来是 /assets/seed.js。早先写在 public/seed.js
 *   （即 /seed.js）时这个兜底从来没被加载成功过，只是本地有 /api 可用所以没暴露。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, 'data', f), 'utf8'));

const styles = await read('styles.json');
const taxonomy = await read('taxonomy.json');

const banner = `/**
 * 自动生成，请勿手工编辑 —— 修改内容请改 data/styles.json 与 data/taxonomy.json，
 * 然后运行: node tools/build-seed.mjs
 * 生成时间: ${new Date().toISOString()}
 * 条目数: ${styles.length} / 类别数: ${taxonomy.length}
 */
`;

const body = `${banner}export const seedStyles = ${JSON.stringify(styles, null, 2)};

export const seedTaxonomy = ${JSON.stringify(taxonomy, null, 2)};
`;

const outDir = path.join(ROOT, 'public', 'assets');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'seed.js'), body, 'utf8');
// 清掉早先放错位置的副本，避免两份并存
await fs.rm(path.join(ROOT, 'public', 'seed.js'), { force: true });
console.log(`已生成 public/assets/seed.js：${styles.length} 则条目，${taxonomy.length} 个类别`);
