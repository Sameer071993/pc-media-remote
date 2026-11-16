$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'PC-Media-Remote.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'D:\PC-REMOTE-APP\start-remote.bat'
$shortcut.WorkingDirectory = 'D:\PC-REMOTE-APP'
$shortcut.Description = 'Auto-start PC Media Remote Server'
$shortcut.Save()

Write-Host "Startup shortcut created at: $shortcutPath" -ForegroundColor Green
