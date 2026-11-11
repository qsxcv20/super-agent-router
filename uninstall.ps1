#Requires -Version 5.1
<#
.SYNOPSIS
    卸载 super-agent-router 插件。

.DESCRIPTION
    默认**不删**：把插件目录移到 <Target>\.trash\super-agent-router-<时间戳>\，并打印位置
    —— 后悔了可以搬回去。

    路径参数含**尾随空白**或 Windows 路径非法字符（" < > | * ? 与控制字符）一律报错退出，
    不做静默规范化 —— 空白与非法字符都是路径身份的一部分。

    -Purge    改成**真删**。删前做两层核对：
                · 路径级（**结构自检**，不构成独立验证）：末段必须是 super-agent-router，
                  目标必须在安装根之下。期望值与被检值同源，只防实现层面的错位。
                · 内容级（**唯一有牙齿的一条**）：读目标目录的 .minimax-plugin\plugin.json
                  核对 name，确认它**真的是本插件目录** —— 作用到别的目录一定过不了。
              路径参数含**尾随空白**一律报错退出，不做静默规范化
    -PurgeData 才清运行时台账（~/.minimax/v2/plugin-data/hooks/super-agent-router/）
              —— 台账是插件运行时留下的数据，不给 -PurgeData 就不动

    **项目里的 .superagent/ 一律不动**：那是你的项目数据，不是插件。

.PARAMETER Target
    插件安装根目录。默认 $env:USERPROFILE\.minimax\plugins。

.PARAMETER Purge
    彻底删除插件目录（不再留 .trash 副本）。

.PARAMETER PurgeData
    同时清掉运行时台账目录。

.EXAMPLE
    .\uninstall.ps1
    移到 .trash\，可恢复。

.EXAMPLE
    .\uninstall.ps1 -Purge
    彻底删除插件目录。

.EXAMPLE
    .\uninstall.ps1 -Purge -PurgeData
    彻底删除插件目录 + 运行时台账（项目里的 .superagent/ 仍然保留）。
