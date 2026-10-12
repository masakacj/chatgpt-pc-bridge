# Actual Windows Task Scheduler failure/recovery test. Uses only a new temporary
# service on13214; never stops production3211, staged13213 or Orchestrator3210.
param([switch]$Cleanup)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$port=13214
if($Cleanup){
 Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -match 'ExecutionPolicy Bypass -File scripts/test-service-recovery.ps1'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
 Get-ScheduledTask -TaskName 'ChatGPT-PC-Bridge-Recovery-*' -ErrorAction SilentlyContinue | ForEach-Object {Disable-ScheduledTask -TaskName $_.TaskName|Out-Null;Stop-ScheduledTask -TaskName $_.TaskName;Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false}
 foreach($n in Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($n.OwningProcess)";if($p.Name -eq 'node.exe' -and $p.CommandLine.Contains((Join-Path $root 'runtime\service\server.js'))){Stop-Process -Id $p.ProcessId -Force}}
 Write-Output '{"isolatedRecoveryTaskCleaned":true,"productionServicesTouched":false}';exit
}
$taskName='ChatGPT-PC-Bridge-Recovery-'+[guid]::NewGuid().ToString('N').Substring(0,10)
$directory=Join-Path $root ('var\'+$taskName)
$runner=Join-Path $PSScriptRoot 'run-service.ps1'
$owned=@();$cases=@();$result=$null
function Status([int]$n){try{return Invoke-RestMethod -Uri "http://127.0.0.1:$n/local/status" -TimeoutSec 2}catch{return $null}}
function Assert($value,[string]$message){if(-not $value){throw $message}}
$beforeStage=Status 13213
$beforeOrchestrator=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 3
Assert (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) 'Test port is occupied'
try {
 New-Item -ItemType Directory -Path $directory -Force|Out-Null
 & icacls.exe $directory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
 Assert ($LASTEXITCODE -eq 0) 'Private test directory ACL failed'
 # Artificial uncertain receipt: a process restart must retain it, never replay it.
 [IO.File]::WriteAllText((Join-Path $directory 'commands.json'),'{"synthetic-unknown-command":{"hash":"fixture","state":"unknown","action":"compose","result":{"status":"sent_unconfirmed"}}}',(New-Object Text.UTF8Encoding($false)))
 $arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$runner+'" -Port '+$port+' -DataDirectory "'+$directory+'"'
 $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $root
 $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
 $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 2 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description 'Temporary isolated Bridge recovery acceptance'|Out-Null
 Start-ScheduledTask -TaskName $taskName
 $first=$null
 for($i=0;$i -lt 35;$i++){Start-Sleep -Milliseconds 300;$first=Status $port;if($first){break}}
 Assert $first 'Test service did not start';$owned+=([int]$first.pid)
 Assert ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') 'Launcher exited while service was still running'
 [xml]$xml=Export-ScheduledTask -TaskName $taskName
 Assert ($xml.Task.Settings.ExecutionTimeLimit -eq 'PT0S') 'Execution limit must be disabled'
 Assert ($xml.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew') 'Duplicate instance policy is wrong'
 $cases+='scheduler supervises the live process with no maximum execution time'
 Start-ScheduledTask -TaskName $taskName;Start-Sleep -Milliseconds 400
 Assert ((Status $port).pid -eq $first.pid) 'Duplicate task launch spawned another process'
 $cases+='duplicate start is ignored while the original instance runs'
 $hashes=@{}
 foreach($name in @('pairing.json','extension-auth.json','commands.json')){$hashes[$name]=(Get-FileHash -LiteralPath (Join-Path $directory $name) -Algorithm SHA256).Hash}
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($first.pid)"
 Assert ($process.Name -eq 'node.exe' -and $process.CommandLine.Contains((Join-Path $root 'runtime\service\server.js'))) 'Refusing to stop an unrelated process'
 Assert ((Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen).OwningProcess -eq $first.pid) 'Test PID does not own test port'
 Stop-Process -Id $first.pid -Force
 $watch=[Diagnostics.Stopwatch]::StartNew();$recovered=$null
 for($i=0;$i -lt 18;$i++){Start-Sleep -Seconds 1;$s=Status $port;if($s -and $s.pid -ne $first.pid){$recovered=$s;break}}
 Assert $recovered 'Task Scheduler did not restart the failed child'
 $owned+=([int]$recovered.pid)
 $cases+='scheduled service wrapper restarts its killed child without another launcher'
 foreach($name in $hashes.Keys){Assert ((Get-FileHash -LiteralPath (Join-Path $directory $name) -Algorithm SHA256).Hash -eq $hashes[$name]) ('Private state changed after recovery: '+$name)}
 Assert ($recovered.journalCount -eq 1 -and $recovered.pending -eq 0) 'Uncertain fixture receipt was lost or replayed'
 $cases+='pairing keys and uncertain command journal survive the restart unchanged'
 $afterStage=Status 13213
 $afterOrchestrator=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 3
 Assert ($afterStage.pid -eq $beforeStage.pid -and $afterOrchestrator.executors -eq $beforeOrchestrator.executors) 'An unrelated service changed during the test'
 $cases+='staged Bridge and original Orchestrator remain running'
 $result=@{pass=$true;cases=$cases;count=$cases.Count;port=$port;recoverySeconds=[Math]::Round($watch.Elapsed.TotalSeconds,1);production3211Changed=$false;realMessagesSent=0}
} finally {
 Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue|Out-Null
 Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 Start-Sleep -Milliseconds 200
 # Cleanup only processes whose ownership was established above.
 foreach($processId in $owned){
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if($p -and $p.Name -eq 'node.exe' -and $p.CommandLine.Contains((Join-Path $root 'runtime\service\server.js'))){Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue}
 }
 Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
 if($result){
  $result.cleanupComplete=(-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue))
  $result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'var\service-recovery-result.json') -Encoding UTF8
  $result|ConvertTo-Json -Depth 5 -Compress
 }
 if(Test-Path -LiteralPath $directory){Remove-Item -LiteralPath $directory -Recurse -Force}
}
