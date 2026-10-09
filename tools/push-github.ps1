# 发布到 GitHub —— 一条命令搞定，Token 不落盘、不回显、不进日志
#
# 为什么要这个脚本：
#   1) git 执行凭据助手时一律经过 MinGit 的 usr/bin/sh.exe，而 sh 在当前沙箱里
#      启动就失败（couldn't create signal pipe, Win32 error 5）→ credential-manager 用不了。
#      改用 GIT_ASKPASS：git 直接执行它，不经过 shell。
#   2) 本机 schannel 走不通（SEC_E_NO_CREDENTIALS）→ 必须用 openssl 后端。
#   3) 本机要通过代理才能连外网 → 代理必须在任何联网操作**之前**设好。
#      （上一版把代理读取放在远端检查之后，导致检查失败直接抛错、根本没走到输入 Token 那一步。）
#
# 用法（Windows PowerShell 5.1 即可）：
#   powershell -ExecutionPolicy Bypass -File tools\push-github.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Git      = Join-Path $RepoRoot '.tools\MinGit\cmd\git.exe'
$AskPass  = Join-Path $RepoRoot 'tools\askpass.mjs'
$Remote   = 'https://github.com/xiz711/xizzz.git'
$Branch   = 'main'
$User     = 'xiz711'

Write-Host ""
Write-Host "[1/6] 定位便携版 git 与 node" -ForegroundColor Cyan
if (-not (Test-Path $Git))     { throw "找不到便携版 git：$Git（先跑 node tools\install-git.mjs .tools\MinGit）" }
if (-not (Test-Path $AskPass)) { throw "找不到 askpass 宿主：$AskPass" }

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
    $fallback = 'C:\Users\liangxi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path $fallback) { $Node = $fallback }
}
if (-not $Node -or -not (Test-Path $Node)) { throw "找不到 node.exe（askpass 需要它）" }
Write-Host "  git : $Git"
Write-Host "  node: $Node"

# ---- 代理：必须在任何联网操作之前设好 ----
Write-Host ""
Write-Host "[2/6] 配置代理" -ForegroundColor Cyan
$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
if ($reg -and $reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
    $p = $reg.ProxyServer
    if ($p -notmatch '^https?://') { $p = "http://$p" }
    $env:HTTP_PROXY = $p
    $env:HTTPS_PROXY = $p
    Write-Host "  使用系统代理: $p"
} else {
    Write-Host "  系统未启用代理，直连"
}

# credential.helper= 置空：所有助手都要过 sh，在这台机器上必然失败
$GitArgs = @('-c', 'http.sslBackend=openssl', '-c', 'credential.helper=')

Write-Host ""
Write-Host "[3/6] 检查远端（只读，不改动任何东西）" -ForegroundColor Cyan
$heads = & $Git @GitArgs ls-remote --heads $Remote 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ($heads | Out-String) -ForegroundColor Red
    throw "连不上远端。请确认代理可用"
}
if ($heads) {
    Write-Host "  远端已有分支：" -ForegroundColor Yellow
    $heads | ForEach-Object { Write-Host "    $_" }
    Write-Host "  → 将做普通推送，不覆盖、不删除、不使用 force" -ForegroundColor Yellow
} else {
    Write-Host "  远端为空仓库 —— 首次推送，不会覆盖任何东西" -ForegroundColor Green
}

Write-Host ""
Write-Host "[4/6] 输入 Token" -ForegroundColor Cyan
Write-Host "  提示出现后粘贴你的 GitHub PAT，回车。输入内容不会显示。" -ForegroundColor Gray
$secure = Read-Host -AsSecureString "  GitHub PAT"
$plain  = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $plain) { throw "没有输入 Token，已中止" }
$env:GIT_PASSWORD = $plain
$env:GIT_USERNAME = $User
Write-Host "  已读取：长度 $($plain.Length) 个字符（内容不回显）" -ForegroundColor Green

# GIT_ASKPASS 需要可执行宿主：用 .cmd 把 node 包起来
$wrapper = Join-Path $env:TEMP 'form-atlas-askpass.cmd'
Set-Content -LiteralPath $wrapper -Encoding ASCII -Value "@echo off`r`n`"$Node`" `"$AskPass`" %*"
$env:GIT_ASKPASS = $wrapper
$env:GIT_TERMINAL_PROMPT = '0'   # 禁止 git 回退到终端交互（那会再触发 sh）

try {
    Write-Host ""
    Write-Host "[5/6] 配置 remote" -ForegroundColor Cyan
    $existing = & $Git @GitArgs remote
    if ($existing -contains 'origin') {
        & $Git @GitArgs remote set-url origin $Remote
        Write-Host "  已更新 origin"
    } else {
        & $Git @GitArgs remote add origin $Remote
        Write-Host "  已添加 origin"
    }
    Write-Host "  origin -> $Remote"

    Write-Host ""
    Write-Host "[6/6] 推送 $Branch（非强制）" -ForegroundColor Cyan
    & $Git @GitArgs push -u origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "推送失败（exit $LASTEXITCODE）" }

    Write-Host ""
    Write-Host "完成 ✓  https://github.com/xiz711/xizzz" -ForegroundColor Green
} finally {
    Remove-Item Env:GIT_PASSWORD, Env:GIT_USERNAME, Env:GIT_ASKPASS, Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $wrapper -Force -ErrorAction SilentlyContinue
    Write-Host "（内存中的 Token 已清除）" -ForegroundColor Gray
}
