#Requires -Version 5.1
<#
.SYNOPSIS
    super-agent-router 安装 / 卸载脚本自测 —— 跨插件保护、不误伤与路径形态（44 条断言）。

    机器标记：ASSERTION-COUNT: 44

.DESCRIPTION
    **仅 Windows**：依赖 powershell 命令与 PowerShell 5.1。非 Windows 上请跳过本套件。

    沙箱建在 %TEMP% 下，不在仓库里；自带独立沙箱，不依赖其它套件的残留状态。
    版本号从 plugin/.minimax-plugin/plugin.json 读，不写死。

    断言条数由头部「ASSERTION-COUNT: NN」声明，run-all.ps1 会把它与本套件**实际输出**的
    PASS+FAIL 条数逐一对账 —— 声明数对不上就红（防止注释里的条数与代码漂移）。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\sandbox-test2.ps1
#>
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $here
$installPs1 = Join-Path $repo 'install.ps1'
$uninstallPs1 = Join-Path $repo 'uninstall.ps1'

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('sar-selftest2-' + $stamp)
$target3 = Join-Path $sandbox 'plugins3'
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

Write-Host ('[平台] Windows only（依赖 powershell + PS 5.1）')
Write-Host ('[沙箱] ' + $sandbox)

Write-Host ''
Write-Host '--- 场景 12：目标目录是别的插件 -> 拒绝覆盖 ---'
$otherDir = Join-Path $target3 'super-agent-router'
[System.IO.Directory]::CreateDirectory((Join-Path $otherDir '.minimax-plugin')) | Out-Null
$otherMan = '{"schemaVersion":1,"name":"some-other-plugin","version":"9.9.9"}'
[System.IO.File]::WriteAllText((Join-Path $otherDir '.minimax-plugin\plugin.json'), $otherMan, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $otherDir 'MARKER.txt'), 'do-not-touch', (New-Object System.Text.UTF8Encoding($false)))
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target3)
Check 'S12 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S12 别人的插件目录原封不动' (Test-Path -LiteralPath (Join-Path $otherDir 'MARKER.txt')) 'marker 被删了'
$still = [System.IO.File]::ReadAllText((Join-Path $otherDir '.minimax-plugin\plugin.json'), [System.Text.Encoding]::UTF8)
Check 'S12 别人的 plugin.json 未被改写' ($still.Contains('some-other-plugin')) $still

Write-Host ''
Write-Host '--- 场景 13：-Purge 只删插件目录，同级其它目录保留 ---'
$sibling = Join-Path $target3 'another-plugin'
[System.IO.Directory]::CreateDirectory($sibling) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $sibling 'KEEP.txt'), 'keep-me', (New-Object System.Text.UTF8Encoding($false)))
[System.IO.Directory]::CreateDirectory($target3) | Out-Null
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',(Join-Path $sandbox 'plugins4'))
Check 'S13 正常安装退出码 0' ($r.code -eq 0) ('code=' + $r.code)
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',(Join-Path $sandbox 'plugins4'),'-Purge')
Check 'S13 卸载退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S13 插件目录已删' (-not (Test-Path -LiteralPath (Join-Path $sandbox 'plugins4\super-agent-router'))) '仍在'
Check 'S13 同级其它目录保留' (Test-Path -LiteralPath (Join-Path $sibling 'KEEP.txt')) '同级目录被误删'

Write-Host ''
Write-Host '--- 场景 14：安装副本的 Hook 脚本真能被 node 跑起来 ---'
# 自建安装副本（不依赖别的套件留下的状态）
$target5 = Join-Path $sandbox 'plugins5'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',$target5)
Check 'S14 安装副本就绪' ($r.code -eq 0) ('code=' + $r.code)
$inst = Join-Path $target5 'super-agent-router'
$sessionStart = Join-Path $inst 'scripts\session-start.mjs'
Check 'S14 session-start.mjs 存在' (Test-Path -LiteralPath $sessionStart) 'missing'
$env:MINIMAX_PROJECT_DIR = $repo
$nodeOut = & node $sessionStart 2>&1
$nodeCode = $LASTEXITCODE
$nodeOutText = ($nodeOut | Out-String)
Check 'S14 session-start.mjs 退出码 0' ($nodeCode -eq 0) ('code=' + $nodeCode + ' out=' + $nodeOutText.Substring(0, [Math]::Min(300, $nodeOutText.Length)))
Check 'S14 输出了 SessionStart 注入' ($nodeOutText.Contains('super-agent-router')) $nodeOutText.Substring(0, [Math]::Min(300, $nodeOutText.Length))

