; ==============================================================================
; Straditize Pro - Modern NSIS Windows Installer Script
; ==============================================================================

Unicode True
!include "MUI2.nsh"
!include "FileFunc.nsh"

; --- Application Information ---
!define PRODUCT_NAME "Straditize Pro"
!define PRODUCT_VERSION "2.0.0"
!define PRODUCT_PUBLISHER "chmzs"
!define PRODUCT_WEB_SITE "https://github.com/chmzs/straditize-pro"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\straditize.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKCU"

; Per-user installation (no admin elevation required, works on any computer)
RequestExecutionLevel user

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\dist\Straditize-Pro-v${PRODUCT_VERSION}-Windows-x64-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Straditize Pro"
InstallDirRegKey HKCU "${PRODUCT_DIR_REGKEY}" ""
ShowInstDetails show
ShowUnInstDetails show

; --- Interface Settings ---
!define MUI_ABORTWARNING
!define MUI_ICON "..\docs\assets\logos\straditize.ico"
!define MUI_UNICON "..\docs\assets\logos\straditize.ico"

; --- Pages ---
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; Finish page with launch option
!define MUI_FINISHPAGE_RUN "$INSTDIR\straditize.exe"
!define MUI_FINISHPAGE_RUN_TEXT "运行 Straditize Pro (启动现代版地层解译系统)"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; --- Languages ---
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; --- Installer Section ---
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite try

  ; Copy all files from dist\straditize
  File /r "..\dist\straditize\*.*"
  File "..\docs\assets\logos\straditize.ico"

  ; Create Start Menu Shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\straditize.exe" "" "$INSTDIR\straditize.ico" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\uninstall.exe"

  ; Create Desktop Shortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\straditize.exe" "" "$INSTDIR\straditize.ico" 0

  ; Create Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Register in Windows Add/Remove Programs
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\straditize.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\straditize.ico"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"

  ; Estimate installed size for Add/Remove Programs
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

; --- Uninstaller Section ---
Section "Uninstall"
  ; Remove Desktop Shortcut
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; Remove Start Menu Shortcuts
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove Application Directory
  RMDir /r "$INSTDIR"

  ; Clean Registry
  DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"

  SetAutoClose true
SectionEnd
