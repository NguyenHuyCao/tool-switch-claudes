<#
  kc - chuyen giua nhieu tai khoan Claude Code tren cung mot may, dung chung lich su phien.

  Ho so "a"  = ~/.claude (tai khoan dang dang nhap trong app desktop).
  Ho so khac = ~/.claude-<ten>, co dang nhap RIENG (.credentials.json, .claude.json),
               nhung noi (junction) ve ~/.claude cac thu muc dung chung:
               projects (lich su phien + memory), agents, commands, skills.
               settings.json duoc chep tu ~/.claude moi lan chay.

  Cach dung:
    kc setup b              tao ho so b (chay 1 lan)
    kc login b              mo Claude bang ho so b de go /login tai khoan thu hai
    kc b                    chay Claude bang tai khoan b o thu muc hien tai
    kc b --continue         tiep tuc phien gan nhat cua thu muc nay (ke ca phien do tai khoan a tao)
    kc b --resume           chon phien de mo lai
    kc a ...                chay bang tai khoan a (mac dinh)
    kc status               liet ke ho so
    kc ui                   bat server chay nen (neu chua) va mo trang quan ly phien (http://127.0.0.1:4717)
    kc ui stop|restart|status   tat / khoi dong lai / xem server; kc ui --fg = chay o terminal nay
    kc autostart on|off     tu chay trang quan ly (an) moi khi dang nhap Windows
#>
param([Parameter(Position = 0)][string]$Cmd = 'status',
      [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest)

$ErrorActionPreference = 'Stop'
$Base   = Join-Path $HOME '.claude'
$Shared = @('projects', 'agents', 'commands', 'skills')
$Copied = @('settings.json', 'CLAUDE.md')

function Get-ProfileDir([string]$name) {
  if ($name -eq 'a') { return $Base }
  if ($name -notmatch '^[a-z0-9_-]{1,20}$') { throw "Ten ho so khong hop le: $name" }
  return Join-Path $HOME ".claude-$name"
}

function Find-Claude {
  $c = Get-Command claude -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  # Ban kem trong app desktop: lay ban moi nhat
  $root = Join-Path $env:LOCALAPPDATA 'Claude-Data'
  $exe = Get-ChildItem $root -Recurse -Filter claude.exe -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -match '\\claude-code\\' } |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  throw "Khong tim thay claude. Cai: npm i -g @anthropic-ai/claude-code"
}

function Sync-Profile([string]$dir) {
  foreach ($f in $Copied) {
    $src = Join-Path $Base $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $dir $f) -Force }
  }
}

