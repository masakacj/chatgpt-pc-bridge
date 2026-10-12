param(
  [ValidateSet('start','stop','status','install-startup')][string]$Action='status',
  [int]$Port=13213,
  [string]$DataDirectory='D:\workspace\py\chatgpt-pc-bridge\var\stage',
  [string]$ExtensionId='heamldipoecpedbnoffiaadjkdagbmoc'
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$runtime=Join-Path $root 'runtime'
$entry=Join-Path $runtime 'service\server.js'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$meta=Join-Path $DataDirectory 'process.json'
if($ExtensionId -notmatch '^[a-p]{32}$'){throw 'Invalid extension ID'}
if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid service port'}
function Get-BridgeStatus {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/local/status" -TimeoutSec 3 }
  catch { return $null }
}
function Initialize-PrivateDirectory {
  if(-not (Test-Path -LiteralPath $DataDirectory)){New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null}
  & icacls.exe $DataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Cannot restrict private Bridge data directory'}
}
if($Action -eq 'status'){
  $s=Get-BridgeStatus
  if($s){$s|ConvertTo-Json -Compress -Depth 6}else{[pscustomobject]@{running=$false;port=$Port}|ConvertTo-Json -Compress}
  exit
}
if($Action -eq 'stop'){
  if(-not (Test-Path -LiteralPath $meta)){throw 'No owned Bridge process record'}
  $m=Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json
  if($m.supervised){
    $task=Get-ScheduledTask -TaskName 'ChatGPT-PC-Bridge' -ErrorAction SilentlyContinue
    if(-not $task -or -not $task.Actions[0].Arguments.Contains('"'+$DataDirectory+'"')){throw 'Supervised process has no matching owned task; stop its supervisor first'}
    Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
    Stop-ScheduledTask -TaskName $task.TaskName
  }
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($m.pid)"
  if($p -and ($p.Name -ne 'node.exe' -or $p.CommandLine -notlike "*$entry*")){throw 'Recorded PID no longer belongs to Bridge'}
  if($p){Stop-Process -Id $p.ProcessId -ErrorAction Stop}
  [pscustomobject]@{stopped=$true;pid=$m.pid;port=$m.port}|ConvertTo-Json -Compress
  exit
}
if($Action -eq 'install-startup'){
  if($Port -ne 3211){throw 'Only the verified final service may be registered for startup'}
  Initialize-PrivateDirectory
  $taskName='ChatGPT-PC-Bridge'
  $runner=Join-Path $PSScriptRoot 'run-service.ps1'
  $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$runner+'" -Port 3211 -DataDirectory "'+$DataDirectory+'" -ExtensionId '+$ExtensionId
  $taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $root
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $principal -Trigger $trigger -Settings $settings -Description 'Independent local ChatGPT mobile Bridge; does not start or stop Orchestrator.' -Force | Out-Null
  [pscustomobject]@{startupRegistered=$true;task=$taskName;port=3211;supervisedProcess=$true;executionTimeLimit='PT0S';restartInterval='PT1M';restartCount=999}|ConvertTo-Json -Compress
  exit
}
if(-not (Test-Path -LiteralPath $entry)){throw 'Stage the tested runtime before starting'}
$s=Get-BridgeStatus
if($s){[pscustomobject]@{alreadyRunning=$true;pid=$s.pid;version=$s.version;port=$Port}|ConvertTo-Json -Compress;exit}
$listeners=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if($listeners){throw 'Loopback port is already owned by another process'}
if($Port -eq 3211){
  $task=Get-ScheduledTask -TaskName 'ChatGPT-PC-Bridge' -ErrorAction SilentlyContinue
  if($task){
    if(-not $task.Actions[0].Arguments.Contains('"'+$DataDirectory+'"')){throw 'Registered task data directory does not match'}
    Enable-ScheduledTask -TaskName $task.TaskName|Out-Null
    Start-ScheduledTask -TaskName $task.TaskName
    for($i=0;$i -lt 25;$i++){Start-Sleep -Milliseconds 200;$s=Get-BridgeStatus;if($s){[pscustomobject]@{started=$true;pid=$s.pid;port=$Port;version=$s.version;supervised=$true}|ConvertTo-Json -Compress;exit}}
    throw 'Scheduled Bridge did not become healthy'
  }
}
Initialize-PrivateDirectory
$env:BRIDGE_PORT=[string]$Port
$env:BRIDGE_DATA_DIR=$DataDirectory
$env:BRIDGE_EXTENSION_IDS=$ExtensionId
$out=Join-Path $DataDirectory 'service.out.log';$err=Join-Path $DataDirectory 'service.err.log'
$p=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WorkingDirectory $runtime -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
@{pid=$p.Id;port=$Port;entry=$entry;dataDirectory=$DataDirectory;extensionId=$ExtensionId;startedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $meta -Encoding UTF8
for($i=0;$i -lt 25;$i++){
  Start-Sleep -Milliseconds 200
  $s=Get-BridgeStatus
  if($s){[pscustomobject]@{started=$true;pid=$s.pid;port=$Port;version=$s.version;extensionConnected=$s.extensionConnected;privateDirectoryRestricted=$true}|ConvertTo-Json -Compress;exit}
  if($p.HasExited){throw 'Bridge exited during startup; inspect private service error log'}
}
throw 'Bridge did not become healthy'
