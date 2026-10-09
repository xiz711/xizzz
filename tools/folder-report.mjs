/**
 * 开发用：从 --dump-dom 输出里读出当前文件夹与三层结构
 * 用法: node tools/folder-report.mjs <dump.txt> [...]
 */
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const t = fs.readFileSync(file, 'utf8');
  const folders = [...t.matchAll(/class="folder (is-prev|is-cur|is-next)"[\s\S]{0,200}?aria-label="([^"]+)"/g)]
    .map((m) => `${m[1].replace('is-', '')}=${m[2]}`);
  const edge = (t.match(/folder folder--edge/g) || []).length;
  const err = /渲染失败/.test(t) ? (t.match(/渲染失败[\s\S]{0,120}/) || [''])[0].replace(/\s+/g, ' ') : '';
  console.log(`${file}: [${folders.join(' | ')}] 占位边=${edge}${err ? ' ⚠ ' + err : ''}`);
}
