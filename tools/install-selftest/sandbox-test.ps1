#Requires -Version 5.1
<#
.SYNOPSIS
    super-agent-router 安装 / 卸载脚本自测 —— 沙箱实跑（41 条断言）。

    机器标记：ASSERTION-COUNT: 41

.DESCRIPTION
    **仅 Windows**：依赖 powershell 命令与 PowerShell 5.1。
    在非 Windows 上请跳过本套件。

    沙箱建在 %TEMP% 下，**不在仓库里**（所以不需要 .gitignore 规则）。
    运行时把 $env:USERPROFILE 重定向到沙箱里的 fakehome ⇒ 真实安装目录与真实运行时台账全程不被触碰。

    版本号**从 plugin/.minimax-plugin/plugin.json 读**，不写死 —— 下一版发版不必改本脚本。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\sandbox-test.ps1
    powershell -ExecutionPolicy Bypass -File .\run-all.ps1    # 跑全套
#>
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $here
$srcRoot = Join-Path $repo 'plugin'
$installPs1 = Join-Path $repo 'install.ps1'
$uninstallPs1 = Join-Path $repo 'uninstall.ps1'

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('sar-selftest-' + $stamp)
$fakeHome = Join-Path $sandbox 'fakehome'
$target = Join-Path $sandbox 'plugins'
$proj = Join-Path $sandbox 'proj'
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
function Read-JsonUtf8([string]$path) {
    # PS 5.1 的 Get-Content 默认按 ANSI 读无 BOM 的 UTF-8 -> 中文乱码 -> JSON 解析失败
    return ([System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
}
function Get-PreviousVersion([string]$v) {
    # 从当前版本派生一个「上一个版本」，不写死版本字面量
    $parts = $v.Split('.')
    if ($parts.Count -ge 3) {
        $last = 0
        if ([int]::TryParse($parts[$parts.Count - 1], [ref]$last) -and $last -gt 0) {
            $parts[$parts.Count - 1] = [string]($last - 1)
            return ($parts -join '.')
        }
    }
    return '0.0.0'
}

Write-Host ('[平台] Windows only（依赖 powershell + PS 5.1）')
Write-Host ('[沙箱] ' + $sandbox)
Write-Host ('[源码] ' + $srcRoot)

# 版本从 manifest 读
$srcManifest = Read-JsonUtf8 (Join-Path $srcRoot '.minimax-plugin\plugin.json')
$srcVersion = [string]$srcManifest.version
$oldVersion = Get-PreviousVersion $srcVersion
Write-Host ('[版本] 源=' + $srcVersion + '  模拟旧版=' + $oldVersion)

$env:USERPROFILE = $fakeHome
$dest = Join-Path $target 'super-agent-router'
$srcFiles = @(Get-ChildItem -LiteralPath $srcRoot -Recurse -File -Force)
$srcCount = $srcFiles.Count

Write-Host ''
Write-Host '--- 场景 1：VerifyOnly 不写任何文件 ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target,'-VerifyOnly')
Check 'S1 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S1 未创建 target 目录' (-not (Test-Path -LiteralPath $target)) 'target 目录被创建了'

Write-Host ''
Write-Host '--- 场景 2：首次安装 ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target)
Check 'S2 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S2 插件目录已建' (Test-Path -LiteralPath $dest) 'dest 不存在'
$dstFiles = @(Get-ChildItem -LiteralPath $dest -Recurse -File -Force -ErrorAction SilentlyContinue)
Check ('S2 文件数与源一致 (src=' + $srcCount + ')') ($dstFiles.Count -eq $srcCount) ('src=' + $srcCount + ' dst=' + $dstFiles.Count)

$hashOk = $true
$hashBad = ''
foreach ($f in $srcFiles) {
    $rel = $f.FullName.Substring($srcRoot.Length) -replace '^[\\/]+',''
    $d = Join-Path $dest $rel
    if (-not (Test-Path -LiteralPath $d)) { $hashOk = $false; $hashBad = 'missing ' + $rel; break }
    $h1 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $h2 = (Get-FileHash -LiteralPath $d -Algorithm SHA256).Hash
    if ($h1 -ne $h2) { $hashOk = $false; $hashBad = 'hash mismatch ' + $rel; break }
}
Check 'S2 全部文件 SHA256 一致' $hashOk $hashBad
Check 'S2 .minimax-plugin/plugin.json 存在' (Test-Path -LiteralPath (Join-Path $dest '.minimax-plugin\plugin.json')) 'missing'
$ver = (Read-JsonUtf8 (Join-Path $dest '.minimax-plugin\plugin.json')).version
Check ('S2 安装后版本 ' + $srcVersion) ($ver -eq $srcVersion) ('ver=' + $ver)

Write-Host ''
Write-Host '--- 场景 3：幂等（同版本不重装） ---'
$before = (Get-Item -LiteralPath (Join-Path $dest '.minimax-plugin\plugin.json')).LastWriteTimeUtc
Start-Sleep -Milliseconds 1100
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target)
$after = (Get-Item -LiteralPath (Join-Path $dest '.minimax-plugin\plugin.json')).LastWriteTimeUtc
Check 'S3 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S3 未产生 .backup 目录' (-not (Test-Path -LiteralPath (Join-Path $target '.backup'))) '.backup 存在'
Check 'S3 未产生 .staging 残留' (@(Get-ChildItem -LiteralPath (Join-Path $target '.staging') -ErrorAction SilentlyContinue).Count -eq 0) 'staging 有残留'
Check 'S3 目标文件未被重写 (mtime 不变)' ($before -eq $after) ('before=' + $before + ' after=' + $after)

Write-Host ''
Write-Host '--- 场景 4：版本不同 -> 先备份再装 ---'
$manPath = Join-Path $dest '.minimax-plugin\plugin.json'
$man = [System.IO.File]::ReadAllText($manPath, [System.Text.Encoding]::UTF8)
$man2 = $man.Replace('"version": "' + $srcVersion + '"', '"version": "' + $oldVersion + '"')
[System.IO.File]::WriteAllText($manPath, $man2, (New-Object System.Text.UTF8Encoding($false)))
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target)
Check 'S4 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
$backupRoot = Join-Path $target '.backup'
$backups = @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue)
Check 'S4 生成了 1 份备份' ($backups.Count -eq 1) ('count=' + $backups.Count)
if ($backups.Count -eq 1) {
    $bver = (Read-JsonUtf8 (Join-Path $backups[0].FullName '.minimax-plugin\plugin.json')).version
    Check ('S4 备份里是旧版本 ' + $oldVersion) ($bver -eq $oldVersion) ('bver=' + $bver)
}
$ver2 = (Read-JsonUtf8 (Join-Path $dest '.minimax-plugin\plugin.json')).version
Check ('S4 目标已升级回 ' + $srcVersion) ($ver2 -eq $srcVersion) ('ver=' + $ver2)

