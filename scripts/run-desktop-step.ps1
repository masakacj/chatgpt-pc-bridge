param([ValidateSet('inspect','install','configure','test-page','reload')][string]$Step='inspect',[int]$Port=13213)
$ErrorActionPreference='Stop'
# Reload never enters the interactive desktop task or UI automation path.
if($Step -eq 'reload'){
 $maintenance=Join-Path (Split-Path (Split-Path -Parent $PSScriptRoot) -Parent) 'igg-workflow\scripts\reload-browser-extension.mjs'
 & node $maintenance 'pc-bridge' '--port' $Port
 exit $LASTEXITCODE
}
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $PSScriptRoot 'desktop-bridge.ps1'
$folder=Join-Path $root 'var';New-Item -ItemType Directory -Path $folder -Force|Out-Null
$result=Join-Path $folder ('desktop-'+$Step+'.json')
if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result -Force}
$task='ChatGPT-Bridge-Desktop-'+[guid]::NewGuid().ToString('N').Substring(0,10)
$command="& ([scriptblock]::Create([IO.File]::ReadAllText('$script',[Text.Encoding]::UTF8))) -Step $Step -Port $Port"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+$encoded) -WorkingDirectory $root
$principal=New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try{
 Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Description 'One-shot authorized Bridge extension UI setup; preserves original executor.'|Out-Null
 Start-ScheduledTask -TaskName $task
 for($i=0;$i -lt 55;$i++){
  Start-Sleep -Seconds 1
  if(Test-Path -LiteralPath $result){Get-Content -LiteralPath $result -Raw -Encoding UTF8;exit}
  $state=(Get-ScheduledTask -TaskName $task).State
  if($i -gt 5 -and $state -ne 'Running'){$info=Get-ScheduledTaskInfo -TaskName $task;throw ('Desktop task ended without result: '+$info.LastTaskResult)}
 }
 throw 'Desktop step timeout; no production service was switched'
}finally{
 Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
 Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
}
