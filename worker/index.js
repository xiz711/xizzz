/**
 * Cloudflare Worker —— 让站点在 Cloudflare 上以**只读**方式运行。
 *
 * 它能做什么：
 *   /api/bootstrap 由这个 Worker 提供，数据直接来自仓库里的 data/*.json。
 *   因此首页、分类、总览、标签、辨识、条目详情**全部正常**，
 *   而且内容和你在仓库里提交的完全一致（不是退回 seed.js 的旧快照）。
 *
 * 它不能做什么（这是 Cloudflare 的硬限制，不是配置问题）：
 *   「扩充」页的保存、条目增删、文件夹新建/重命名/删除、上传图片
 *   —— 这些都要写文件。Cloudflare Workers 没有持久文件系统，
 *   node:fs 在这些运行时里对写入是无效的。所以这些接口一律返回 501，
 *   前端会给出提示而不是静默失败。
 *
 * 想保留编辑功能有两个办法：
 *   1) 继续用 Node 主机（Render / Railway / 自己的服务器）跑 server.mjs
 *   2) 把 data/*.json 换成 Cloudflare D1，并把本文件里的写入接口实现成 SQL（改动较大）
 */
import styles from '../data/styles.json';
import taxonomy from '../data/taxonomy.json';
import tags from '../data/tags.json';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // 数据是仓库里的静态内容，可以短缓存
  'cache-control': 'public, max-age=60',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 需要写文件的接口：在 Cloudflare 上一律不可用 */
const WRITE_ROUTES = [
  ['POST', '/api/styles'],
  ['POST', '/api/upload'],
  ['POST', '/api/import'],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // ---- 读接口：全部由仓库数据提供 ----
    if (p === '/api/bootstrap' && method === 'GET') {
      return json({ styles, taxonomy, meta: {}, tags });
    }
    if (p === '/api/styles' && method === 'GET') return json(styles);
    if (p === '/api/taxonomy' && method === 'GET') return json(taxonomy);
    if (p === '/api/tags' && method === 'GET') return json(tags);

    if (p.startsWith('/api/styles/') && method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/styles/'.length));
      const found = styles.find((s) => String(s.id) === id);
      return found ? json(found) : json({ error: '未找到该风格' }, 404);
    }

    // ---- 写接口：明确告知不可用，而不是静默失败 ----
    const isWrite =
      (p.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method));
    if (isWrite || WRITE_ROUTES.some(([m, r]) => m === method && p === r)) {
      return json({
        error: 'Cloudflare 上站点是只读的：没有持久文件系统，无法保存改动。请在本地编辑后 push 到仓库。',
        readonly: true,
      }, 501);
    }

    if (p.startsWith('/api/')) return json({ error: `未知接口 ${p}` }, 404);

    // ---- 其余交给静态资源（wrangler.toml 里的 [assets]）----
    // 前端是 hash 路由的单页应用，任何非文件请求都回到 index.html
    if (!/\.[a-z0-9]+$/i.test(p)) {
      const indexUrl = new URL('/index.html', url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
};
