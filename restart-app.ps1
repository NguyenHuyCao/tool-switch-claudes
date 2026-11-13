<#
  Khoi dong lai app Claude desktop de no doc lai danh sach phien (sau khi kc chuyen phien sang tai khoan khac).
  Chi dong tien trinh cua app (thu muc WindowsApps\Claude_*), KHONG dong claude.exe chay o terminal.
  Moi phien dang chay trong app se dung lai; hoi thoai van con, mo lai la lam tiep.
    restart-app.ps1            dong + mo lai
    restart-app.ps1 -DryRun    chi liet ke se dong gi, khong dong
  Nhat ky: ui\server.log (cung file voi server).
#>
param([switch]$DryRun)
$ErrorActionPreference = 'Continue'   # 5.1: 'Stop' bien stderr cua lenh ngoai thanh loi chet nguoi
$AppId = 'Claude_pzs8sxrjxfjjc!Claude'
$Log = Join-Path $PSScriptRoot 'ui\server.log'
function Log($m) {
  $line = "[$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))] restart-app: $m"
  try { Add-Content -Path $Log -Value $line -Encoding utf8 } catch { }
  Write-Output $line
}

function Get-AppProcs {
  @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" |
    Where-Object { $_.ExecutablePath -like '*\WindowsApps\Claude_*' })
}

try {
  $procs = Get-AppProcs
  $ids = @($procs | ForEach-Object { $_.ProcessId })
  $main = @($procs | Where-Object { $ids -notcontains $_.ParentProcessId })
  Log "tim thay $($procs.Count) tien trinh app, goc: $(($main | ForEach-Object { $_.ProcessId }) -join ',')"
  if ($DryRun) { Log 'chay thu - khong dong gi'; exit 0 }

  if ($procs.Count) {
    # Dong tien trinh goc truoc (cac tien trinh con cua Electron tu thoat theo), roi don phan con lai.
    foreach ($m in $main) { Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 25 -and (Get-AppProcs).Count; $i++) { Start-Sleep -Milliseconds 200 }
    foreach ($p in Get-AppProcs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 25 -and (Get-AppProcs).Count; $i++) { Start-Sleep -Milliseconds 200 }
    $left = (Get-AppProcs).Count
    if ($left) { Log "LOI: con $left tien trinh app chua dong"; exit 1 }
    Log 'da dong app'
  }
  Start-Sleep -Milliseconds 1000
  Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\$AppId"
  for ($i = 0; $i -lt 50 -and -not (Get-AppProcs).Count; $i++) { Start-Sleep -Milliseconds 200 }
  if ((Get-AppProcs).Count) { Log 'da mo lai app' } else { Log 'LOI: app chua mo lai sau 10 giay - mo tay tu Start menu' ; exit 1 }
} catch {
  Log "LOI: $($_.Exception.Message)"
  exit 1
}
