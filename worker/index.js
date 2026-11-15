/**
 * Cloudflare Worker 入口：/api/* 交给 api.js（走 D1），其余交给静态资源。
 * 另外用一个路由把 R2 里的上传图片以 /assets/uploads/* 暴露出来，
 * 这样前端拿到的 url 与本地 server.mjs 完全一致。
 */
import { handleApi } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    // ---- API ----
    if (p === '/api' || p.startsWith('/api/')) {
      return handleApi(request, env);
    }

    // ---- 上传的图片：从 R2 读取 ----
    if (p.startsWith('/assets/uploads/')) {
      if (!env.UPLOADS) {
        return new Response('未绑定 R2 存储桶', { status: 404 });
      }
      const key = p.replace(/^\/assets\//, '');   // uploads/xxx.png
      const obj = await env.UPLOADS.get(key);
      if (!obj) return new Response('图片不存在', { status: 404 });
      const headers = new Headers();
      if (obj.httpMetadata?.contentType) headers.set('content-type', obj.httpMetadata.contentType);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('etag', obj.httpEtag);
      return new Response(obj.body, { headers });
    }

    // ---- 静态资源 ----
    // 前端是 hash 路由（#/...），路径部分只有真实文件；
    // 非文件的请求统一回 index.html，避免刷新 404。
    if (!/\.[a-z0-9]+$/i.test(p)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
