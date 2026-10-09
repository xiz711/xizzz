/**
 * 安装便携版 Git（MinGit）—— 不需要管理员权限，也不运行安装程序。
 *
 * 背景：这台机器上 git 未安装，winget 因为网络原因不可用（0x8A150029），
 * 当前账号也不是管理员，所以官网那种交互式安装包不合适。
 * MinGit 是 Git for Windows 官方发布的「最小化 + 免安装」版本，解压即用。
 *
 * 用法：
 *   node tools/install-git.mjs            # 默认装到 %LOCALAPPDATA%\MinGit
 *   node tools/install-git.mjs <目录>      # 换目录
 *
 * 装完把 <目录>\cmd 加进 PATH 即可（脚本会打印具体命令）。
 * 它只依赖 Node 自带的 fetch，走系统代理，因此在当前环境里可以正常下载。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const DEST = path.resolve(process.argv[2] || path.join(os.homedir(), 'AppData', 'Local', 'MinGit'));

const API = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
// 备用镜像：GitHub 直连不通时改走 npmmirror
const MIRROR_DIR = 'https://registry.npmmirror.com/-/binary/git-for-windows';

const log = (...a) => console.log(...a);

async function latestMinGit() {
  const res = await fetch(API, {
    headers: { 'user-agent': 'install-git', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`查询最新版本失败：HTTP ${res.status}`);
  const rel = await res.json();
  const asset = (rel.assets || []).find((a) => /^MinGit-[\d.]+-64-bit\.zip$/.test(a.name));
  if (!asset) throw new Error('这个 release 里没有 64 位 MinGit 包');
  return { tag: rel.tag_name, name: asset.name, url: asset.browser_download_url, size: asset.size };
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': 'install-git' }, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(dest, buf);
  return buf.length;
}

async function main() {
  log('目标目录:', DEST);

  // 已经装过就不重复下载
  const gitExe = path.join(DEST, 'cmd', 'git.exe');
  if (fs.existsSync(gitExe)) {
    log('已存在 git，跳过下载:', gitExe);
  } else {
    const info = await latestMinGit();
    log(`最新版本: ${info.tag} / ${info.name} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);

    const tmp = path.join(os.tmpdir(), info.name);
    log('下载中…');
    let got;
    try {
      got = await download(info.url, tmp);
    } catch (err) {
      log('GitHub 直连失败（' + err.message + '），改走 npmmirror 镜像…');
      const mir = `${MIRROR_DIR}/${info.tag}/${info.name}`;
      got = await download(mir, tmp);
    }
    log(`下载完成: ${(got / 1024 / 1024).toFixed(1)} MB`);

    // MinGit 是 zip：用 PowerShell 解压（不依赖任何第三方库）
    await fsp.mkdir(DEST, { recursive: true });
    log('解压中…');
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${tmp}' -DestinationPath '${DEST}' -Force`,
    ], { stdio: 'inherit' });
    await fsp.rm(tmp, { force: true });
  }

  if (!fs.existsSync(gitExe)) throw new Error('解压后没找到 cmd\\git.exe，安装可能不完整');

  // 自检
  const version = execFileSync(gitExe, ['--version'], { encoding: 'utf8' }).trim();
  log('\n✓ 安装完成');
  log('  ' + version);
  log('  可执行文件: ' + gitExe);

  const cmdDir = path.join(DEST, 'cmd');
  const current = process.env.PATH || '';
  const onPath = current.split(';').some((p) => p.replace(/[\\/]+$/, '').toLowerCase() === cmdDir.toLowerCase());
  log('\n把这个目录加进 PATH 才能直接用 `git`：');
  log(`  $env:PATH = "${cmdDir};" + $env:PATH          # 仅当前会话`);
  if (!onPath) {
    log('  永久生效（写入用户环境变量，不需要管理员）：');
    log(`  [Environment]::SetEnvironmentVariable('PATH', "${cmdDir};" + [Environment]::GetEnvironmentVariable('PATH','User'), 'User')`);
  } else {
    log('  （已经在 PATH 里了）');
  }
}

main().catch((err) => {
  console.error('\n安装失败：', err.message);
  process.exit(1);
});
