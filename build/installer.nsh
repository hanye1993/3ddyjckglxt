!macro customInstall
  ; Silently install VC++ 2015-2022 x64 if not already present.
  IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 vcredist_done
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    IntCmp $0 1 vcredist_done 0 0
    DetailPrint "Installing Microsoft Visual C++ Redistributable..."
    ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $1
  vcredist_done:
!macroend
