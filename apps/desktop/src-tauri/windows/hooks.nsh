!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering Yanyi Native Messaging Host for Edge and Chrome"
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --register-native-host'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Yanyi Native Messaging Host registration failed (exit code $0)."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Yanyi Native Messaging Host registrations"
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-native-host'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Yanyi Native Messaging Host cleanup failed (exit code $0)."
    Abort
  ${EndIf}
!macroend