Write-Host ''
Write-Host '--- 场景 15：卸载后再重装（往返） ---'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$installPs1,'-Target',(Join-Path $sandbox 'plugins4'))
Check 'S15 重装退出码 0' ($r.code -eq 0) ('code=' + $r.code)
Check 'S15 重装后插件完整' (Test-Path -LiteralPath (Join-Path $sandbox 'plugins4\super-agent-router\.minimax-plugin\plugin.json')) 'missing'

Write-Host ''
Write-Host '--- 场景 16：uninstall -Purge 目标不是本插件目录（manifest name 不符）-> 拒绝删除 ---'
# 这条钉的是「内容级 manifest 核对」—— 路径级那两条是结构自检（同源恒等），挡不住这一类。
$wrongRoot = Join-Path $sandbox 'plugins6'
$wrongDir = Join-Path $wrongRoot 'super-agent-router'
[System.IO.Directory]::CreateDirectory((Join-Path $wrongDir '.minimax-plugin')) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $wrongDir '.minimax-plugin\plugin.json'),
    '{"schemaVersion":1,"name":"some-other-plugin","version":"9.9.9"}', (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $wrongDir 'MARKER.txt'), 'do-not-touch', (New-Object System.Text.UTF8Encoding($false)))
$wrongBefore = Get-TreeHash $wrongDir
# 夹具有效性：manifest 的 **内容** 里 name 必须是别的插件（树哈希串只有路径和哈希，不含内容）
$wrongManText = [System.IO.File]::ReadAllText((Join-Path $wrongDir '.minimax-plugin\plugin.json'), [System.Text.Encoding]::UTF8)
Check 'S16 夹具就绪：目标确实是「不是本插件目录」（manifest name 不符）' ($wrongBefore -ne '<不存在>' -and $wrongManText.Contains('some-other-plugin')) '夹具没造出来'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',$wrongRoot,'-Purge')
Check 'S16 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S16 报错命中内容级 manifest 核对' ($r.out.Contains('.minimax-plugin\plugin.json')) $r.out.Substring(0, [Math]::Min(300, $r.out.Length))
Check 'S16 目标目录仍在' (Test-Path -LiteralPath $wrongDir) '目录被删了'
Check 'S16 目标目录一个字节都没删（整棵目录哈希前后相同）' ((Get-TreeHash $wrongDir) -eq $wrongBefore) '内容变了'

Write-Host ''
Write-Host '--- 场景 17：uninstall -Purge 目标读不到 manifest -> 拒绝删除 ---'
$noManRoot = Join-Path $sandbox 'plugins7'
$noManDir = Join-Path $noManRoot 'super-agent-router'
[System.IO.Directory]::CreateDirectory($noManDir) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $noManDir 'MARKER.txt'), 'no-manifest-here', (New-Object System.Text.UTF8Encoding($false)))
$noManBefore = Get-TreeHash $noManDir
Check 'S17 夹具就绪：目标确实读不到 manifest' ($noManBefore -ne '<不存在>' -and -not (Test-Path -LiteralPath (Join-Path $noManDir '.minimax-plugin\plugin.json'))) '夹具没造出来'
$r = RunPs @('-NoProfile','-ExecutionPolicy','Bypass','-File',$uninstallPs1,'-Target',$noManRoot,'-Purge')
Check 'S17 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S17 报错命中内容级 manifest 核对' ($r.out.Contains('.minimax-plugin\plugin.json')) $r.out.Substring(0, [Math]::Min(300, $r.out.Length))
Check 'S17 目标目录仍在' (Test-Path -LiteralPath $noManDir) '目录被删了'
Check 'S17 目标目录一个字节都没删（整棵目录哈希前后相同）' ((Get-TreeHash $noManDir) -eq $noManBefore) '内容变了'

Write-Host ''
Write-Host '--- 场景 18：-Target 带尾随反斜杠 -> 装得上 ---'
# V2 的回归钉子：GetFullPath("D:\foo\") 保留尾随反斜杠、Split-Path -Parent 去掉它
#   => 修之前「装得上、卸不掉」。这里两侧都钉。
#
# W1：参数必须**原样到达**子进程。
#   -File + 原生命令行参数传递时，路径含空格 / 非 ASCII ⇒ Windows 的引号规则会吃掉末尾反斜杠
#   （还会在末尾多出一个 "）⇒ 那**不是产品坏了**，是测试壳的传参方式坏了。
#   改成 -Command 把「脚本 + 参数」整体留在子进程里、参数值用单引号包住 ⇒ 末尾反斜杠不被闭引号吃掉。
$slashRoot = Join-Path $sandbox 'plugins8'
[System.IO.Directory]::CreateDirectory($slashRoot) | Out-Null
$slashArg = $slashRoot + [System.IO.Path]::DirectorySeparatorChar
$probePs1 = @'
param([string]$Target = '')
$out = $env:SAR_ARG_ECHO_OUT
if ([string]::IsNullOrEmpty($out)) { exit 9 }
[System.IO.File]::WriteAllText($out, $Target, (New-Object System.Text.UTF8Encoding($false)))
exit 0
'@
[System.IO.File]::WriteAllText((Join-Path $sandbox 'arg-echo.ps1'), $probePs1, (New-Object System.Text.UTF8Encoding($false)))
$echoFile = Join-Path $sandbox 'arg-echo.txt'
$env:SAR_ARG_ECHO_OUT = $echoFile

