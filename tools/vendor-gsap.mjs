/**
 * 从浏览器 dump 出来的 HTML 里提取 GSAP 与 ScrollTrigger 源码，落到 public/vendor/。
 * 这样站点运行时不依赖任何外部 CDN。
 */
import fs from 'node:fs';
import path from 'node:path';

const dump = process.argv[2] || '_shots/gsap-dom.txt';
const outDir = 'public/vendor';
fs.mkdirSync(outDir, { recursive: true });

const html = fs.readFileSync(dump, 'utf8');

/** 取出 <pre id="X">…</pre> 之间的文本并还原 HTML 实体 */
function extract(id) {
  const re = new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`);
  const m = html.match(re);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const targets = [
  ['gsap', 'gsap.min.js'],
  ['st', 'ScrollTrigger.min.js'],
];

let ok = 0;
for (const [id, file] of targets) {
  const src = extract(id);
  if (!src || src.startsWith('FETCH_FAILED') || src.includes('@@')) {
    console.log(`✗ ${file}：未取到（${(src || '').slice(0, 60)}）`);
    continue;
  }
  const dest = path.join(outDir, file);
  fs.writeFileSync(dest, src, 'utf8');
  console.log(`✓ ${file}：${src.length} 字节`);
  ok++;
}
console.log(`完成 ${ok}/${targets.length}`);
process.exit(ok === targets.length ? 0 : 1);
