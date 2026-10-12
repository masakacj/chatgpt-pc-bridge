param([ValidateSet('inspect','install','configure','test-page','reload')][string]$Step='inspect',[int]$Port=13213)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BridgeDesktop {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
$root='D:\workspace\py\chatgpt-pc-bridge'
$output=Join-Path $root ('var\desktop-'+$Step+'.json')
$target='D:\workspace\py\chatgpt-pc-bridge\runtime\extension'
$expected='heamldipoecpedbnoffiaadjkdagbmoc'
function Report($data){$data|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $output -Encoding UTF8}
function Progress($phase){@{phase=$phase;at=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root ('var\desktop-'+$Step+'.progress.json')) -Encoding UTF8}
function Descendants($element){return $element.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)}
function ChromeWindow {
 $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 for($i=0;$i -lt $windows.Count;$i++){
  $w=$windows.Item($i)
  try {$pattern=if($Step -in @('configure','test-page','reload')){'ChatGPT PC Bridge'}else{'(Extensions|扩展程序|擴充功能)'};if($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match $pattern) {return $w}}catch{}
 }
 return $null
}
function FindControl($window,[string]$pattern,[string]$type=''){
 $items=Descendants $window
 for($i=0;$i -lt $items.Count;$i++){
  $e=$items.Item($i)
  try {if($e.Current.Name -match $pattern -and (-not $type -or $e.Current.ControlType.ProgrammaticName -eq $type)){return $e}}catch{}
 }
 return $null
}
function ById($window,[string]$id){return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id)))}
function ClickControl($element){
 if(-not $element){throw 'Required button not found'}
 $r=$element.Current.BoundingRectangle
 if($r.Width -lt 2 -or $r.Height -lt 2){throw 'Button has no visible click area'}
 [BridgeDesktop]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))|Out-Null
 [BridgeDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[BridgeDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
function InvokeControl($element){
 if(-not $element){throw 'Required control not found'}
 $invoke=$null
 if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){$invoke.Invoke();return}
 $toggle=$null
 if($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$toggle)){$toggle.Toggle();return}
 throw 'Required control is not invokable'
}
try{
 if([System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){throw 'Interactive desktop session required'}
 $chrome='C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
 $url=if($Step -in @('configure','test-page','reload')){'chrome-extension://'+$expected+'/options.html'}else{'chrome://extensions/'}
 Start-Process -FilePath $chrome -ArgumentList ('--profile-directory="Default" "'+$url+'"')|Out-Null
 $window=$null
 for($n=0;$n -lt 12 -and -not $window;$n++){Start-Sleep -Milliseconds 250;$window=ChromeWindow}
 if(-not $window){
  # Chrome's existing-process launch may leave a blank tab. Navigate only a
  # blank Chrome window through its own omnibox; never replace a user chat.
  $wins=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  for($i=0;$i -lt $wins.Count;$i++){
   $candidate=$wins.Item($i)
   if($candidate.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $candidate.Current.Name -match '^(新标签页|New Tab).*Google Chrome$'){
    [BridgeDesktop]::ShowWindow([IntPtr]$candidate.Current.NativeWindowHandle,9)|Out-Null
    [BridgeDesktop]::SetForegroundWindow([IntPtr]$candidate.Current.NativeWindowHandle)|Out-Null
    Start-Sleep -Milliseconds 700
    $address=FindControl $candidate '(地址和搜索栏|網址列|Address and search bar)' 'ControlType.Edit'
    if($address){[BridgeDesktop]::SetForegroundWindow([IntPtr]$candidate.Current.NativeWindowHandle)|Out-Null;$address.SetFocus();$value=$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$value.SetValue($url);[System.Windows.Forms.SendKeys]::SendWait('{ENTER}');break}
   }
  }
  for($n=0;$n -lt 25 -and -not $window;$n++){Start-Sleep -Milliseconds 250;$window=ChromeWindow}
 }
 if(-not $window){
  $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  $info=@();$blank=@();for($i=0;$i -lt $windows.Count;$i++){$w=$windows.Item($i);try{if($w.Current.ClassName -eq 'Chrome_WidgetWin_1'){$info+=@{name=$w.Current.Name;class=$w.Current.ClassName;pid=$w.Current.ProcessId};if($blank.Count -eq 0 -and $w.Current.Name -match '^(新标签页|New Tab).*Google Chrome$'){$all=Descendants $w;for($j=0;$j -lt [Math]::Min($all.Count,100);$j++){$e=$all.Item($j);$blank+=@{name=$e.Current.Name;id=$e.Current.AutomationId;type=$e.Current.ControlType.ProgrammaticName;class=$e.Current.ClassName}}}}}catch{}}
  Report @{ok=$false;error='Extensions manager window not found';step=$Step;session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId;windows=$info;blankControls=$blank};exit 1
 }
 [BridgeDesktop]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle,9)|Out-Null
 [BridgeDesktop]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)|Out-Null
 Start-Sleep -Milliseconds 800
 if($Step -eq 'reload'){
  $before=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/local/status" -TimeoutSec 3
  if($before.sessions -or $before.pending){throw 'Bridge must be idle before its extension reload'}
  $button=ById $window 'reload';ClickControl $button
  $confirmed=$false
  for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 300;try{$s=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/local/status" -TimeoutSec 2;if($s.extensionConnected -and $s.extension.connectedAt -gt $before.extension.connectedAt){$confirmed=$true;break}}catch{}}
  Report @{ok=$confirmed;step='reload';extensionId=$expected;originalExecutorReloaded=$false};exit
 }
 if($Step -eq 'test-page'){
  $address=FindControl $window '(地址和搜索栏|網址列|Address and search bar)' 'ControlType.Edit'
  if(-not $address){throw 'Bridge options omnibox not available'}
  $address.SetFocus();$value=$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$value.SetValue('https://chatgpt.com/');[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Seconds 2
  Report @{ok=$true;step='test-page';reusedBridgeOptionsTab=$true;originalUserConversationNavigated=$false};exit
 }
 if($Step -eq 'inspect'){
  $items=Descendants $window;$controls=@()
  for($i=0;$i -lt $items.Count;$i++){
   $e=$items.Item($i)
   try {if($e.Current.ControlType.ProgrammaticName -in @('ControlType.Button','ControlType.CheckBox','ControlType.Edit')){$controls+=@{name=$e.Current.Name;id=$e.Current.AutomationId;type=$e.Current.ControlType.ProgrammaticName;enabled=$e.Current.IsEnabled}}}catch{}
   if($controls.Count -ge 90){break}
  }
  Report @{ok=$true;session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId;window=$window.Current.Name;controls=$controls};exit
 }
 if($Step -eq 'install'){
  $load=ById $window 'loadUnpacked'
  if(-not $load){
   $developer=FindControl $window '^(开发者模式|開發人員模式|Developer mode)$'
   if($developer){InvokeControl $developer;Start-Sleep -Milliseconds 500;$load=ById $window 'loadUnpacked'}
  }
  Progress 'load_button'
  ClickControl $load
  Progress 'folder_dialog'
  $dialog=$null
  for($n=0;$n -lt 30 -and -not $dialog;$n++){
   Start-Sleep -Milliseconds 200
   $child=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)))
   if($child -and $child.Current.Name -match '(选择|Select|Load|加载|載入)'){$dialog=$child;break}
   $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
   for($i=0;$i -lt $windows.Count;$i++){$w=$windows.Item($i);try{if($w.Current.ProcessId -eq $window.Current.ProcessId -and ($w.Current.ClassName -eq '#32770' -or $w.Current.Name -match '(选择.*(目录|文件夹)|Select.*(folder|directory)|Load unpacked|加载.*扩展|載入未封裝)')){$dialog=$w;break}}catch{}}
  }
  if(-not $dialog){
   $info=@();$wins=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
   for($i=0;$i -lt $wins.Count;$i++){$w=$wins.Item($i);if($w.Current.ClassName -in @('#32770','Chrome_WidgetWin_1')){$info+=@{name=$w.Current.Name;class=$w.Current.ClassName;pid=$w.Current.ProcessId}}}
   $children=$window.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition);$childInfo=@();for($k=0;$k -lt $children.Count;$k++){$e=$children.Item($k);$childInfo+=@{name=$e.Current.Name;type=$e.Current.ControlType.ProgrammaticName;class=$e.Current.ClassName}}
   Report @{ok=$false;error='Load-unpacked folder picker not found';windows=$info;buttonRectangle=[string]$load.Current.BoundingRectangle;children=$childInfo;focused=[System.Windows.Automation.AutomationElement]::FocusedElement.Current.Name};exit 1
  }
  Progress 'folder_found'
  $field=FindControl $dialog '(文件夹|資料夾|Folder|文件名|File name)' 'ControlType.Edit'
  if(-not $field){
   $items=Descendants $dialog
   for($i=$items.Count-1;$i -ge 0;$i--){$e=$items.Item($i);if($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit'){$field=$e;break}}
  }
  if(-not $field){throw 'Folder field not found'}
  $value=$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$value.SetValue($target)
  $accept=FindControl $dialog '^(选择文件夹|選取資料夾|Select Folder|选择|Select|打开|Open)$' 'ControlType.Button'
  Progress 'accept_folder'
  ClickControl $accept
  Progress 'verify_registered'
  Start-Sleep -Seconds 2
  # Read metadata only. Never edit Chrome preference databases.
  $prefs='C:\Users\Administrator\AppData\Local\Google\Chrome\User Data\Default\Secure Preferences'
  $registered=$false
  for($n=0;$n -lt 25 -and -not $registered;$n++){
   try{$p=Get-Content -LiteralPath $prefs -Raw -Encoding UTF8|ConvertFrom-Json;$entry=$p.extensions.settings.PSObject.Properties[$expected];$registered=($entry -and $entry.Value.path -eq $target)}catch{}
   if(-not $registered){Start-Sleep -Milliseconds 400}
  }
  Report @{ok=[bool]$registered;step='install';extensionId=$expected;path=$target;originalExecutorPreserved=$true};exit
 }
 if($Step -eq 'configure'){
  $keyFile=Join-Path $root 'var\stage\extension-auth.json'
  $key=(Get-Content -LiteralPath $keyFile -Raw|ConvertFrom-Json).token
  if($key -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'Private extension key unavailable'}
  $items=Descendants $window;$edits=@()
  for($i=0;$i -lt $items.Count;$i++){
   $e=$items.Item($i)
   if($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit' -and ($e.Current.AutomationId -in @('url','token') -or $e.Current.Name -match '(本机服务地址|扩展连接密钥)')){$edits+=$e}
  }
  if($edits.Count -ne 2){throw 'Bridge options fields not found'}
  foreach($e in $edits){
   $value=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
   if($e.Current.AutomationId -eq 'token' -or $e.Current.Name -match '密钥'){$value.SetValue($key)}else{$value.SetValue('ws://127.0.0.1:'+$Port+'/bridge')}
  }
  $save=FindControl $window '^保存并连接$' 'ControlType.Button';InvokeControl $save
  $connected=$false
  for($n=0;$n -lt 25;$n++){
   Start-Sleep -Milliseconds 300
   try{$s=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/local/status" -TimeoutSec 2;if($s.extensionConnected){$connected=$true;break}}catch{}
  }
  Report @{ok=$connected;step='configure';port=$Port;extensionId=$expected;credentialsLogged=$false};exit
 }
}catch{Report @{ok=$false;step=$Step;error=$_.Exception.Message;session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId};exit 1}