#>
[CmdletBinding()]
param(
    [string]$Target = '',
    [switch]$Purge,
    [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'

$Script:PluginName = 'super-agent-router'

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

function Read-TextUtf8([string]$path) {
    # 显式 UTF-8：避免 PS 5.1 按 ANSI 读中文变乱码
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Assert-NoTrailingWhitespace([string]$value, [string]$label) {
    # 路径的**尾随空白是路径身份的一部分**（本项目 RT-08 的教训）。
    # [System.IO.Path]::GetFullPath() 会把尾随空白**裁掉** ⇒ 规范化之后 "X " 与 "X" 无法区分，
    # 而本脚本要删哪个目录就由裁剪后的名字决定 ⇒ 可能真删用户**没指定**的那个目录。
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

function Get-ComparablePath([string]$path) {
    # 比较用的路径形态归一：**只动分隔符，一个空白都不动**。
    # 空白是路径身份的一部分（F1 语义一个字不许松）；这里处理的是分隔符形态的差异。
    #
    # 为什么需要：GetFullPath("D:\plugins\") **保留**尾随反斜杠，而 Split-Path -Parent 会**去掉**它
    # ⇒ "D:\plugins" ≠ "D:\plugins\" ⇒ 用户用 -Target "D:\plugins\" 时装得上、卸不掉。
    if ([string]::IsNullOrEmpty($path)) { return '' }
    $p = $path -replace '/', '\'
    # 盘符根（C:\ C:/ C:）与 UNC 根（\\server\share\）不能被归成「没有尾分隔符」的形态
    if ($p -match '^[A-Za-z]:\\*$') { return ($p.Substring(0, 2) + '\') }
    if ($p -match '^\\\\[^\\]+\\[^\\]+\\*$') { return ($p.TrimEnd([char]92) + '\') }
    $t = $p.TrimEnd([char]92)
    if ($t.Length -eq 0) { return $p }
    return $t
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
# 路径安全判定：目标必须是 parent 的真子路径，且路径里没有 ".."
#
# 本函数**不做**任何尾随空白的裁剪或规范化 —— 规范化在更早一步就被拦掉了：
# Assert-NoTrailingWhitespace 在 GetFullPath 之前 fail closed（尾随空格是路径身份的一部分，
# 裁掉之后 "X " 与 "X" 无法区分，脚本会作用到用户没指定的那个目录）。
# 这里只回答一个问题：目标是不是 parent 的真子路径。
function Test-SafePath([string]$path, [string]$parent) {
    if ([string]::IsNullOrEmpty($path)) { return $false }
    if ([string]::IsNullOrEmpty($parent)) { return $false }
    if ($path.Contains('..')) { return $false }
    $p = $parent
    if (-not ($p.EndsWith('\') -or $p.EndsWith('/'))) {
        $p = $p + [System.IO.Path]::DirectorySeparatorChar
    }
    return $path.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
}

# 家目录也要过判定（默认 Target 由它拼出；家目录名带尾随空格 ⇒ 台账路径也会指向别的目录）
Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
Assert-NoIllegalPathChars $env:USERPROFILE 'USERPROFILE（家目录）'
if ([string]::IsNullOrEmpty($Target)) {
    $Target = Join-Path $env:USERPROFILE '.minimax\plugins'
}
# 判定必须在 GetFullPath **之前** —— GetFullPath 会裁掉尾随空白（F1 的根因）
# 非法字符同理：GetFullPath 碰到它们会抛 .NET 异常，用户看不懂（W2）。
Assert-NoTrailingWhitespace $Target '-Target'
Assert-NoIllegalPathChars $Target '-Target'
$TargetRoot = [System.IO.Path]::GetFullPath($Target)
$PluginDir = Join-Path $TargetRoot $Script:PluginName
$TrashRoot = Join-Path $TargetRoot '.trash'
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')

# 运行时台账
$dataDir = Join-Path $env:USERPROFILE '.minimax\v2\plugin-data\hooks\super-agent-router'
$dataParent = Join-Path $env:USERPROFILE '.minimax\v2\plugin-data\hooks'

Write-Head 'super-agent-router 卸载程序'
Write-Note ('插件目录 : ' + $PluginDir)
Write-Note ('安装根   : ' + $TargetRoot)

# ── 插件目录 ────────────────────────────────────────────────────────
$pluginExists = Test-Path -LiteralPath $PluginDir
if (-not $pluginExists) {
    Write-WarnTxt '插件目录不存在 —— 本机没有装（或已经卸掉了）。'
} else {
    # ── 删前核对：两层 ──────────────────────────────────────────────
    # (1) 路径级：**结构自检** —— 期望值与被检值同源，**不构成独立验证**，只防实现层面的错位。
    #     $PluginDir 由 $TargetRoot 派生 ⇒ 末段与父目录恒等于期望值；
    #     这一层**挡不住「作用到了别的目录」**，不要把它当成安全保证。
    #     比较前把两侧的**尾随分隔符**归一（GetFullPath 保留尾随反斜杠、Split-Path -Parent 去掉它
    #     ⇒ "D:\plugins" ≠ "D:\plugins\" ⇒ 装得上、卸不掉）。
    #     归一**只动分隔符，一个空白都不动** —— 空白是路径身份的一部分（F1 语义一个字不许松）。
    $leaf = Split-Path -Leaf $PluginDir
    $parentOfTarget = Split-Path -Parent $PluginDir
    $parentCmp = Get-ComparablePath $parentOfTarget
    $rootCmp = Get-ComparablePath $TargetRoot
    if ($leaf -ne $Script:PluginName) {
        Fail ('删前核对未通过：目标末段是 "' + $leaf + '"，不是 "' + $Script:PluginName + '"，已停止。')
    }
    if ($parentCmp -ne $rootCmp) {
        Fail ('删前核对未通过：目标的父目录 "' + $parentOfTarget + '" 不是安装根 "' + $TargetRoot + '"，已停止。')
    }
    if (-not (Test-SafePath $PluginDir $TargetRoot)) {
        Fail ('删前核对未通过：' + $PluginDir + ' 不在 ' + $TargetRoot + ' 之内，已停止。')
    }
    # (2) 内容级：**唯一有牙齿的一条** —— 目标必须**真的是本插件目录**：读它的 manifest 核对 name。
    #     这条不依赖路径怎么拼出来：只要作用到了别的目录（别的插件 / 没有 manifest / 名字不符），
    #     就一定过不了 ⇒ 前面那层恒等的结构自检挡不住的情形，这一层挡得住。
    $manifestPath = Join-Path $PluginDir '.minimax-plugin\plugin.json'
    $manifest = $null
    if (Test-Path -LiteralPath $manifestPath) {
        try { $manifest = (Read-TextUtf8 $manifestPath | ConvertFrom-Json) } catch { $manifest = $null }
    }
    if ($null -eq $manifest -or [string]$manifest.name -ne $Script:PluginName) {
        Fail ('删前核对未通过：' + $PluginDir + ' 不是本插件目录（读不到 .minimax-plugin\plugin.json，或 name 不是 ' + $Script:PluginName + '），已停止。')
    }
    Write-Note ('删前核对通过：路径级结构自检一致（末段 + 父目录），内容级确认是本插件目录（manifest name=' + [string]$manifest.name + '）')

    if ($Purge) {
        Remove-Item -LiteralPath $PluginDir -Recurse -Force
        Write-Ok ('已彻底删除：' + $PluginDir)
    } else {
        if (-not (Test-Path -LiteralPath $TrashRoot)) {
            New-Item -ItemType Directory -Path $TrashRoot -Force | Out-Null
        }
        $trashDir = Join-Path $TrashRoot ($Script:PluginName + '-' + $stamp)
        Move-Item -LiteralPath $PluginDir -Destination $trashDir -Force
        Write-Ok ('已移到回收位：' + $trashDir)
        Write-Host ''
        Write-Host '  想彻底删掉：' -ForegroundColor Gray
        Write-Host ('      Remove-Item -LiteralPath "' + $trashDir + '" -Recurse -Force') -ForegroundColor Gray
        Write-Host '  想装回去：把上面这个目录原样搬回上面那个「插件目录」即可。' -ForegroundColor Gray
    }
}

# ── 运行时台账 ──────────────────────────────────────────────────────
if ($PurgeData) {
    if (Test-Path -LiteralPath $dataDir) {
        # 同样是**结构自检**（期望值与被检值同源 ⇒ 不构成独立验证）；两侧都按尾随分隔符归一后再比
        $dataLeaf = Split-Path -Leaf $dataDir
        $dataParentOf = Split-Path -Parent $dataDir
        if ($dataLeaf -ne $Script:PluginName) {
            Fail ('台账路径核对未通过：末段是 "' + $dataLeaf + '"，不是 "' + $Script:PluginName + '"，已停止。')
        }
        if ((Get-ComparablePath $dataParentOf) -ne (Get-ComparablePath $dataParent)) {
            Fail ('台账路径核对未通过：父目录 "' + $dataParentOf + '" 不是 "' + $dataParent + '"，已停止。')
        }
        if (-not (Test-SafePath $dataDir $dataParent)) {
            Fail ('台账路径核对未通过：' + $dataDir + ' 不在 ' + $dataParent + ' 之内，已停止。')
        }
        if ($Purge) {
            Remove-Item -LiteralPath $dataDir -Recurse -Force
            Write-Ok ('已彻底删除运行时台账：' + $dataDir)
        } else {
            if (-not (Test-Path -LiteralPath $TrashRoot)) {
                New-Item -ItemType Directory -Path $TrashRoot -Force | Out-Null
            }
            $dataTrash = Join-Path $TrashRoot ('plugin-data-' + $stamp)
            Move-Item -LiteralPath $dataDir -Destination $dataTrash -Force
            Write-Ok ('运行时台账已移到回收位：' + $dataTrash)
        }
    } else {
        Write-Note '运行时台账目录不存在，无需处理'
    }
} else {
    if (Test-Path -LiteralPath $dataDir) {
        Write-Note ('运行时台账仍在（未动）：' + $dataDir)
        Write-Host '      要清它：.\uninstall.ps1 -PurgeData' -ForegroundColor Gray
    }
}

# ── 收尾 ────────────────────────────────────────────────────────────
Write-Head '收尾'
Write-WarnTxt '项目里的 .superagent/ 与运行时台账是**数据**，不是插件 —— 默认都没有动。'
Write-Host '  · 要清运行时台账： .\uninstall.ps1 -PurgeData' -ForegroundColor Gray
Write-Host '  · 要彻底删插件：   .\uninstall.ps1 -Purge' -ForegroundColor Gray
Write-Host '  · 项目里的 .superagent/ 要自己删（在你的项目目录里）。' -ForegroundColor Gray
Write-Host ''
Write-Host '  提示：插件的 Hook 按会话激活，卸载后请新开一个会话。' -ForegroundColor Gray
exit 0
