/**
 * git 的 askpass 宿主 —— 让 git 能在没有 POSIX shell 的情况下拿到凭据。
 *
 * 背景：这台机器上 `git credential-manager` 用不了。git 会通过 MinGit 自带的
 * `usr/bin/sh.exe` 去执行凭据助手，而 sh 在当前沙箱里启动就失败：
 *   sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
 * 换任何 credential.helper 都一样，因为都要经过 sh。
 *
 * `GIT_ASKPASS` 不一样：git 直接执行这个程序（不经过 shell），所以这条路走得通。
 *
 * 用法（由 git 自动调用，不需要手动跑）：
 *   GIT_ASKPASS=<本文件> GIT_USERNAME=xiz711 GIT_PASSWORD=xxx
 *
 * 安全：凭据只从**环境变量**读，不落盘、不打印、不写日志。
 * 输出仅限 git 要求的那一项，且绝不回显密码内容。
 */
const prompt = String(process.argv[2] || '');

if (/username|user\b|login/i.test(prompt)) {
  process.stdout.write(process.env.GIT_USERNAME || 'xiz711');
} else if (/password|passwd|token/i.test(prompt)) {
  const pw = process.env.GIT_PASSWORD;
  if (!pw) {
    // 不给 git 回退到终端交互的机会：直接报错，避免它又去调 sh
    process.stderr.write('askpass: GIT_PASSWORD 未设置\n');
    process.exit(1);
  }
  process.stdout.write(pw);
} else {
  // 其它提示（例如 yes/no）：回一个空行，让 git 用默认值
  process.stdout.write('');
}

process.stdout.write('\n');
