#Requires -Version 5.1
<#
.SYNOPSIS
    安装 super-agent-router 插件到 MiniMax Code 的本地插件目录。

.DESCRIPTION
    一条命令装上，顺序固定，每一步都可复核：
      1. 依赖检查（node 必须在 PATH 里）
      2. 源包校验（plugin.json 存在 / name 与安装目录名一致 / hooks.json 引用的每个脚本都存在）
         —— 任一不满足就直接非零退出，**不装一半**
      3. 幂等安装：
           目标不存在         -> 直接装
           目标存在且版本相同 -> 报「已是最新」，不重装
           目标存在且版本不同 -> 先整份备份到 <Target>\.backup\super-agent-router-<时间戳>\，再装新版
      4. 装完自校验：文件数 + SHA256 哈希逐个文件与源比对，不一致即报错
      5. 可选播种项目状态层（-Project）：只播种模板，**不复制本项目的成员 / 方法论 / 错题本**
      6. 路径参数（-Target / -Project / 家目录）若含**尾随空白** ⇒ 直接报错退出，
         不做静默规范化 —— 尾随空格是路径身份的一部分，裁掉后会作用到另一个目录
      7. 路径参数若含 Windows 路径非法字符（" < > | * ? 与控制字符）⇒ 同样直接报错退出，
         并点名最可能的原因：命令行里末尾的反斜杠被闭引号吃掉了
         （-Target "D:\My Plugins\" 实际会被解析成 D:\My Plugins"）

.PARAMETER Target
    插件安装根目录。默认 $env:USERPROFILE\.minimax\plugins。
    插件本体装在 <Target>\super-agent-router\。

.PARAMETER Project
    可选。指定后会把项目状态层播种到 <Project>\.superagent\。
    只写缺失的文件，已存在的文件一律不覆盖（你的数据优先）。

.PARAMETER VerifyOnly
    只做校验，一个字节都不写：依赖、源包、目标现状都会被检查并打印，然后退出。

.EXAMPLE
    .\install.ps1
    一键装到默认目录。

.EXAMPLE
    .\install.ps1 -Project "D:\my-project"
    装插件，并给该项目播种一份 .superagent\ 状态层。

.EXAMPLE
    .\install.ps1 -VerifyOnly
    只检查不安装。

.NOTES
    装完必须**新开一个会话**：插件的 Hook 按会话激活，旧会话不会重新注入。
