#Requires -Version 5.1
<#
.SYNOPSIS
    super-agent-router 安装脚本自测 —— 幂等安装判定（24 条断言）。

    机器标记：ASSERTION-COUNT: 24

.DESCRIPTION
    **仅 Windows**：依赖 powershell 命令与 PowerShell 5.1。非 Windows 上请跳过本套件。

    钉的是 **D-99**：install.ps1 的幂等判断原先**只比版本号** ⇒ 同一版本内改了代码再跑安装，
    它输出「已是最新 —— 不重装」且**一个字节都不写** ⇒「改代码 → 重装 → 重启」这条修复路径
    **静默无效**（输出还是成功口吻，不报错）。

    沙箱建在 %TEMP% 下，不在仓库里；$env:USERPROFILE 重定向到沙箱内的 fakehome
    ⇒ **真实安装目录与真实运行时台账全程不被触碰**。
    被测的 install.ps1 也是**副本**：本套件把 install.ps1 与 plugin/ 复制进沙箱里的「假仓库」再跑
    ⇒「源侧改内容」这件事发生在**副本**上，仓库里的文件一个字节都不动。

    覆盖：
      场景 I    同版本号 + 内容不同 ⇒ 会重装（D-99 的正面钉子）
      场景 II   同版本号 + 内容完全相同 ⇒ 仍报「已是最新 —— 不重装」且一个字节不写
      场景 III  -Force ⇒ 强制重装（哪怕内容完全相同）
      场景 IV   语义变异对照（可证伪）：把判定退化成版本号口径 ⇒ 场景 I 必红

    断言条数由头部「ASSERTION-COUNT: NN」声明，run-all.ps1 会把它与本套件**实际输出**的
    PASS+FAIL 条数逐一对账 —— 声明数对不上就红（防止注释里的条数与代码漂移）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-idempotency-test.ps1
    powershell -ExecutionPolicy Bypass -File .\run-all.ps1    # 跑全套
#>
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $here
$srcRoot = Join-Path $repo 'plugin'
$installPs1 = Join-Path $repo 'install.ps1'

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('sar-idem-' + $stamp)
$fakeHome = Join-Path $sandbox 'fakehome'
[System.IO.Directory]::CreateDirectory($fakeHome) | Out-Null
$psExe = (Get-Command powershell).Source

