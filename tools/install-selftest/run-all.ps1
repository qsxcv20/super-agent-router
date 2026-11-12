#Requires -Version 5.1
<#
.SYNOPSIS
    super-agent-router 安装 / 卸载脚本自测 —— 一条命令复跑全部套件（9 条断言）。

    机器标记：ASSERTION-COUNT: 9

.DESCRIPTION
    **仅 Windows**：依赖 powershell 命令与 PowerShell 5.1。
    非 Windows 上请跳过本套件（check-readme-consistency.mjs 是纯读，跨平台可跑）。

    沙箱全部建在 %TEMP% 下，不在仓库里；运行时把 $env:USERPROFILE 重定向到沙箱内的 fakehome
    ⇒ **真实安装目录与真实运行时台账全程不被触碰**。

    覆盖（各套件的条数由**它自己头部**的「ASSERTION-COUNT」声明，本脚本不再另抄一份）：
      sandbox-test.ps1              安装 / 卸载的沙箱实跑
      sandbox-test2.ps1             跨插件保护、不误伤与路径形态
      install-idempotency-test.ps1  幂等安装判定 —— D-99 的钉子（同版本内容不同 ⇒ 会重装）
      trailing-space-test.mjs       尾随空格路径身份 —— F1 的钉子
      verify-seed.mjs               播种与安装副本的 node 侧校验
      check-readme-consistency.mjs  文档与实现逐字对账（含 F2 / F3 / F6 / V3 / V4 / X1 的钉子）
      run-all-exit-code-test.mjs    自检红 ⇒ 退出码与横幅不许说谎（X1 的钉子）

    **条数防漂（V4）**：跑完逐个核对「该套件头部声明的条数 == 它实际输出的 PASS+FAIL 条数」，
    对不上就红 —— 注释里的条数不再靠人记。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\run-all.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    Write-Host '[跳过] 本套件仅适用于 Windows（依赖 powershell + PS 5.1）' -ForegroundColor Yellow
    exit 0
}

$here = $PSScriptRoot
$psExe = (Get-Command powershell -ErrorAction SilentlyContinue)
if ($null -eq $psExe) {
    Write-Host '[失败] 找不到 powershell 命令' -ForegroundColor Red
    exit 1
}

Write-Host ('[平台] Windows + PowerShell ' + $PSVersionTable.PSVersion + '（本套件仅 Windows）')
Write-Host ('[目录] ' + $here)
Write-Host ''

$suites = @(
    @{ name = 'sandbox-test.ps1'; kind = 'ps'; desc = '安装/卸载 沙箱实跑' },
    @{ name = 'sandbox-test2.ps1'; kind = 'ps'; desc = '跨插件保护与不误伤' },
    @{ name = 'install-idempotency-test.ps1'; kind = 'ps'; desc = '幂等安装判定（D-99 钉子）' },
    @{ name = 'trailing-space-test.mjs'; kind = 'node'; desc = '尾随空格路径身份（F1 钉子）' },
    @{ name = 'verify-seed.mjs'; kind = 'node'; desc = '播种与安装副本（node 侧）' },
    @{ name = 'check-readme-consistency.mjs'; kind = 'node'; desc = '文档与实现逐字对账' },
    @{ name = 'run-all-exit-code-test.mjs'; kind = 'node'; desc = '自检红 ⇒ 退出码与横幅不许说谎（X1）' }
)

# X1：这三个计数**各有一个名字**，谁也不许跟谁撞名 ——
#   修之前这里是 `$script:pass` / `$script:failed` / `$failed`，
#   而 `$failed` 与 `$script:failed` 在**脚本作用域是同一个变量**
#   ⇒ 后面 `$failed = 0` 那一行把自检自己的红计数清零了
#   ⇒ 断言打印 FAIL、退出码却是 0、横幅还说「全部通过」。
$script:assertPass = 0
$script:assertFail = 0
function Check([string]$name, [bool]$cond, [string]$detail) {
    if ($cond) { $script:assertPass = $script:assertPass + 1; Write-Host ('PASS  ' + $name) }
    else { $script:assertFail = $script:assertFail + 1; Write-Host ('FAIL  ' + $name + '   :: ' + $detail) }
}