Write-Host ''
Write-Host '--- 场景 5：源包校验失败 -> 非零退出、不装一半 ---'
$badRoot = Join-Path $sandbox 'badpkg'
[System.IO.Directory]::CreateDirectory($badRoot) | Out-Null
Copy-Item -LiteralPath $installPs1 -Destination (Join-Path $badRoot 'install.ps1') -Force
Copy-Item -LiteralPath $srcRoot -Destination (Join-Path $badRoot 'plugin') -Recurse -Force
[System.IO.File]::Delete((Join-Path $badRoot 'plugin\scripts\gate.mjs'))
$target2 = Join-Path $sandbox 'plugins2'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $badRoot 'install.ps1'),'-Target',$target2)
Check 'S5 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S5 未创建目标插件目录' (-not (Test-Path -LiteralPath (Join-Path $target2 'super-agent-router'))) '目标目录被创建了'
Check 'S5 未产生 .staging' (-not (Test-Path -LiteralPath (Join-Path $target2 '.staging'))) 'staging 存在'

Write-Host ''
Write-Host '--- 场景 6：-Project 播种 ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target,'-Project',$proj)
Check 'S6 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
$sa = Join-Path $proj '.superagent'
Check 'S6 .superagent 已建' (Test-Path -LiteralPath $sa) 'missing'
$rosterPath = Join-Path $sa 'roster.json'
Check 'S6 roster.json 存在' (Test-Path -LiteralPath $rosterPath) 'missing'
if (Test-Path -LiteralPath $rosterPath) {
    $rs = Read-JsonUtf8 $rosterPath
    Check 'S6 members 为空数组' (@($rs.members).Count -eq 0) ('members=' + @($rs.members).Count)
    $rsBytes = [System.IO.File]::ReadAllBytes($rosterPath)
    $hasBom = ($rsBytes.Length -ge 3 -and $rsBytes[0] -eq 0xEF -and $rsBytes[1] -eq 0xBB -and $rsBytes[2] -eq 0xBF)
    Check 'S6 roster.json 无 BOM' (-not $hasBom) '有 BOM'
}
$templateList = @('methods\_TEMPLATE.md','lessons\_TEMPLATE.md','incidents\_TEMPLATE.md','agent-snapshots\_README.md')
$allTemplates = $true
foreach ($tpl in $templateList) {
    if (-not (Test-Path -LiteralPath (Join-Path $sa $tpl))) { $allTemplates = $false }
}
Check ('S6 四个模板都播种了（' + $templateList.Count + ' 个）') $allTemplates '缺模板'
Check 'S6 STATUS.md 已播种' (Test-Path -LiteralPath (Join-Path $sa 'STATUS.md')) 'missing'
$mFiles = @(Get-ChildItem -LiteralPath (Join-Path $sa 'methods') -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '_TEMPLATE.md' })
Check 'S6 methods 下没有成员方法论' ($mFiles.Count -eq 0) ('files=' + ($mFiles.Name -join ','))
$lFiles = @(Get-ChildItem -LiteralPath (Join-Path $sa 'lessons') -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '_TEMPLATE.md' })
Check 'S6 lessons 下没有成员错题本' ($lFiles.Count -eq 0) ('files=' + ($lFiles.Name -join ','))

