param(
  [int]$Port=3211,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [string]$ExtensionId='heamldipoecpedbnoffiaadjkdagbmoc'
)
# Task Scheduler must supervise the running process, not a launcher which exits
# immediately after Start-Process. No extra daemon or polling service is needed.
$ErrorActionPreference='Stop'
try {
  if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid service port'}
  if($ExtensionId -notmatch '^[a-p]{32}$'){throw 'Invalid extension ID'}
  if(-not (Test-Path -LiteralPath $DataDirectory -PathType Container)){throw 'Private data directory must be initialized before scheduling'}
  $root=Split-Path -Parent $PSScriptRoot
  $entry=Join-Path $root 'runtime\service\server.js'
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  if(-not (Test-Path -LiteralPath $entry)){throw 'Bridge runtime is missing'}
  $env:BRIDGE_PORT=[string]$Port
  $env:BRIDGE_DATA_DIR=$DataDirectory
  $env:BRIDGE_EXTENSION_IDS=$ExtensionId
  Set-Location (Join-Path $root 'runtime')
  # Keep one owned child alive. This also covers Windows hosts where manually
  # started tasks do not apply RestartOnFailure as expected. The task itself
  # remains Running and the outer scheduler can still recover the wrapper.
  while($true){
    $child=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WorkingDirectory (Join-Path $root 'runtime') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'supervised.out.log') -RedirectStandardError (Join-Path $DataDirectory 'supervised.err.log')
    @{pid=$child.Id;port=$Port;entry=$entry;dataDirectory=$DataDirectory;extensionId=$ExtensionId;supervised=$true;startedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $DataDirectory 'process.json') -Encoding UTF8
    $child.WaitForExit()
    Start-Sleep -Seconds 2
  }
} catch {
  # Report only a startup category, never private file contents or pairing keys.
  Write-Error 'Independent Bridge failed to start; inspect its local status and runtime.'
  exit 1
}
