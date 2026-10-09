# 发布到 GitHub —— 一条命令搞定，Token 不落盘、不回显、不进日志
#
# 为什么需要这个脚本：
#   这台机器上 `git credential-manager` 用不了 —— git 会用 MinGit 自带的
#   usr/bin/sh.exe 去执行凭据助手，而 sh 在沙箱里启动就失败：
#     sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
#   所以改用 GIT_ASKPASS：git 会**直接执行**它，不经过 shell。
#
# 用法：
#   pwsh -File tools\push-github.ps1
#   运行时会提示粘贴 Token（输入不回显）；用完就从内存里清掉。
#
# 安全保证：
#   * Token 只存在于本次进程的环境变量里，不写入任何文件
#   * 不打印 Token，也不写进 git 配置
#   * 只做普通 push，绝不 force

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Git      = Join-Path $RepoRoot '.tools\MinGit\cmd\git.exe'
$AskPass  = Join-Path $RepoRoot 'tools\askpass.mjs'
$Node     = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = 'C:\Users\liangxi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }

$Remote = 'https://github.com/xiz711/xizzz.git'
$Branch = 'main'
$User   = 'xiz711'

if (-not (Test-Path $Git))     { throw "找不到便携版 git：$Git" }
if (-not (Test-Path $AskPass)) { throw "找不到 askpass 宿主：$AskPass" }
if (-not (Test-Path $Node))    { throw "找不到 node：$Node" }

# 代理：从系统设置读，并规范成 git 认的格式（不能重复加 http://）
$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
    $p = $reg.ProxyServer
    if ($p -notmatch '^https?://') { $p = "http://$p" }
    $env:HTTP_PROXY = $p; $env:HTTPS_PROXY = $p
    Write-Host "代理: $p"
}

# 关闭一切 credential.helper：它们都要经过 sh，在这台机器上必然失败
$GitArgs = @('-c', 'http.sslBackend=openssl', '-c', 'credential.helper=')

Write-Host ""
Write-Host "=== 远端状态（只读） ===" -ForegroundColor Cyan
$heads = & $Git @GitArgs ls-remote --heads $Remote 2>$null
if ($LASTEXITCODE -ne 0) { throw "连不上远端，请检查网络/代理" }
if ($heads) {
    Write-Host "远端已有分支：" -ForegroundColor Yellow
    $heads | ForEach-Object { Write-Host "  $_" }
    Write-Host "将做普通推送，不覆盖、不删除、不 force。" -ForegroundColor Yellow
} else {
    Write-Host "远端为空仓库 —— 首次推送，不会覆盖任何东西。"
}

Write-Host ""
Write-Host "=== 读取 Token（粘贴时不显示，回车确认） ===" -ForegroundColor Cyan
$secure = Read-Host -AsSecureString "GitHub PAT"
$env:GIT_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password
$env:GIT_USERNAME = $User
if (-not $env:GIT_PASSWORD) { throw "没有输入 Token，已中止" }
Write-Host "已读取（长度 $($env:GIT_PASSWORD.Length)，内容不会显示）" -ForegroundColor Green

# askpass 包装：把 node 作为可执行宿主交给 git
$wrapper = Join-Path $env:TEMP 'form-atlas-askpass.cmd'
Set-Content -LiteralPath $wrapper -Encoding ASCII -Value "@echo off`r`n`"$Node`" `"$AskPass`" %*"
$env:GIT_ASKPASS = $wrapper

if (-not (& $Git @GitArgs remote)) {
    & $Git @GitArgs remote add origin $Remote
} else {
    & $Git @GitArgs remote set-url origin $Remote
}

Write-Host ""
Write-Host "=== 推送 $Branch ===" -ForegroundColor Cyan
try {
    & $Git @GitArgs push -u origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "推送失败（exit $LASTEXITCODE）" }
} finally {
    # 无论成败都清掉内存里的凭据
    Remove-Item Env:GIT_PASSWORD, Env:GIT_USERNAME -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $wrapper -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "完成 ✓  https://github.com/xiz711/xizzz" -ForegroundColor Green