$results = @()
$totalDeclared = 0
$totalActual = 0
foreach ($s in $suites) {
    $file = Join-Path $here $s.name
    Write-Host ('==== ' + $s.name + '  (' + $s.desc + ') ====')
    if (-not (Test-Path -LiteralPath $file)) {
        Write-Host ('  [缺失] ' + $s.name) -ForegroundColor Red
        $results += @{ name = $s.name; code = 99 }
        continue
    }
    if ($s.kind -eq 'ps') {
        $out = & $psExe.Source -NoProfile -ExecutionPolicy Bypass -File $file 2>&1
        $code = $LASTEXITCODE
    } else {
        $out = & node $file 2>&1
        $code = $LASTEXITCODE
    }
    $out | ForEach-Object { Write-Host $_ }
    $results += @{ name = $s.name; code = $code }

    # ── 条数防漂（V4）：该套件头部声明的条数，必须等于它实际输出的 PASS+FAIL 条数 ──
    $actual = 0
    foreach ($line in $out) {
        if (([string]$line) -match '^(PASS|FAIL)  ') { $actual = $actual + 1 }
    }
    $srcText = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
    $m = [regex]::Match($srcText, 'ASSERTION-COUNT:\s*(\d+)')
    $declared = -1
    if ($m.Success) { $declared = [int]$m.Groups[1].Value }
    Check ('套件 ' + $s.name + ' 实际断言条数 == 头部声明（声明 ' + $declared + ' / 实际 ' + $actual + '）') ($declared -gt 0 -and $declared -eq $actual) ('declared=' + $declared + ' actual=' + $actual)
    $totalDeclared = $totalDeclared + $declared
    $totalActual = $totalActual + $actual
    Write-Host ''
}

# 全部套件的条数总数也要对得上
Check ('全部套件断言总数：声明 ' + $totalDeclared + ' == 实际 ' + $totalActual) ($totalDeclared -eq $totalActual) ('declared=' + $totalDeclared + ' actual=' + $totalActual)
# 最后一条：run-all 自身实际跑了多少条断言，必须等于它头部声明的条数（漏跑 / 被跳过的分支会被这条抓住）
#
# W3：声明值**从自己的头部读**，不再写死常量 ——
#   · 只改头部（人和机器标记一起改）而不加断言 ⇒ 声明值 != 实际值 ⇒ 这条会红；
#   · 再与**结构性期望**（子套件数 + 2）交叉核对 ⇒ 连「头部和机器标记一起改」也躲不掉。
$selfSrc = [System.IO.File]::ReadAllText((Join-Path $here 'run-all.ps1'), [System.Text.Encoding]::UTF8)
$selfM = [regex]::Match($selfSrc, 'ASSERTION-COUNT:\s*(\d+)')
$selfDeclared = -1
if ($selfM.Success) { $selfDeclared = [int]$selfM.Groups[1].Value }
$selfStructural = $suites.Count + 2
Check ('run-all.ps1 自身实际断言条数 == 头部声明（' + $selfDeclared + '）且 == 结构性期望（子套件 ' + $suites.Count + ' + 2 = ' + $selfStructural + '）') ((($script:assertPass + $script:assertFail + 1) -eq $selfDeclared) -and (($script:assertPass + $script:assertFail + 1) -eq $selfStructural)) ('实际=' + ($script:assertPass + $script:assertFail + 1) + ' declared=' + $selfDeclared + ' structural=' + $selfStructural)

Write-Host '==== 汇总 ===='
# 套件**退出码**非 0 的个数（与上面的断言红计数是两个不同的变量）
$suiteFailed = 0
foreach ($r in $results) {
    $mark = 'PASS'
    if ($r.code -ne 0) { $mark = 'FAIL'; $suiteFailed = $suiteFailed + 1 }
    Write-Host ('  ' + $mark + '  ' + $r.name + '  exit=' + $r.code)
}
Write-Host ''
# 退出判定：套件退出码**与**断言红计数都要看 ——
#   两个计数各用各的名字（$suiteFailed / $script:assertFail），谁也碰不到谁。
#   横幅同理：红的时候**不许**出现「全部通过」字样（X1）。
if ($suiteFailed -gt 0 -or $script:assertFail -gt 0) {
    Write-Host ('==== 自测：未通过 —— 套件未通过 ' + $suiteFailed + ' / ' + $results.Count + '；断言红 ' + $script:assertFail + ' 条 ====') -ForegroundColor Red
    exit 1
}
Write-Host ('==== 自测：' + $results.Count + ' / ' + $results.Count + ' 个套件全部通过；条数对账 ' + $script:assertPass + ' 条绿 ====') -ForegroundColor Green
exit 0