function Quote-Single([string]$v) {
    # PowerShell 单引号串里要表示一个单引号，得写两个
    return $v.Replace("'", "''")
}
function RunPsQuotedArg([string]$scriptPath, [string]$targetValue, [switch]$Purge) {
    # W1 的修法：-Command 单引号内联。参数值整体留在子进程的命令行里，
    # 末尾反斜杠不会被闭引号吃掉（三种路径形态下均实测完好）。
    $cmd = "& '" + (Quote-Single $scriptPath) + "' -Target '" + (Quote-Single $targetValue) + "'"
    if ($Purge) { $cmd = $cmd + ' -Purge' }
    $out = & $psExe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1
    return @{ out = ($out | Out-String); code = $LASTEXITCODE }
}
function RunPsCmdLine([string]$cmdLine) {
    # 走**真实**的 cmd 命令行 —— Windows 的引号规则（末尾 \" 变成字面引号）只有这样才复现得出来
    $out = & cmd.exe /c $cmdLine 2>&1
    return @{ out = ($out | Out-String); code = $LASTEXITCODE }
}
function Get-EchoedArg([string]$argValue) {
    # 用与被测脚本**同一种**的传参方式（-Command 单引号内联）⇒ echo 与实际到达值同源
    if (Test-Path -LiteralPath $echoFile) { [System.IO.File]::Delete($echoFile) }
    $cmd = "& '" + (Quote-Single (Join-Path $sandbox 'arg-echo.ps1')) + "' -Target '" + (Quote-Single $argValue) + "'"
    $null = & $psExe -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1
    if (-not (Test-Path -LiteralPath $echoFile)) { return '<没写出来>' }
    return [System.IO.File]::ReadAllText($echoFile, [System.Text.Encoding]::UTF8)
}
$echoed = Get-EchoedArg $slashArg
Check 'S18 构造有效性：尾随反斜杠确实原样传到了脚本' ($echoed -ceq $slashArg) ('echo=[' + $echoed + '] arg=[' + $slashArg + ']')
$r = RunPsQuotedArg $installPs1 $slashArg
Check 'S18 安装退出码 0（-Target 带尾随反斜杠）' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'S18 插件目录已建' (Test-Path -LiteralPath (Join-Path $slashRoot 'super-agent-router')) 'dest 不存在'

Write-Host ''
Write-Host '--- 场景 19：-Target 带尾随反斜杠 -> 卸得掉 ---'
$echoed2 = Get-EchoedArg $slashArg
Check 'S19 构造有效性：尾随反斜杠确实原样传到了脚本' ($echoed2 -ceq $slashArg) ('echo=[' + $echoed2 + '] arg=[' + $slashArg + ']')
$r = RunPsQuotedArg $uninstallPs1 $slashArg -Purge
Check 'S19 卸载退出码 0（-Target 带尾随反斜杠）' ($r.code -eq 0) ('code=' + $r.code + ' out=' + $r.out.Substring(0, [Math]::Min(300, $r.out.Length)))
Check 'S19 插件目录已删' (-not (Test-Path -LiteralPath (Join-Path $slashRoot 'super-agent-router'))) '仍在'
Check 'S19 卸载走完了内容级 manifest 核对（输出命中「删前核对通过」）' ($r.out.Contains('manifest name=super-agent-router')) $r.out.Substring(0, [Math]::Min(300, $r.out.Length))