Write-Host ''
Write-Host '--- 场景 7：重复播种不覆盖已有数据 ---'
[System.IO.File]::WriteAllText($rosterPath, '{"version":1,"members":[{"name":"my-own"}]}', (New-Object System.Text.UTF8Encoding($false)))
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target,'-Project',$proj)
$rs2 = [System.IO.File]::ReadAllText($rosterPath, [System.Text.Encoding]::UTF8)
Check 'S7 已有 roster.json 未被覆盖' ($rs2.Contains('my-own')) 'roster 被覆盖了'

Write-Host ''
Write-Host '--- 场景 8：uninstall 默认移到 .trash ---'
$dataDir = Join-Path $fakeHome '.minimax\v2\plugin-data\hooks\super-agent-router'
[System.IO.Directory]::CreateDirectory($dataDir) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $dataDir 'ledger.jsonl'), '{}', (New-Object System.Text.UTF8Encoding($false)))
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',$target)
Check 'S8 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S8 插件目录已移走' (-not (Test-Path -LiteralPath $dest)) 'dest 仍在'
$trash = @(Get-ChildItem -LiteralPath (Join-Path $target '.trash') -Directory -ErrorAction SilentlyContinue)
Check 'S8 .trash 下有回收目录' ($trash.Count -ge 1) ('count=' + $trash.Count)
Check 'S8 回收目录里插件完整' (Test-Path -LiteralPath (Join-Path $trash[0].FullName '.minimax-plugin\plugin.json')) 'missing'
Check 'S8 运行时台账默认未动' (Test-Path -LiteralPath $dataDir) '台账被删了'

Write-Host ''
Write-Host '--- 场景 9：uninstall -Purge 真删 ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target)
Check 'S9 重装退出码 0' ($r.code -eq 0) ('code=' + $r.code)
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',$target,'-Purge')
Check 'S9 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S9 插件目录已真删' (-not (Test-Path -LiteralPath $dest)) 'dest 仍在'
Check 'S9 运行时台账仍未动' (Test-Path -LiteralPath $dataDir) '台账被删了'

Write-Host ''
Write-Host '--- 场景 10：uninstall -PurgeData 清台账 ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',$target,'-PurgeData')
Check 'S10 退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S10 运行时台账已清' (-not (Test-Path -LiteralPath $dataDir)) '台账仍在'

Write-Host ''
Write-Host '--- 场景 11：uninstall 幂等（未安装时） ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',(Join-Path $sandbox 'never-installed'))
Check 'S11 退出码 0' ($r.code -eq 0) ('code=' + $r.code)

Write-Host ''
Write-Host ('==== 沙箱实跑：PASS ' + $script:pass + ' / FAIL ' + $script:failed + ' ====')
if ($script:failed -gt 0) {
    Write-Host ('沙箱保留在：' + $sandbox)
    exit 1
}
[System.IO.Directory]::Delete($sandbox, $true)
exit 0
