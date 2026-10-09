/**
 * 开发用检查脚本：读取 --dump-dom 的输出，报告主内容是否渲染、关键结构是否存在。
 * 用法: node tools/dom-report.mjs <dump.txt> [关键词…]
 */
import fs from 'node:fs';

const file = process.argv[2];
const keys = process.argv.slice(3);
const t = fs.readFileSync(file, 'utf8');

const main = t.match(/<main id="main"[^>]*>([\s\S]*?)<\/main>/);
const inner = main ? main[1].replace(/\s+/g, ' ').trim() : '';
console.log('main 长度 :', main ? inner.length : 'NOT FOUND');
console.log('main 开头 :', inner.slice(0, 160) || '(空)');

const fail = t.match(/渲染失败[\s\S]{0,240}/);
if (fail) console.log('⚠ 渲染错误 :', fail[0].replace(/\s+/g, ' '));

for (const k of keys) {
  const n = t.split(k).length - 1;
  console.log(`  ${k} × ${n}`);
}