#>
[CmdletBinding()]
param(
    [string]$Target = '',
    [string]$Project = '',
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

# ── 常量 ────────────────────────────────────────────────────────────
$Script:PluginName = 'super-agent-router'
$Script:SourceDir = Join-Path $PSScriptRoot 'plugin'
$Script:StateSrcDir = Join-Path $PSScriptRoot '.superagent'

# ── 输出 helper ─────────────────────────────────────────────────────
function Write-Head([string]$text) {
    Write-Host ''
    Write-Host ("== " + $text) -ForegroundColor Cyan
}
function Write-Ok([string]$text) {
    Write-Host ("  [OK] " + $text) -ForegroundColor Green
}
function Write-Note([string]$text) {
    Write-Host ("  [i] " + $text) -ForegroundColor Gray
}
function Write-WarnTxt([string]$text) {
    Write-Host ("  [!] " + $text) -ForegroundColor Yellow
}
function Write-ErrTxt([string]$text) {
    Write-Host ("  [X] " + $text) -ForegroundColor Red
}
function Fail([string]$text) {
    Write-Host ''
    Write-ErrTxt $text
    exit 1
}

function Assert-NoTrailingWhitespace([string]$value, [string]$label) {
    # 路径的**尾随空白是路径身份的一部分**（本项目 RT-08 的教训）。
    # Windows 常规 API 造不出 "dir " 这样的名字，但 \\?\ 扩展路径 / NTFS 直写可以。
    # [System.IO.Path]::GetFullPath() 会把尾随空白**裁掉** ⇒ 规范化之后 "X " 与 "X" 无法区分，
    # 而脚本要作用到哪个目录就由裁剪后的名字决定 ⇒ 可能动到用户**没指定**的那个目录。
    # 所以在**任何规范化之前**判定：带尾随空白就 fail closed，绝不静默改写用户给的路径。
    if ([string]::IsNullOrEmpty($value)) { return }
    $hits = @()
    if ($value -match '[ \t]$') { $hits += '路径末尾' }
    $parts = $value -split '[\\/]'
    for ($i = 0; $i -lt $parts.Count; $i++) {
        if ($parts[$i].Length -gt 0 -and $parts[$i] -match '[ \t]$') {
            $hits += ('第 ' + ($i + 1) + ' 段 "' + $parts[$i] + '"')
        }
    }
    if ($hits.Count -gt 0) {
        Fail ('路径参数 ' + $label + ' 含尾随空白（' + ($hits -join '；') + '）—— 已停止，未做任何改动。' +
              '尾随空格是路径身份的一部分；若被静默裁掉，脚本会作用到**另一个**目录。')
    }
}

function Assert-NoIllegalPathChars([string]$value, [string]$label) {
    # Windows 路径非法字符检查 —— 必须在 **GetFullPath 之前**。
    #
    # 为什么需要：.NET 的 [System.IO.Path]::GetFullPath 碰到这些字符会直接抛
    #   Exception calling "GetFullPath" with "1" argument(s): "Illegal characters in path."
    # 用户看到的是 .NET 异常堆栈，完全看不懂问题在哪。
    # 最常见的触发原因是**命令行里末尾的反斜杠被闭引号吃掉**：
    #   -Target "D:\My Plugins\"  实际被解析成  D:\My Plugins"   （多出一个引号）
    # （路径含空格或非 ASCII 时尤其容易发生。）
    #
    # 这里**只报错、不修复**：把那个多余的引号悄悄去掉再继续跑，
    # 就是「静默改写用户给的路径」—— 与 F1 反对的同一类问题，必须 fail closed。
    if ([string]::IsNullOrEmpty($value)) { return }
    $hits = @()
    for ($i = 0; $i -lt $value.Length; $i++) {
        $ch = $value[$i]
        $code = [int][char]$ch
        if ($ch -eq '"' -or $ch -eq '<' -or $ch -eq '>' -or $ch -eq '|' -or $ch -eq '*' -or $ch -eq '?') {
            $hits += ('第 ' + ($i + 1) + ' 个字符「' + $ch + '」')
        } elseif ($code -lt 32) {
            $hits += ('第 ' + ($i + 1) + ' 个字符（控制字符 0x' + $code.ToString('X2') + '）')
        }
    }
    if ($hits.Count -gt 0) {
        Fail ('路径参数 ' + $label + ' 含 Windows 路径非法字符（' + ($hits -join '；') + '）—— 已停止，未做任何改动。' +
              '最可能的原因：命令行里**末尾的反斜杠被闭引号吃掉**了 —— 例如 -Target "D:\My Plugins\" 实际会被解析成 D:\My Plugins"（多出一个引号）。' +
              '正确写法：去掉末尾的反斜杠（-Target "D:\My Plugins"），或者把末尾写成两个反斜杠（-Target "D:\My Plugins\\"）。')
    }
}
# ── 工具函数 ─────────────────────────────────────────────────────────
function Read-TextUtf8([string]$path) {
    # 显式 UTF-8：避免 PS 5.1 按 ANSI 读中文变乱码
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-TextNoBom([string]$path, [string]$text) {
    # 无 BOM：JSON 解析器（node 的 JSON.parse）不认 BOM
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $text, $enc)
}

function Get-PluginManifest([string]$dir) {
    $p = Join-Path (Join-Path $dir '.minimax-plugin') 'plugin.json'
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    try {
        return (Read-TextUtf8 $p | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Get-HookScriptRefs([string]$pluginDir) {
    # 从 hooks.json 里抠出它引用的 scripts/*.mjs 文件名
    $hooksPath = Join-Path (Join-Path $pluginDir 'hooks') 'hooks.json'
    $refs = @()
    if (-not (Test-Path -LiteralPath $hooksPath)) { return $refs }
    $text = Read-TextUtf8 $hooksPath
    $rx = [regex]'PLUGIN_ROOT[^A-Za-z0-9_.-]*[\\/]+scripts[\\/]+([A-Za-z0-9_.\-]+)'
    foreach ($m in $rx.Matches($text)) {
        $n = $m.Groups[1].Value
        if ($refs -notcontains $n) { $refs += $n }
    }
    return $refs
}

function Test-SourcePackage([string]$srcDir) {
    # 返回问题清单；空清单 = 源包自洽
    $problems = @()
    if (-not (Test-Path -LiteralPath $srcDir)) {
        $problems += ("源目录不存在：" + $srcDir)
        return $problems
    }
    $manifest = Get-PluginManifest $srcDir
    if ($null -eq $manifest) {
        $problems += 'plugin/.minimax-plugin/plugin.json 缺失或不是合法 JSON'
    } else {
        $name = [string]$manifest.name
        if ($name -ne $Script:PluginName) {
            $problems += ("plugin.json 的 name 是 '" + $name + "'，与安装目录名 '" + $Script:PluginName + "' 不一致")
        }
        if ([string]::IsNullOrEmpty([string]$manifest.version)) {
            $problems += 'plugin.json 缺少 version 字段'
        }
    }
    $hooksPath = Join-Path (Join-Path $srcDir 'hooks') 'hooks.json'
    if (-not (Test-Path -LiteralPath $hooksPath)) {
        $problems += 'plugin/hooks/hooks.json 缺失'
    } else {
        $refs = @(Get-HookScriptRefs $srcDir)
        if ($refs.Count -eq 0) {
            $problems += 'hooks.json 里没有解析到任何 PLUGIN_ROOT/scripts 引用'
        }
        foreach ($r in $refs) {
            $sp = Join-Path (Join-Path $srcDir 'scripts') $r
            if (-not (Test-Path -LiteralPath $sp)) {
                $problems += ("hooks.json 引用的脚本不存在：scripts/" + $r)
            }
        }
    }
    return $problems
}

function Get-FileMap([string]$root) {
    # 相对路径(正斜杠) -> SHA256
    $map = @{}
    if (-not (Test-Path -LiteralPath $root)) { return $map }
    $base = (Get-Item -LiteralPath $root).FullName
    $prefixLen = $base.Length
    foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($prefixLen) -replace '^[\\/]+', ''
        $rel = $rel -replace '\\', '/'
        $map[$rel] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    }
    return $map
}

function Compare-FileMaps($srcMap, $dstMap) {
    $diff = @()
    foreach ($k in $srcMap.Keys) {
        if (-not $dstMap.ContainsKey($k)) {
            $diff += ("缺失：" + $k)
        } elseif ($srcMap[$k] -ne $dstMap[$k]) {
            $diff += ("内容不一致：" + $k)
        }
    }
    foreach ($k in $dstMap.Keys) {
        if (-not $srcMap.ContainsKey($k)) {
            $diff += ("多出：" + $k)
        }
    }
    return $diff
}

# ── 1. 目标目录 ──────────────────────────────────────────────────────
# 家目录也要过判定：默认 Target 由 $env:USERPROFILE 拼出，家目录名带尾随空格的话，
# 所有基于它的路径都会被 Windows API 规范化到别的目录去。
Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
Assert-NoIllegalPathChars $env:USERPROFILE 'USERPROFILE（家目录）'
if ([string]::IsNullOrEmpty($Target)) {
    $Target = Join-Path $env:USERPROFILE '.minimax\plugins'
}
# 判定必须在 GetFullPath **之前** —— GetFullPath 会裁掉尾随空白。
# 非法字符同理：GetFullPath 碰到它们会抛 .NET 异常堆栈，用户看不懂（W2）。
Assert-NoTrailingWhitespace $Target '-Target'
Assert-NoIllegalPathChars $Target '-Target'
# -Project 也在任何写操作之前拦（否则会先装完插件才报错）。
if (-not [string]::IsNullOrEmpty($Project)) {
    Assert-NoTrailingWhitespace $Project '-Project'
    Assert-NoIllegalPathChars $Project '-Project'
}
$TargetRoot = [System.IO.Path]::GetFullPath($Target)
$DestDir = Join-Path $TargetRoot $Script:PluginName

Write-Head 'super-agent-router 安装程序'
Write-Note ('源目录   : ' + $Script:SourceDir)
Write-Note ('安装目标 : ' + $DestDir)

# ── 2. 依赖检查 ──────────────────────────────────────────────────────
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    Fail '找不到 node —— 插件的 Hook 全部由 node 驱动，请先装 Node.js 18+ 并确认 node 在 PATH 里。'
}
$nodeVer = (& node --version) 2>$null
Write-Ok ('node 可用：' + [string]$nodeVer)

# ── 3. 源包校验（不通过就不装） ─────────────────────────────────────
Write-Head '源包校验'
$problems = @(Test-SourcePackage $Script:SourceDir)
if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-ErrTxt $p }
    Fail ('源包校验未通过（' + $problems.Count + ' 项）—— 已停止，没有安装任何东西。')
}
$srcManifest = Get-PluginManifest $Script:SourceDir
$srcVersion = [string]$srcManifest.version
Write-Ok ('plugin.json：name=' + [string]$srcManifest.name + ' version=' + $srcVersion)
$hookRefs = @(Get-HookScriptRefs $Script:SourceDir)
Write-Ok ('hooks.json 引用的 ' + $hookRefs.Count + ' 个脚本全部存在：' + ($hookRefs -join ', '))

