$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'PC-Media-Remote.lnk'

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Removed startup shortcut: $shortcutPath" -ForegroundColor Yellow
} else {
  Write-Host "Startup shortcut not found."
}
