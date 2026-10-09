# 发布 form-atlas 到 GitHub —— 全程不会把 Token 写进任何文件或输出
#
# 前置（只需要做一次，Token 存在 Windows 凭据管理器里，不落盘到项目）：
#   $env:GH_TOKEN = "github_pat_xxx"          # 只为下面这一条命令存活
#   "protocol=https`nhost=github.com`nusername=xiz711`npassword=$env:GH_TOKEN" | .\.tools\MinGit\cmd\git.exe credential approve
#   Remove-Item Env:GH_TOKEN                  # 立刻清掉
#
# 然后运行本脚本：
#   pwsh -File tools\deploy-git.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Git      = Join-Path $RepoRoot '.tools\MinGit\cmd\git.exe'
$Remote   = 'https://github.com/xiz711/xizzz.git'
$Branch   = 'main'

# 便携版 git 的 HTTPS 必须走 openssl 后端：
# 这台机器上 schannel 会报 SEC_E_NO_CREDENTIALS（curl / PowerShell 也是同样的错），
# 而 git 自带的 openssl + 随包的 CA 可以正常握手。
$GitArgs = @('-c', 'http.sslBackend=openssl')

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & $Git @GitArgs @Args
    if ($LASTEXITCODE -ne 0) { throw "git $($Args -join ' ') 失败（exit $LASTEXITCODE）" }
}

if (-not (Test-Path $Git)) {
    throw "找不到便携版 git：$Git`n请先运行：node tools/install-git.mjs .tools\MinGit"
}

# --- 代理（从系统设置读，规范成 git 认的格式） ---
$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
    $p = $reg.ProxyServer
    if ($p -notmatch '^https?://') { $p = "http://$p" }
    $env:HTTP_PROXY = $p
    $env:HTTPS_PROXY = $p
    Write-Host "代理: $p"
}

Write-Host ""
Write-Host "=== 1/6 远端状态检查（不写入） ===" -ForegroundColor Cyan
Invoke-Git ls-remote --heads origin 2>$null
$remoteHeads = & $Git @GitArgs ls-remote --heads $Remote 2>$null
if ($LASTEXITCODE -eq 0 -and $remoteHeads) {
    Write-Host "远端已有分支：" -ForegroundColor Yellow
    $remoteHeads | ForEach-Object { Write-Host "  $_" }
    Write-Host "本脚本只做非强制的普通推送，不会覆盖或删除任何已存在的文件。" -ForegroundColor Yellow
} else {
    Write-Host "远端为空仓库 —— 这是首次推送，不会覆盖任何东西。"
}

Write-Host ""
Write-Host "=== 2/6 本地仓库 ===" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
    Invoke-Git init -b $Branch
    Write-Host "已初始化 .git（分支 $Branch）"
} else {
    Write-Host "已有 .git"
}
# 只写本地仓库配置，不影响全局
$authorName  = if ($env:GIT_AUTHOR_NAME)  { $env:GIT_AUTHOR_NAME }  else { 'xiz711' }
$authorEmail = if ($env:GIT_AUTHOR_EMAIL) { $env:GIT_AUTHOR_EMAIL } else { 'xiz711@users.noreply.github.com' }
Invoke-Git config user.name  $authorName
Invoke-Git config user.email $authorEmail
Invoke-Git config http.sslBackend openssl

Write-Host ""
Write-Host "=== 3/6 暂存文件（.gitignore 已排除 .tools/ 与 _shots/） ===" -ForegroundColor Cyan
Invoke-Git add -A
$staged = & $Git @GitArgs diff --cached --name-only
if (-not $staged) {
    Write-Host "没有需要提交的改动。"
} else {
    $staged | ForEach-Object { Write-Host "  $_" }
    Write-Host "共 $($staged.Count) 个文件" -ForegroundColor Green
}

# 二次保险：确认敏感目录没被暂存
$leak = & $Git @GitArgs diff --cached --name-only | Select-String -Pattern '^\.tools/|^_shots/|TOKEN|\.env'
if ($leak) {
    throw "检测到不应提交的路径，已中止：`n$leak"
}

Write-Host ""
Write-Host "=== 4/6 提交 ===" -ForegroundColor Cyan
& $Git @GitArgs diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "工作区干净，无需提交。"
} else {
    Invoke-Git commit -m "发布 形式风格图谱 form-atlas：28 则风格条目 + 零依赖本地站点"
    Write-Host "已提交" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 5/6 配置 remote ===" -ForegroundColor Cyan
$existing = & $Git @GitArgs remote
if ($existing -contains 'origin') {
    Invoke-Git remote set-url origin $Remote
} else {
    Invoke-Git remote add origin $Remote
}
Write-Host "origin -> $Remote"

Write-Host ""
Write-Host "=== 6/6 推送（非强制） ===" -ForegroundColor Cyan
Write-Host "若弹出凭据窗口或报认证失败，请先按脚本顶部注释把 Token 存进凭据管理器。" -ForegroundColor Yellow
Invoke-Git push -u origin $Branch

Write-Host ""
Write-Host "完成 ✓" -ForegroundColor Green
Write-Host "仓库：https://github.com/xiz711/xizzz"
