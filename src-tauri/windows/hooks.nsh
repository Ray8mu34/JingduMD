!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\JingReader" "" "使用静读 Markdown 打开"
  WriteRegStr HKCU "Software\Classes\Directory\shell\JingReader" "Icon" '"$INSTDIR\JingReader.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\JingReader\command" "" '"$INSTDIR\JingReader.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\JingReader" "" "使用静读 Markdown 打开"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\JingReader" "Icon" '"$INSTDIR\JingReader.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\JingReader\command" "" '"$INSTDIR\JingReader.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\JingReader" "" "使用静读 Markdown 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\JingReader" "Icon" '"$INSTDIR\JingReader.exe"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\JingReader\command" "" '"$INSTDIR\JingReader.exe" "%1"'
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\JingReader"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\JingReader"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.md\shell\JingReader"
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