function Setup-Profile([string]$name) {
  if ($name -eq 'a') { Write-Host "Ho so a la ~/.claude, khong can setup."; return }
  $dir = Get-ProfileDir $name
  New-Item -ItemType Directory -Force $dir | Out-Null
  foreach ($d in $Shared) {
    $target = Join-Path $Base $d
    $link   = Join-Path $dir $d
    New-Item -ItemType Directory -Force $target | Out-Null
    if (Test-Path $link) {
      $item = Get-Item $link -Force
      if ($item.LinkType -eq 'Junction') { continue }
      throw "$link da ton tai va khong phai junction - xu ly tay truoc."
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  }
  Sync-Profile $dir
  Write-Host "Da tao ho so '$name' tai $dir"
  Write-Host "Buoc tiep: kc login $name   (roi go /login trong Claude, dang nhap tai khoan thu hai)"
}

function Run-Profile([string]$name, [string[]]$claudeArgs) {
  $dir = Get-ProfileDir $name
  if ($name -ne 'a') {
    if (-not (Test-Path (Join-Path $dir 'projects'))) { Setup-Profile $name }
    Sync-Profile $dir
  }
  $exe = Find-Claude
  $old = $env:CLAUDE_CONFIG_DIR
  try {
    if ($name -eq 'a') { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    else { $env:CLAUDE_CONFIG_DIR = $dir }
    Write-Host "[kc] tai khoan '$name' | cau hinh: $dir" -ForegroundColor Cyan
    & $exe @claudeArgs
  } finally {
    if ($null -eq $old) { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    else { $env:CLAUDE_CONFIG_DIR = $old }
  }
}

function Show-Status {
  Write-Host "claude: $(try { Find-Claude } catch { 'KHONG CO' })"
  $dirs = @($Base) + @(Get-ChildItem $HOME -Directory -Force -Filter '.claude-*' | ForEach-Object FullName)
  foreach ($d in $dirs) {
    $name = if ($d -eq $Base) { 'a' } else { (Split-Path $d -Leaf).Substring(8) }
    $login = if (Test-Path (Join-Path $d '.credentials.json')) { 'da dang nhap' } else { 'CHUA dang nhap' }
    $linked = if ($name -eq 'a') { 'goc' } else {
      $ok = @($Shared | Where-Object { (Get-Item (Join-Path $d $_) -Force -ErrorAction SilentlyContinue).LinkType -eq 'Junction' })
      "dung chung $($ok.Count)/$($Shared.Count)"
    }
    '{0,-6} {1,-16} {2,-16} {3}' -f $name, $login, $linked, $d
  }
}

$UiPort = 4717
$UiUrl  = "http://127.0.0.1:$UiPort"
$UiSrv  = Join-Path $PSScriptRoot 'ui\server.mjs'

function Get-UiPing {
  try { return Invoke-RestMethod "$UiUrl/api/ping" -TimeoutSec 2 } catch { return $null }
}

function Start-UiServer {
  # Tao tien trinh qua WMI: no khong la con cua terminal / app Claude, nen khong bi tat theo
  # khi dong terminal, dong phien Claude hay doi tai khoan trong app desktop.
  $node = (Get-Command node -ErrorAction Stop).Source
  $line = '"' + $node + '" "' + $UiSrv + '" ' + $UiPort + ' --no-open'
  $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $line; CurrentDirectory = (Split-Path $UiSrv); ProcessStartupInformation = $si }
  if ($r.ReturnValue -ne 0) { throw "Khong khoi dong duoc server (WMI ma $($r.ReturnValue))" }
  for ($i = 0; $i -lt 25; $i++) { Start-Sleep -Milliseconds 200; $p = Get-UiPing; if ($p) { return $p } }
  throw "Server khong len sau 5 giay - xem $(Join-Path $PSScriptRoot 'ui\server.log')"
}

function Stop-UiServer {
  $p = Get-UiPing
  if (-not $p) { Write-Host 'Server dang tat.'; return }
  $tok = (Get-Content (Join-Path $PSScriptRoot 'ui\.token') -Raw).Trim()
  try { Invoke-RestMethod "$UiUrl/api/stop" -Method Post -Headers @{ 'X-KC-Token' = $tok } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null }
  catch { Stop-Process -Id $p.pid -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 15 -and (Get-UiPing); $i++) { Start-Sleep -Milliseconds 200 }
  Write-Host "Da tat server (pid $($p.pid))."
}

switch ($Cmd) {
  'status' { Show-Status; $p = Get-UiPing; if ($p) { "ui     dang chay (pid $($p.pid)) $UiUrl" } else { 'ui     TAT  (kc ui de bat)' } }
  'ui' {
    switch ($Rest | Select-Object -First 1) {
      '--fg'    { & node $UiSrv $UiPort; return }
      'stop'    { Stop-UiServer; return }
      'restart' { Stop-UiServer; $p = Start-UiServer; Write-Host "Server chay lai (pid $($p.pid)): $UiUrl"; return }
      'status'  { $p = Get-UiPing; if ($p) { "dang chay (pid $($p.pid)) $UiUrl" } else { 'TAT' }; return }
    }
    $p = Get-UiPing
    if ($p) { Write-Host "Server da chay san (pid $($p.pid)): $UiUrl" }
    else { $p = Start-UiServer; Write-Host "Da bat server chay nen (pid $($p.pid)): $UiUrl" }
    if ($Rest -notcontains '--no-open') { Start-Process $UiUrl }
  }
  'autostart' {
    $startup = [Environment]::GetFolderPath('Startup')
    $vbs = Join-Path $startup 'kc-ui.vbs'
    switch ($Rest | Select-Object -First 1) {
      'on' {
        $node = (Get-Command node -ErrorAction Stop).Source
        $srv  = Join-Path $PSScriptRoot 'ui\server.mjs'
        # Chay an (0), khong cho, khong mo trinh duyet
        $line = 'CreateObject("WScript.Shell").Run """' + $node + '"" ""' + $srv + '"" 4717 --no-open", 0, False'
        Set-Content -Path $vbs -Value $line -Encoding ascii
        Write-Host "Da bat: trang quan ly tu chay khi dang nhap Windows ($vbs)"
      }
      'off' {
        if (Test-Path $vbs) { Remove-Item $vbs -Confirm:$false; Write-Host 'Da tat tu khoi dong.' }
        else { Write-Host 'Tu khoi dong dang tat san.' }
      }
      default { if (Test-Path $vbs) { "autostart: BAT ($vbs)" } else { 'autostart: TAT  (kc autostart on de bat)' } }
    }
  }
  'setup'  { if (-not $Rest) { throw 'kc setup <ten>' }; Setup-Profile $Rest[0] }
  'login'  { if (-not $Rest) { throw 'kc login <ten>' }; Run-Profile $Rest[0] @() }
  default  { Run-Profile $Cmd @($Rest | Where-Object { $_ }) }
}
