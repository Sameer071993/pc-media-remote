!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PC Media Remote"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PC Media Remote" dir=in action=allow program="$INSTDIR\PC Media Remote.exe" profile=private enable=yes'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PC Media Remote"'
!macroend
