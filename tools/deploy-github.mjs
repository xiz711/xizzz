/**
 * 把 form-atlas 发布到 GitHub 仓库（不需要本机装 git）。
 *
 * 做法：走 GitHub 的 Git Data API，把每个文件打成 blob，一次性组成 tree，
 * 再创建一个 commit 并移动分支引用 —— 整个过程只有一次提交，不会产生中间状态。
 *
 * 用法（PowerShell）：
 *   $env:GITHUB_TOKEN = "github_pat_xxx"
 *   node tools/deploy-github.mjs
 *
 * 可选环境变量：
 *   REPO   默认 xiz711/xizzz
 *   BRANCH 默认仓库的默认分支（取不到就用 main）
 *   DRY    设为 1 时只列出将要上传的文件，不真的提交
 *
 * 关于令牌：需要 fine-grained PAT，权限给 Contents: Read and write 即可。
 * 绝不要把令牌写进任何文件或提交里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.REPO || 'xiz711/xizzz';
const TOKEN = process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';

/** 绝不入库：截图/无头 profile 里有 Edge 的凭据文件，仓库也要保持干净 */
const EXCLUDE_DIRS = new Set(['_shots', 'node_modules', '.git']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name));
    } else {
      if (EXCLUDE_FILES.has(e.name) || e.name.endsWith('.log') || e.name.endsWith('.tmp')) continue;
      out.push({ rel: base ? `${base}/${e.name}` : e.name, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'form-atlas-deploy',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && data.message ? data.message : String(text).slice(0, 300);
    throw new Error(`${method} ${url} -> HTTP ${res.status}: ${msg}`);
  }
  return data;
}

async function main() {
  if (!TOKEN) {
    console.error('缺少 GITHUB_TOKEN。请先设置：\n  $env:GITHUB_TOKEN = "github_pat_xxx"');
    process.exit(1);
  }

  const files = walk(ROOT);
  const total = files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
  console.log(`仓库: ${REPO}`);
  console.log(`文件: ${files.length} 个，合计 ${(total / 1024).toFixed(0)} KB`);
  if (process.env.DRY === '1') {
    files.forEach((f) => console.log('  ', f.rel));
    console.log('DRY=1，未提交。');
    return;
  }

  const repo = await api('GET', `/repos/${REPO}`);
  const branch = process.env.BRANCH || repo.default_branch || 'main';
  console.log(`分支: ${branch}`);

  // 1) 每个文件打成 blob
  const tree = [];
  for (const f of files) {
    const content = fs.readFileSync(f.abs).toString('base64');
    const blob = await api('POST', `/repos/${REPO}/git/blobs`, { content, encoding: 'base64' });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write(`\r  已上传 blob ${tree.length}/${files.length}`);
  }
  console.log('');

  // 2) 取当前分支顶点。
  //    空仓库时这一步会失败 —— GitHub 对空仓库的 ref 查询返回 404 或 409
  //    （409 "Git Repository is empty."），两种都当作「还没有提交」。
  let parentSha = null;
  let baseTree = null;
  try {
    const ref = await api('GET', `/repos/${REPO}/git/ref/heads/${branch}`);
    parentSha = ref.object.sha;
    const parent = await api('GET', `/repos/${REPO}/git/commits/${parentSha}`);
    baseTree = parent.tree.sha;
    console.log(`基于现有提交 ${parentSha.slice(0, 7)}（不会删除已有文件）`);
  } catch (err) {
    if (/HTTP (404|409)/.test(err.message)) {
      console.log('仓库还没有提交（空仓库）→ 将创建首个提交，不会覆盖任何东西');
    } else {
      throw err;
    }
  }

  // 3) 组 tree / 建 commit / 移动引用
  const newTree = await api('POST', `/repos/${REPO}/git/trees`, { tree, ...(baseTree ? { base_tree: baseTree } : {}) });
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: `发布 形式风格图谱（form-atlas）\n\n${files.length} 个文件，含 29 则风格条目与本地内置依赖。`,
    tree: newTree.sha,
    ...(parentSha ? { parents: [parentSha] } : {}),
  });

  if (parentSha) {
    await api('PATCH', `/repos/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  } else {
    await api('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  }

  console.log(`\n✓ 已发布`);
  console.log(`  提交: ${commit.sha}`);
  console.log(`  仓库: https://github.com/${REPO}`);
  console.log(`  分支: ${branch}`);
}

main().catch((err) => {
  console.error('\n发布失败：', err.message);
  process.exit(1);
});