$srcMap = Get-FileMap $Script:SourceDir
Write-Ok ('源包文件数：' + $srcMap.Count)

# ── 4. 目标现状 ──────────────────────────────────────────────────────
Write-Head '目标现状'
$destExists = Test-Path -LiteralPath $DestDir
$installedVersion = ''
if ($destExists) {
    $instManifest = Get-PluginManifest $DestDir
    if ($null -eq $instManifest) {
        Fail ('目标目录已存在但读不出 plugin.json（可能是别的插件，或文件已损坏）。为安全起见不覆盖：' + $DestDir)
    }
    if ([string]$instManifest.name -ne $Script:PluginName) {
        Fail ('目标目录里的插件名是 ' + [string]$instManifest.name + '，与预期不一致，拒绝覆盖：' + $DestDir)
    }
    $installedVersion = [string]$instManifest.version
    Write-Ok ('已安装版本：' + $installedVersion)
} else {
    Write-Note '目标目录不存在 —— 本次是首次安装'
}

# ── 5. VerifyOnly：到此为止，一个字节都不写 ─────────────────────────
if ($VerifyOnly) {
    Write-Head 'VerifyOnly：只校验，未写入任何文件'
    $destState = '不存在'
    if ($destExists) { $destState = ('已存在（v' + $installedVersion + '）') }
    Write-Ok ('依赖 OK / 源包自洽 / 目标目录 ' + $destState)
    Write-Note ('本次没有创建任何目录或文件：' + $TargetRoot)
    exit 0
}