Write-Host ''
Write-Host '--- 场景 20：命令行畸形参数（路径含空格 + 末尾反斜杠 -> 末尾多出一个引号）-> 干净报错 + 零副作用 ---'
# W1-2 / W2：用户手工写 -Target "D:\My Plugins\" 时，Windows 的引号规则会把末尾的
#   \" 变成一个**字面引号** ⇒ 参数变成 D:\My Plugins"。
#   脚本必须给**干净可读**的错（点名原因 + 给正确写法），且**零副作用**（不建目录、不删东西）。
$malDir = Join-Path $sandbox 'mal dir'
[System.IO.Directory]::CreateDirectory($malDir) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $malDir 'KEEP.txt'), 'do-not-touch', (New-Object System.Text.UTF8Encoding($false)))
$malBefore = Get-TreeHash $malDir
# 夹具有效性：同一个**真实**命令行打给 arg-echo 探针，必须看到末尾那个多出来的引号
if (Test-Path -LiteralPath $echoFile) { [System.IO.File]::Delete($echoFile) }
$null = RunPsCmdLine ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $sandbox 'arg-echo.ps1') + '" -Target "' + $malDir + '\' + '"')
$malGot = '<没写出来>'
if (Test-Path -LiteralPath $echoFile) { $malGot = [System.IO.File]::ReadAllText($echoFile, [System.Text.Encoding]::UTF8) }
Check 'S20 夹具就绪：真实命令行确实把末尾反斜杠变成了一个引号' ($malGot.Length -eq ($malDir.Length + 1) -and $malGot.EndsWith('"')) ('echo=[' + $malGot + '] 期望=[' + $malDir + '"]')
$r = RunPsCmdLine ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + $installPs1 + '" -Target "' + $malDir + '\' + '"')
Check 'S20 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S20 报错点名了「含 Windows 路径非法字符」' ($r.out.Contains('含 Windows 路径非法字符')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S20 报错点名了最可能的原因（末尾反斜杠被闭引号吃掉）' ($r.out.Contains('末尾的反斜杠被闭引号吃掉')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S20 报错给出了正确写法（去掉末尾反斜杠 / 写成两个反斜杠）' ($r.out.Contains('去掉末尾的反斜杠') -and $r.out.Contains('两个反斜杠')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S20 没有把 .NET 异常堆栈甩给用户' (-not $r.out.Contains('Illegal characters in path')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S20 零副作用：用户想指的目录一个字节都没动' ((Get-TreeHash $malDir) -eq $malBefore) '内容变了'
Check 'S20 零副作用：没建出插件目录' (-not (Test-Path -LiteralPath (Join-Path $malDir 'super-agent-router'))) '建了'

Write-Host ''
Write-Host '--- 场景 21：命令行畸形参数 -> 卸载侧同样要干净报错 + 零删除 ---'
$malRoot = Join-Path $sandbox 'mal root'
$malPlugin = Join-Path $malRoot 'super-agent-router'
[System.IO.Directory]::CreateDirectory((Join-Path $malPlugin '.minimax-plugin')) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $malPlugin '.minimax-plugin\plugin.json'),
    '{"schemaVersion":1,"name":"super-agent-router","version":"0.0.0-selftest"}', (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $malPlugin 'KEEP.txt'), 'do-not-touch', (New-Object System.Text.UTF8Encoding($false)))
$malRootBefore = Get-TreeHash $malRoot
if (Test-Path -LiteralPath $echoFile) { [System.IO.File]::Delete($echoFile) }
$null = RunPsCmdLine ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $sandbox 'arg-echo.ps1') + '" -Target "' + $malRoot + '\' + '"')
$malGot2 = '<没写出来>'
if (Test-Path -LiteralPath $echoFile) { $malGot2 = [System.IO.File]::ReadAllText($echoFile, [System.Text.Encoding]::UTF8) }
Check 'S21 夹具就绪：真实命令行确实把末尾反斜杠变成了一个引号' ($malGot2.Length -eq ($malRoot.Length + 1) -and $malGot2.EndsWith('"')) ('echo=[' + $malGot2 + '] 期望=[' + $malRoot + '"]')
$r = RunPsCmdLine ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + $uninstallPs1 + '" -Purge -Target "' + $malRoot + '\' + '"')
Check 'S21 退出码非 0' ($r.code -ne 0) ('code=' + $r.code)
Check 'S21 报错点名了「含 Windows 路径非法字符」' ($r.out.Contains('含 Windows 路径非法字符')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S21 报错点名了最可能的原因（末尾反斜杠被闭引号吃掉）' ($r.out.Contains('末尾的反斜杠被闭引号吃掉')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S21 没有把 .NET 异常堆栈甩给用户' (-not $r.out.Contains('Illegal characters in path')) $r.out.Substring(0, [Math]::Min(400, $r.out.Length))
Check 'S21 零删除：目标目录一个字节都没删（整棵目录哈希前后相同）' ((Get-TreeHash $malRoot) -eq $malRootBefore) '内容变了'

Write-Host ''
Write-Host ('==== 跨插件保护与不误伤：PASS ' + $script:pass + ' / FAIL ' + $script:failed + ' ====')
if ($script:failed -gt 0) {
    Write-Host ('沙箱保留在：' + $sandbox)
    exit 1
}
[System.IO.Directory]::Delete($sandbox, $true)
exit 0