$script:failed = 0
$script:pass = 0
function Check([string]$name, [bool]$cond, [string]$detail) {
    if ($cond) { $script:pass = $script:pass + 1; Write-Host ('PASS  ' + $name) }
    else { $script:failed = $script:failed + 1; Write-Host ('FAIL  ' + $name + '   :: ' + $detail) }
}
function RunPs([string[]]$argList) {
    $out = & $psExe -NoProfile -ExecutionPolicy Bypass @argList 2>&1
    return @{ out = ($out | Out-String); code = $LASTEXITCODE }
}
function Read-TextUtf8([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function Write-TextUtf8Bom([string]$path, [string]$text) {
    # **带 BOM**：PS 5.1 读无 BOM 的 .ps1 会按 ANSI 码页解，中文全变乱码
    $enc = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($path, $text, $enc)
}
function Get-TreeHash([string]$dir) {
    # 整棵目录的「相对路径 + SHA256」串 —— 用来证明「一个字节都没删、没改」
    $sb = New-Object System.Text.StringBuilder
    if (-not (Test-Path -LiteralPath $dir)) { return '<不存在>' }
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | Sort-Object FullName)) {
        $null = $sb.Append($f.FullName.Substring($dir.Length))
        $null = $sb.Append('=')
        $null = $sb.Append((Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)
        $null = $sb.Append(';')
    }
    return $sb.ToString()
}
function New-FakeRepo([string]$dir) {
    # 把 install.ps1 与 plugin/ 复制进沙箱里的「假仓库」
    # ⇒ 被测脚本的 $PSScriptRoot\plugin = 假仓库里的 plugin\，改它不动仓库
    [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    Copy-Item -LiteralPath $installPs1 -Destination (Join-Path $dir 'install.ps1') -Force
    Copy-Item -LiteralPath $srcRoot -Destination (Join-Path $dir 'plugin') -Recurse -Force
    return (Join-Path $dir 'install.ps1')
}
function Get-BackupCount([string]$targetRoot) {
    $b = Join-Path $targetRoot '.backup'
    if (-not (Test-Path -LiteralPath $b)) { return 0 }
    return @(Get-ChildItem -LiteralPath $b -Directory -Force -ErrorAction SilentlyContinue).Count
}
function Get-ManifestVersion([string]$pluginDir) {
    $p = Join-Path (Join-Path $pluginDir '.minimax-plugin') 'plugin.json'
    if (-not (Test-Path -LiteralPath $p)) { return '' }
    return [string]((Read-TextUtf8 $p | ConvertFrom-Json).version)
}

$markerName = 'D99-MARKER.txt'
$markerText = 'd99-same-version-different-content'

Write-Host ('[平台] Windows only（依赖 powershell + PS 5.1）')
Write-Host ('[沙箱] ' + $sandbox)
Write-Host ('[源码] ' + $srcRoot)

$env:USERPROFILE = $fakeHome

# ── 场景 I：同版本号 + 内容不同 ⇒ 会重装 ──────────────────────────────
Write-Host ''
Write-Host '--- 场景 I：同版本号 + 内容不同 ⇒ 会重装（D-99 的正面钉子）---'
$repoA = Join-Path $sandbox 'repoA'
$scriptA = New-FakeRepo $repoA
$targetA = Join-Path $sandbox 'targetA'
$destA = Join-Path $targetA 'super-agent-router'

$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptA,'-Target',$targetA)
Check 'I1 首次安装退出码 0' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'I2 夹具就绪：首次安装后目标里**没有**标记文件（标记是第二次才加的）' (-not (Test-Path -LiteralPath (Join-Path $destA $markerName))) '标记文件提前出现了'

# 源侧改内容：**版本号一个字都不动**，只加一个文件（= 用户在同一版本内修了缺陷）
Write-TextUtf8Bom (Join-Path $repoA ('plugin\' + $markerName)) $markerText
$verSrcA = Get-ManifestVersion (Join-Path $repoA 'plugin')
$verDstA = Get-ManifestVersion $destA
Check 'I3 夹具就绪：源侧改了内容但**版本号没变**（源=目标=同一版本号）' ($verSrcA -ne '' -and $verSrcA -eq $verDstA) ('src=' + $verSrcA + ' dst=' + $verDstA)

$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptA,'-Target',$targetA)
Check 'I4 第二次安装退出码 0' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'I5 第二次安装**没有**说「已是最新 —— 不重装」（D-99 的正面钉子）' (-not $r.out.Contains('已是最新 —— 不重装')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'I6 第二次安装的输出说明了「同版本但内容不同」' ($r.out.Contains('同版本但内容不同')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
$markerInstalled = (Test-Path -LiteralPath (Join-Path $destA $markerName))
Check 'I7 第二次安装把新内容装上去了（标记文件出现在目标里）' $markerInstalled '标记文件没被装上'
Check 'I8 旧版被整份备份了（.backup 下有备份目录）' ((Get-BackupCount $targetA) -ge 1) '没有备份目录'
Check 'I9 重装后目标与源的标记文件内容逐字一致' ($markerInstalled -and ((Read-TextUtf8 (Join-Path $destA $markerName)) -eq $markerText)) '内容不一致'

# ── 场景 II：同版本号 + 内容完全相同 ⇒ 仍报「已是最新 —— 不重装」且一个字节不写 ──
Write-Host ''
Write-Host '--- 场景 II：同版本号 + 内容完全相同 ⇒ 仍报「已是最新 —— 不重装」且一个字节不写---'
$beforeHashA = Get-TreeHash $destA
$backupCountA = Get-BackupCount $targetA
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptA,'-Target',$targetA)
Check 'II1 退出码 0' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'II2 输出含「已是最新 —— 不重装」' ($r.out.Contains('已是最新 —— 不重装')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'II3 输出含「没有备份、没有覆盖」' ($r.out.Contains('没有备份、没有覆盖')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'II4 目标整棵目录哈希前后相同（一个字节都没写）' ((Get-TreeHash $destA) -eq $beforeHashA) '内容变了'
Check 'II5 没有新建备份目录（备份目录数不变）' ((Get-BackupCount $targetA) -eq $backupCountA) '备份目录数变了'

# ── 场景 III：-Force ⇒ 强制重装（哪怕内容完全相同）────────────────────
Write-Host ''
Write-Host '--- 场景 III：-Force ⇒ 强制重装（哪怕内容完全相同）---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptA,'-Target',$targetA,'-Force')
Check 'III1 退出码 0' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'III2 输出**没有**「已是最新 —— 不重装」' (-not $r.out.Contains('已是最新 —— 不重装')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'III3 输出说明了「强制重装」' ($r.out.Contains('强制重装')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'III4 旧版被整份备份了（备份目录数 +1）' ((Get-BackupCount $targetA) -gt $backupCountA) '备份目录数没变'
Check 'III5 重装后目标内容仍与源逐字一致' ((Get-TreeHash $destA) -eq $beforeHashA) '重装后内容与源不一致'

# ── 场景 IV：语义变异对照（可证伪）────────────────────────────────────
Write-Host ''
Write-Host '--- 场景 IV：语义变异对照 —— 把判定退化成版本号口径，场景 I 必红---'
$repoB = Join-Path $sandbox 'repoB'
$scriptB = New-FakeRepo $repoB
$targetB = Join-Path $sandbox 'targetB'
$destB = Join-Path $targetB 'super-agent-router'

# 变异：把「内容比对」顶替成「版本号比对」= D-99 修复前的口径
$repoTextB = Read-TextUtf8 $scriptB
$mutantTextB = $repoTextB.Replace('$diffNow.Count -eq 0', '($installedVersion -eq $srcVersion)')
Write-TextUtf8Bom $scriptB $mutantTextB
Check 'IV1 变异副本的幂等判定已退化为版本号口径（含 $installedVersion -eq $srcVersion，且不含内容比对口径）' ($mutantTextB.Contains('$installedVersion -eq $srcVersion') -and -not $mutantTextB.Contains('$diffNow.Count -eq 0')) '变异没生效'
Check 'IV2 变异副本与仓库 install.ps1 字节不同（变异确实被应用）' ($mutantTextB -ne $repoTextB) '变异副本与仓库一字不差 —— 变异没落到文件上'

$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptB,'-Target',$targetB)
Write-TextUtf8Bom (Join-Path $repoB ('plugin\' + $markerName)) $markerText
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptB,'-Target',$targetB)
Check 'IV3 变异副本下：同版本 + 内容不同 ⇒ 判定为「已是最新 —— 不重装」' ($r.out.Contains('已是最新 —— 不重装')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
$mutantMarkerInstalled = (Test-Path -LiteralPath (Join-Path $destB $markerName))
Check 'IV4 变异副本下：标记文件**没有**被装上（内容不同也没重装）' (-not $mutantMarkerInstalled) '变异副本居然装上了'
Check 'IV5 变异副本与仓库 install.ps1 的行为**不同**（仓库重装了、变异体没重装）⇒ 场景 I 的断言可证伪' ($markerInstalled -and -not $mutantMarkerInstalled) ('repoInstalled=' + $markerInstalled + ' mutantInstalled=' + $mutantMarkerInstalled)

Write-Host ''
Write-Host ('==== 幂等安装判定：PASS ' + $script:pass + ' / FAIL ' + $script:failed + ' ====')
if ($script:failed -gt 0) {
    Write-Host ('沙箱保留在：' + $sandbox)
    exit 1
}
[System.IO.Directory]::Delete($sandbox, $true)
exit 0