# ── 6. 幂等判断 ──────────────────────────────────────────────────────
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$doInstall = $true
if ($destExists -and $installedVersion -eq $srcVersion) {
    $doInstall = $false
    Write-Head '已是最新 —— 不重装'
    Write-Ok ('目标已是 v' + $installedVersion + '，与源一致，跳过安装（没有备份、没有覆盖）')
}

# ── 7. 安装 ──────────────────────────────────────────────────────────
if ($doInstall) {
    Write-Head '安装'
    if (-not (Test-Path -LiteralPath $TargetRoot)) {
        New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
        Write-Note ('已创建安装根目录：' + $TargetRoot)
    }

    $stagingRoot = Join-Path $TargetRoot '.staging'
    if (-not (Test-Path -LiteralPath $stagingRoot)) {
        New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    }
    $stagingDir = Join-Path $stagingRoot ($Script:PluginName + '-' + $stamp)
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }

    try {
        Copy-Item -LiteralPath $Script:SourceDir -Destination $stagingDir -Recurse -Force
    } catch {
        if (Test-Path -LiteralPath $stagingDir) {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Fail ('复制源包失败，没有动目标目录：' + $_.Exception.Message)
    }

    # 装完自校验：文件数 + SHA256 逐个文件比对
    $stageMap = Get-FileMap $stagingDir
    $diff = @(Compare-FileMaps $srcMap $stageMap)
    if ($diff.Count -gt 0) {
        foreach ($d in $diff) { Write-ErrTxt $d }
        Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        Fail ('自校验失败（' + $diff.Count + ' 项不一致）—— 已丢弃暂存副本，目标目录未被改动。')
    }
    Write-Ok ('自校验通过：' + $stageMap.Count + ' 个文件，SHA256 全部一致')

    if ($destExists) {
        $backupRoot = Join-Path $TargetRoot '.backup'
        if (-not (Test-Path -LiteralPath $backupRoot)) {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        }
        $backupDir = Join-Path $backupRoot ($Script:PluginName + '-' + $stamp)
        try {
            Move-Item -LiteralPath $DestDir -Destination $backupDir -Force
        } catch {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
            Fail ('备份旧版本失败，没有动目标目录：' + $_.Exception.Message)
        }
        Write-Ok ('旧版本已备份到：' + $backupDir)
    }

    try {
        Move-Item -LiteralPath $stagingDir -Destination $DestDir -Force
    } catch {
        if (Test-Path -LiteralPath $stagingDir) {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Fail ('安装失败：' + $_.Exception.Message)
    }
    Write-Ok ('安装完成：' + $DestDir)

    # 装完再对最终目录做一次哈希比对
    $finalMap = Get-FileMap $DestDir
    $diff2 = @(Compare-FileMaps $srcMap $finalMap)
    if ($diff2.Count -gt 0) {
        foreach ($d in $diff2) { Write-ErrTxt $d }
        Fail ('最终目录自校验失败（' + $diff2.Count + ' 项不一致），请用 uninstall.ps1 -Purge 清掉后重装。')
    }
    Write-Ok ('最终目录复核通过：' + $finalMap.Count + ' 个文件，SHA256 全部一致')
}

# ── 8. 播种项目状态层（可选） ───────────────────────────────────────
if (-not [string]::IsNullOrEmpty($Project)) {
    Write-Head '播种项目状态层'
    # -Project 的尾随空白已在第 1 步拦过（那时还没写任何东西）
    $stateRoot = Join-Path ([System.IO.Path]::GetFullPath($Project)) '.superagent'
    $dirs = @('methods', 'lessons', 'incidents', 'agent-snapshots')
    foreach ($d in $dirs) {
        $p = Join-Path $stateRoot $d
        if (-not (Test-Path -LiteralPath $p)) {
            New-Item -ItemType Directory -Path $p -Force | Out-Null
            Write-Note ('已建目录：' + $d)
        }
    }

    # 模板：只从仓库自带的模板复制，不带任何成员的方法论 / 错题本
    $templates = @(
        @{ src = 'methods\_TEMPLATE.md'; dst = 'methods\_TEMPLATE.md' },
        @{ src = 'lessons\_TEMPLATE.md'; dst = 'lessons\_TEMPLATE.md' },
        @{ src = 'incidents\_TEMPLATE.md'; dst = 'incidents\_TEMPLATE.md' },
        @{ src = 'agent-snapshots\_README.md'; dst = 'agent-snapshots\_README.md' }
    )
    foreach ($t in $templates) {
        $src = Join-Path $Script:StateSrcDir $t.src
        $dst = Join-Path $stateRoot $t.dst
        if (-not (Test-Path -LiteralPath $src)) {
            Write-WarnTxt ('模板源不存在，跳过：' + $t.src)
            continue
        }
        if (Test-Path -LiteralPath $dst) {
            Write-Note ('已存在，不覆盖：' + $t.dst)
            continue
        }
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Write-Ok ('已播种：' + $t.dst)
    }

    # 名录：空 members（默认 0 个成员，成员在运行时现场配置）
    $rosterPath = Join-Path $stateRoot 'roster.json'
    if (Test-Path -LiteralPath $rosterPath) {
        Write-Note 'roster.json 已存在，不覆盖（你的数据优先）'
    } else {
        $rosterJson = @'
{
  "version": 1,
  "updated": "__DATE__",
  "note": "专项名录。成员在运行时按任务需要现场配置（source=runtime），不预先预置。内置成员 source=builtin。路由时需与 mavis_agent_list 交叉核对：list 有 roster 无 -> 收编；roster 有 list 无 -> 陈旧不派工。",
  "members": []
}
'@
        $rosterJson = $rosterJson.Replace('__DATE__', (Get-Date).ToString('yyyy-MM-dd'))
        Write-TextNoBom $rosterPath $rosterJson
        Write-Ok '已播种：roster.json（members 为空数组 —— 默认 0 个成员）'
    }

    # 项目状态说明
    $statusPath = Join-Path $stateRoot 'STATUS.md'
    if (Test-Path -LiteralPath $statusPath) {
        Write-Note 'STATUS.md 已存在，不覆盖（你的数据优先）'
    } else {
        $statusText = @'
# 项目状态层（.superagent/）

这个目录是**本项目专属**的编排状态：专项名录、方法论、错题本、变更留痕。
插件本体不在这里（插件装在 @BT@~/.minimax/plugins/@BT@），这里只放**每个项目各一份**的状态。

## 现在是什么状态

- 专项成员：**0 个**（默认不预置成员，用到时现场配置）
- 方法论：只有模板 @BT@methods/_TEMPLATE.md@BT@ —— 新建专项方法论时复制它
- 错题本：只有模板 @BT@lessons/_TEMPLATE.md@BT@
- 原始事故：只有模板 @BT@incidents/_TEMPLATE.md@BT@
- 变更留痕：@BT@changes.log@BT@（登记成员、提权等动作自动写这里）

## 怎么开始

1. 插件的 Hook **按会话激活** —— 装完或升级后要**新开一个会话**，旧会话不会重新注入。
2. 在新会话里提一句编排型请求，例如：
   > 这个需求拆成两个任务并行做，谁来负责？
3. 看到注入里出现 @BT@[super-agent-router]@BT@，就说明 Hook 生效了。

## 注意

- 这个目录**不会**随插件升级被覆盖（升级只动 @BT@~/.minimax/plugins/@BT@）。
- 卸载插件**不会**删这个目录 —— 它是数据，不是插件。
'@
        $statusText = $statusText.Replace('@BT@', [string][char]96)
        Write-TextNoBom $statusPath $statusText
        Write-Ok '已播种：STATUS.md'
    }

    $logPath = Join-Path $stateRoot 'changes.log'
    if (-not (Test-Path -LiteralPath $logPath)) {
        Write-TextNoBom $logPath ''
        Write-Ok '已播种：changes.log（空文件）'
    }
    Write-Note ('状态层位置：' + $stateRoot)
}

# ── 9. 收尾提示 ──────────────────────────────────────────────────────
Write-Head '接下来'
Write-WarnTxt 'Hook 按会话激活，必须新开一个会话才会生效。'
Write-Host ''
Write-Host '  1) 新开一个会话，在里面提一句编排型请求，例如：' -ForegroundColor Gray
Write-Host '       这个需求拆成两个任务并行做，谁来负责？' -ForegroundColor Gray
Write-Host '     看到注入里出现 [super-agent-router] 就说明通了。' -ForegroundColor Gray
Write-Host ''
Write-Host '  2) 想先手工确认脚本能跑（可选）：' -ForegroundColor Gray
Write-Host ('       node "' + (Join-Path $DestDir 'scripts\session-start.mjs') + '"') -ForegroundColor Gray
Write-Host ''
Write-Host '  3) 卸载：' -ForegroundColor Gray
Write-Host '       .\uninstall.ps1            # 移到 .trash\，可恢复' -ForegroundColor Gray
Write-Host '       .\uninstall.ps1 -Purge     # 彻底删除' -ForegroundColor Gray
Write-Host ''
Write-Host ('已安装版本：' + $srcVersion + '    目标：' + $DestDir) -ForegroundColor Cyan
exit 0
