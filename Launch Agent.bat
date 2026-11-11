@echo off
setlocal enabledelayedexpansion
title Q-BRANCH AGENT HUB (007 License to Code)
color 0b

:: Initialize ANSI VT100 Escape Sequence for true terminal color
for /f "delims=" %%a in ('powershell -NoProfile -Command "[char]27"') do set "ESC=%%a"

:: Define ANSI color presets
set "C_RESET=%ESC%[0m"
set "C_BOLD=%ESC%[1m"
set "C_CYAN=%ESC%[1;36m"
set "C_GOLD=%ESC%[1;33m"
set "C_GREEN=%ESC%[1;32m"
set "C_RED=%ESC%[1;31m"
set "C_MAGENTA=%ESC%[1;35m"
set "C_WHITE=%ESC%[1;37m"
set "C_GRAY=%ESC%[90m"

:: ----------------------------------------------------------------------------
:: 1. Drag-and-Drop & Target Folder/File Handling
:: ----------------------------------------------------------------------------
set "TARGET_FILE="
set "IS_CMD_ARG=0"

if /i "%~1"=="claude" set "IS_CMD_ARG=1"
if /i "%~1"=="claude-yolo" set "IS_CMD_ARG=1"
if /i "%~1"=="hermes" set "IS_CMD_ARG=1"
if /i "%~1"=="hermes-tui" set "IS_CMD_ARG=1"
if /i "%~1"=="hermes-deepseek" set "IS_CMD_ARG=1"
if /i "%~1"=="hermes-yolo" set "IS_CMD_ARG=1"
if /i "%~1"=="setup" set "IS_CMD_ARG=1"
if /i "%~1"=="install" set "IS_CMD_ARG=1"
if /i "%~1"=="usb" set "IS_CMD_ARG=1"
if /i "%~1"=="update-usb" set "IS_CMD_ARG=1"
if /i "%~1"=="profiles" set "IS_CMD_ARG=1"
if /i "%~1"=="loadouts" set "IS_CMD_ARG=1"
if /i "%~1"=="models" set "IS_CMD_ARG=1"
if /i "%~1"=="skills" set "IS_CMD_ARG=1"
if /i "%~1"=="settings" set "IS_CMD_ARG=1"
if /i "%~1"=="browse" set "IS_CMD_ARG=1"
if /i "%~1"=="pick" set "IS_CMD_ARG=1"

:: If a file or folder was dragged onto this batch file
if "!IS_CMD_ARG!"=="0" (
    if not "%~1"=="" (
        if exist "%~1\" cd /d "%~1"
        if not exist "%~1\" if exist "%~1" (
            cd /d "%~dp1"
            set "TARGET_FILE=%~nx1"
        )
    )
)

:: If current directory was not set by drag-and-drop, default to script folder
if not defined TARGET_FILE (
    if "%~1"=="" cd /d "%~dp0"
)

:: ----------------------------------------------------------------------------
:: 2. Smart USB & Environment Detection
:: ----------------------------------------------------------------------------
set "USB_ROOT="
set "IS_PORTABLE=0"
set "IS_DIRECT_USB=0"
set "IS_LINKED_USB=0"

:: Check A: Running directly from the USB drive
if exist "%~dp0runtime\node\node.exe" (
    set "USB_ROOT=%~dp0"
    set "IS_PORTABLE=1"
    set "IS_DIRECT_USB=1"
)
if exist "%~dp0..\runtime\node\node.exe" if not defined USB_ROOT (
    set "USB_ROOT=%~dp0..\"
    set "IS_PORTABLE=1"
    set "IS_DIRECT_USB=1"
)

:: Check B: Detect plugged-in USB drive (D: through Z:)
set "FOUND_USB="
for %%d in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
    if not defined FOUND_USB (
        if exist "%%d:\runtime\node\node.exe" set "FOUND_USB=%%d:\"
        if exist "%%d:\Q-Branch-Portable\runtime\node\node.exe" set "FOUND_USB=%%d:\Q-Branch-Portable\"
        if exist "%%d:\007-Q-Branch\runtime\node\node.exe" set "FOUND_USB=%%d:\007-Q-Branch\"
    )
)

:: If running on Host PC (not directly on USB):
if "!IS_DIRECT_USB!"=="0" (
    :: Check if host PC has working tools installed
    set "HOST_HAS_TOOLS=0"
    where claude >nul 2>nul
    if !ERRORLEVEL! EQU 0 set "HOST_HAS_TOOLS=1"
    where node >nul 2>nul
    if !ERRORLEVEL! EQU 0 set "HOST_HAS_TOOLS=1"

    :: On a foreign PC with NO tools installed: link to USB runtime automatically
    if "!HOST_HAS_TOOLS!"=="0" if defined FOUND_USB (
        set "USB_ROOT=!FOUND_USB!"
        set "IS_PORTABLE=1"
        set "IS_LINKED_USB=1"
    )
    :: On Adrian's PC with native tools: keep Host Mode as primary, link USB for syncing
    if "!HOST_HAS_TOOLS!"=="1" if defined FOUND_USB (
        set "USB_ROOT=!FOUND_USB!"
        set "IS_LINKED_USB=1"
    )
)

:: Configure Environment
if "!IS_PORTABLE!"=="1" (
    set "PORTABLE_NODE=!USB_ROOT!runtime\node"
    set "PORTABLE_HERMES=!USB_ROOT!runtime\hermes"
    set "PATH=!PORTABLE_NODE!;!PORTABLE_HERMES!;%SystemRoot%\system32;%SystemRoot%;%PATH%"
    set "USERPROFILE=!USB_ROOT!data\home"
    set "HOME=!USB_ROOT!data\home"
    if not exist "!USERPROFILE!\Desktop" mkdir "!USERPROFILE!\Desktop" >nul 2>nul
    if not exist "!USERPROFILE!\Documents" mkdir "!USERPROFILE!\Documents" >nul 2>nul
    if not exist "!USERPROFILE!\Downloads" mkdir "!USERPROFILE!\Downloads" >nul 2>nul
    set "CLAUDE_CONFIG_DIR=!USB_ROOT!config\claude"
    set "HERMES_HOME=!USB_ROOT!config\hermes"
    set "ANTHROPIC_BASE_URL=https://api.experientiallabs.ai"
    set "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1"
    set "CLAUDE_CODE_AUTO_MODE_SERVER=0"
    set "QBRANCH_SCRIPT=!USB_ROOT!qbranch.mjs"
) else (
    set "PATH=%SystemRoot%\system32;%SystemRoot%;C:\Program Files\nodejs;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"
    if exist "%~dp0qbranch.mjs" (
        set "QBRANCH_SCRIPT=%~dp0qbranch.mjs"
    ) else if defined USB_ROOT (
        set "QBRANCH_SCRIPT=!USB_ROOT!qbranch.mjs"
    ) else (
        set "QBRANCH_SCRIPT=%USERPROFILE%\.claude\qbranch.mjs"
    )
)

:: ----------------------------------------------------------------------------
:: 3. Command-Line Argument Dispatching
:: ----------------------------------------------------------------------------
if /i "%~1"=="claude" goto :run_claude
if /i "%~1"=="claude-yolo" goto :run_claude_yolo
if /i "%~1"=="hermes" goto :run_hermes_luna
if /i "%~1"=="hermes-tui" goto :run_hermes_tui
if /i "%~1"=="hermes-deepseek" goto :run_hermes_deepseek
if /i "%~1"=="hermes-yolo" goto :run_hermes_yolo
if /i "%~1"=="setup" goto :run_setup
if /i "%~1"=="install" goto :run_setup
if /i "%~1"=="usb" goto :run_usb
if /i "%~1"=="update-usb" goto :run_usb
if /i "%~1"=="profiles" goto :run_profiles
if /i "%~1"=="loadouts" goto :run_profiles
if /i "%~1"=="models" goto :run_models
if /i "%~1"=="skills" goto :run_skills
if /i "%~1"=="settings" goto :run_settings
if /i "%~1"=="browse" goto :pick_target
if /i "%~1"=="pick" goto :pick_target

:menu
cls
echo %C_CYAN%==============================================================================%C_RESET%
echo %C_GOLD%      ___   ___  _____     ___        ___   ___    _   _  _  ___  _  _  %C_RESET%
echo %C_GOLD%     / _ \ / _ \^|___  ^|   / _ \      ^| _ ) ^| _ \  /_\ ^| \^| ^|/ __^|^| ^|^| ^| %C_RESET%
echo %C_GOLD%    ^| (_) ^| (_) ^|  / /   ^| (_) ^| --- ^| _ \ ^|   / / _ \^| .` ^| (__ ^| __ ^| %C_RESET%
echo %C_GOLD%     \___/ \___/  /_/     \__\_^|     ^|___/ ^|_^|_\/_/ \_\_^|\_\___^|^|_^|^|_^| %C_RESET%
echo %C_MAGENTA%                 AI AGENT COMMAND CENTER ^| LICENSE TO CODE               %C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
echo  %C_GRAY%OPERATIONAL FOLDER :%C_RESET% %C_WHITE%!CD!%C_RESET%
if not "!TARGET_FILE!"=="" echo  %C_GRAY%TARGET FILE        :%C_RESET% %C_GOLD%!TARGET_FILE!%C_RESET%
if "!IS_DIRECT_USB!"=="1" echo  %C_GRAY%DEPLOYMENT MODE    :%C_RESET% %C_GREEN%[STANDALONE PORTABLE USB: !USB_ROOT!]%C_RESET%
if "!IS_DIRECT_USB!"=="1" echo  %C_GRAY%PRIVACY ISOLATION  :%C_RESET% %C_CYAN%100%% ISOLATED [Keys, history and cache stay on USB drive]%C_RESET%
if "!IS_PORTABLE!"=="1" if "!IS_DIRECT_USB!"=="0" echo  %C_GRAY%DEPLOYMENT MODE    :%C_RESET% %C_GREEN%[HOST LINKED TO PORTABLE USB: !USB_ROOT!]%C_RESET%
if "!IS_PORTABLE!"=="0"   echo  %C_GRAY%DEPLOYMENT MODE    :%C_RESET% %C_GREEN%[LOCAL HOST ENVIRONMENT (KALI WSL + HOST TOOLS)]%C_RESET%
if "!IS_PORTABLE!"=="0" if defined USB_ROOT echo  %C_GRAY%USB SUITE ATTACHED :%C_RESET% %C_GOLD%!USB_ROOT! [Ready for sync or backup]%C_RESET%
echo  %C_GRAY%GATEWAY            :%C_RESET% %C_CYAN%Experiential Labs (Promotional Free Tier: $0)%C_RESET%
echo  %C_GRAY%ACTIVE COMBINATION :%C_RESET% %C_GOLD%GPT-6 Luna%C_RESET% %C_GREEN%[FREE]%C_RESET% + %C_CYAN%DeepSeek Flash 1017%C_RESET% %C_GREEN%[FREE]%C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
echo.
echo   %C_GREEN%[1]%C_RESET% %C_WHITE%Claude Code%C_RESET%        %C_GRAY%- Tag-Team: GPT-6 Luna + DeepSeek Flash 1017%C_RESET%
echo   %C_GREEN%[2]%C_RESET% %C_WHITE%Hermes Agent%C_RESET%       %C_GRAY%- Autonomous Agent (GPT-6 Luna)%C_RESET%
echo   %C_GREEN%[3]%C_RESET% %C_WHITE%Hermes Agent (TUI)%C_RESET% %C_GRAY%- Full Visual Dashboard Interface%C_RESET%
echo   %C_GREEN%[4]%C_RESET% %C_WHITE%Hermes Agent%C_RESET%       %C_GRAY%- Rapid Flash Mode (DeepSeek V4.1 Flash 1017)%C_RESET%
echo.
echo   %C_GOLD%[5]%C_RESET% %C_WHITE%Claude Code (YOLO)%C_RESET% %C_GRAY%- Bypass Permission Prompts%C_RESET%
echo   %C_GOLD%[6]%C_RESET% %C_WHITE%Hermes Agent (YOLO)%C_RESET%%C_GRAY%- Auto-Approve Command Execution%C_RESET%
echo.
echo  %C_CYAN%--- Q-BRANCH ARSENAL ^& NAVIGATION ---%C_RESET%
echo   %C_CYAN%[W]%C_RESET% %C_WHITE%Select Target Folder/File%C_RESET% %C_GRAY%- Native Windows GUI Picker (or manual path)%C_RESET%
if "!IS_PORTABLE!"=="1" echo   %C_GOLD%[U]%C_RESET% %C_WHITE%Update Portable Suite%C_RESET%   %C_GRAY%- In-place update of Claude, Hermes ^& Skills on USB%C_RESET%
if "!IS_PORTABLE!"=="0" echo   %C_CYAN%[I]%C_RESET% %C_WHITE%First-Time Agent Setup%C_RESET%   %C_GRAY%- Check/Install Claude, Hermes, API Key ^& Skills%C_RESET%
if "!IS_PORTABLE!"=="0" echo   %C_GOLD%[U]%C_RESET% %C_WHITE%Portable USB Drive Builder%C_RESET%%C_GRAY%- Clone standalone agent suite, skills ^& keys to USB%C_RESET%
echo   %C_MAGENTA%[P]%C_RESET% %C_WHITE%Mission Loadouts (Profiles)%C_RESET%%C_GRAY%- 1-Click Strike Team Swap (Special Ops / Restore)%C_RESET%
echo   %C_MAGENTA%[K]%C_RESET% %C_WHITE%Skills Arsenal%C_RESET%            %C_GRAY%- Browse packs, search ^& deploy to project/globally%C_RESET%
echo   %C_MAGENTA%[M]%C_RESET% %C_WHITE%Online Model Browser%C_RESET%       %C_GRAY%- Browse live gateway models, check Free tier ^& switch%C_RESET%
echo   %C_MAGENTA%[S]%C_RESET% %C_WHITE%Gateway Settings%C_RESET%           %C_GRAY%- View/Update API Key and Gateway URL%C_RESET%
echo.
echo   %C_RED%[Q]%C_RESET% %C_WHITE%Q-Branch Signoff%C_RESET%           %C_GRAY%- Return to Base (Exit)%C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
set /p choice="%C_BOLD%Select an operation [1-6, W, I, U, P, K, M, S, Q] (Default is 1): %C_RESET%"

if "%choice%"=="" set choice=1
if /i "%choice%"=="q" goto :exit_007
if "%choice%"=="1" goto :run_claude
if "%choice%"=="2" goto :run_hermes_luna
if "%choice%"=="3" goto :run_hermes_tui
if "%choice%"=="4" goto :run_hermes_deepseek
if "%choice%"=="5" goto :run_claude_yolo
if "%choice%"=="6" goto :run_hermes_yolo
if /i "%choice%"=="w" goto :pick_target
if /i "%choice%"=="i" goto :run_setup
if /i "%choice%"=="u" goto :run_usb
if /i "%choice%"=="p" goto :run_profiles
if /i "%choice%"=="k" goto :run_skills
if /i "%choice%"=="m" goto :run_models
if /i "%choice%"=="s" goto :run_settings

echo %C_RED%Invalid option, please choose from the mission menu.%C_RESET%
%SystemRoot%\system32\timeout.exe /t 2 >nul
goto :menu

:: ----------------------------------------------------------------------------
:: Target Folder / File Navigation Subroutine
:: ----------------------------------------------------------------------------
:pick_target
cls
echo %C_CYAN%==============================================================================%C_RESET%
echo %C_GOLD%               007 Q-BRANCH : TARGET SELECTION & NAVIGATION                   %C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
echo  Current Operational Folder: %C_WHITE%!CD!%C_RESET%
if not "!TARGET_FILE!"=="" echo  Current Target File      : %C_GOLD%!TARGET_FILE!%C_RESET%
echo.
echo   %C_GREEN%[1]%C_RESET% %C_WHITE%Browse for Folder%C_RESET%        %C_GRAY%- Native Windows Folder Picker Dialog (GUI)%C_RESET%
echo   %C_GREEN%[2]%C_RESET% %C_WHITE%Browse for File%C_RESET%          %C_GRAY%- Native Windows File Picker Dialog (GUI)%C_RESET%
echo   %C_GREEN%[3]%C_RESET% %C_WHITE%Type or Paste Path%C_RESET%       %C_GRAY%- Manually enter directory or file path%C_RESET%
echo   %C_GOLD%[4]%C_RESET% %C_WHITE%Current Desktop%C_RESET%          %C_GRAY%- Switch working directory to Desktop%C_RESET%
if "!IS_PORTABLE!"=="1" echo   %C_GOLD%[5]%C_RESET% %C_WHITE%USB Sandbox Workspace%C_RESET%   %C_GRAY%- Switch to !USB_ROOT!data\sessions%C_RESET%
echo   %C_RED%[0]%C_RESET% %C_WHITE%Return to Main Menu%C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
set /p pchoice="%C_BOLD%Select action [1-5, 0]: %C_RESET%"

if "%pchoice%"=="1" goto :gui_pick_folder
if "%pchoice%"=="2" goto :gui_pick_file
if "%pchoice%"=="3" goto :manual_pick_path
if "%pchoice%"=="4" (
    cd /d "%USERPROFILE%\Desktop"
    set "TARGET_FILE="
    goto :menu
)
if "%pchoice%"=="5" (
    if exist "!USB_ROOT!data\sessions" (
        cd /d "!USB_ROOT!data\sessions"
        set "TARGET_FILE="
    )
    goto :menu
)
goto :menu

:gui_pick_folder
echo.
echo %C_CYAN%[*] Opening Windows Folder Browser Dialog...%C_RESET%
for /f "usebackq delims=" %%f in (`powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '007 Q-Branch: Select Operational Folder for AI Agents'; $f.SelectedPath = (Get-Location).Path; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`) do (
    if exist "%%f" (
        cd /d "%%f"
        set "TARGET_FILE="
        echo %C_GREEN%[+] Operational folder set to: %%f%C_RESET%
        %SystemRoot%\system32\timeout.exe /t 1 >nul
    )
)
goto :menu

:gui_pick_file
echo.
echo %C_CYAN%[*] Opening Windows File Picker Dialog...%C_RESET%
for /f "usebackq delims=" %%f in (`powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = '007 Q-Branch: Select Target File'; $f.InitialDirectory = (Get-Location).Path; $f.RestoreDirectory = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.FileName }"`) do (
    if exist "%%f" (
        cd /d "%%~dpf"
        set "TARGET_FILE=%%~nxf"
        echo %C_GREEN%[+] Operational folder set to: %%~dpf%C_RESET%
        echo %C_GOLD%[+] Target file locked: %%~nxf%C_RESET%
        %SystemRoot%\system32\timeout.exe /t 1 >nul
    )
)
goto :menu

:manual_pick_path
echo.
set /p mpath="Enter folder or file path: "
set "mpath=!mpath:"=!"
if exist "!mpath!\" (
    cd /d "!mpath!"
    set "TARGET_FILE="
    echo %C_GREEN%[+] Operational folder set to: !mpath!%C_RESET%
    %SystemRoot%\system32\timeout.exe /t 1 >nul
    goto :menu
)
if exist "!mpath!" (
    for %%i in ("!mpath!") do (
        cd /d "%%~dpi"
        set "TARGET_FILE=%%~nxi"
        echo %C_GREEN%[+] Operational folder set to: %%~dpi%C_RESET%
        echo %C_GOLD%[+] Target file locked: %%~nxi%C_RESET%
        %SystemRoot%\system32\timeout.exe /t 1 >nul
    )
    goto :menu
)
echo %C_RED%Path does not exist.%C_RESET%
%SystemRoot%\system32\timeout.exe /t 2 >nul
goto :menu

:: ----------------------------------------------------------------------------
:: Agent Execution Routines
:: ----------------------------------------------------------------------------
:run_claude
set "CLAUDE_FLAGS="
goto :exec_claude

:run_claude_yolo
set "CLAUDE_FLAGS=--dangerously-skip-permissions"
goto :exec_claude

:exec_claude
echo.
echo %C_GREEN%[*] Launching Claude Code in %CD%...%C_RESET%
if not "!TARGET_FILE!"=="" echo %C_GOLD%[*] Targeting: !TARGET_FILE!%C_RESET%

:: Priority 1 (Portable Standalone): Run portable Claude on USB
if "!IS_PORTABLE!"=="1" (
    if exist "%PORTABLE_NODE%\node_modules\@anthropic-ai\claude-code\cli-wrapper.cjs" (
        node "%PORTABLE_NODE%\node_modules\@anthropic-ai\claude-code\cli-wrapper.cjs" %CLAUDE_FLAGS% !TARGET_FILE!
        goto :session_ended
    )
    if exist "%PORTABLE_NODE%\claude.cmd" (
        call "%PORTABLE_NODE%\claude.cmd" %CLAUDE_FLAGS% !TARGET_FILE!
        goto :session_ended
    )
)

:: Priority 2 (Host PC): Run host native claude
where claude >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    claude %CLAUDE_FLAGS% !TARGET_FILE!
    goto :session_ended
)

:: Priority 3: Fall back to npx
npx @anthropic-ai/claude-code %CLAUDE_FLAGS% !TARGET_FILE!
goto :session_ended


:run_hermes_luna
set "HERMES_ARGS=-m gpt-6-luna"
goto :exec_hermes

:run_hermes_tui
set "HERMES_ARGS=--tui -m gpt-6-luna"
goto :exec_hermes

:run_hermes_deepseek
set "HERMES_ARGS=-m deepseek-v4.1-flash-1017"
goto :exec_hermes

:run_hermes_yolo
set "HERMES_ARGS=--yolo"
goto :exec_hermes

:exec_hermes
echo.
echo %C_GREEN%[*] Launching Hermes Agent (%HERMES_ARGS%) in %CD%...%C_RESET%

:: Priority 1: WSL Kali Linux (where the full 63-plugin Nous Research Hermes lives)
wsl.exe -d kali-linux -u Ade test -f /home/Ade/.local/bin/hermes >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    wsl.exe -d kali-linux -u Ade --cd "%CD%" bash -lic "hermes %HERMES_ARGS%"
    goto :session_ended
)

:: Priority 2: Default WSL Distro
where wsl.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    wsl.exe test -f /home/Ade/.local/bin/hermes >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        wsl.exe -u Ade --cd "%CD%" bash -lic "hermes %HERMES_ARGS%"
        goto :session_ended
    )
)

:: Priority 3: Native Windows Hermes (if installed)
where hermes >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    hermes %HERMES_ARGS%
    goto :session_ended
)

echo.
echo %C_RED%[!] Hermes Agent could not be located in WSL (kali-linux) or on Windows.%C_RESET%
echo %C_GRAY%Please ensure Hermes is installed in WSL (kali-linux) or run Setup [I].%C_RESET%
goto :session_ended


:run_setup
echo.
node "%QBRANCH_SCRIPT%" setup
goto :menu

:run_usb
echo.
if "!IS_PORTABLE!"=="1" (
    node "%QBRANCH_SCRIPT%" update-usb
) else (
    node "%QBRANCH_SCRIPT%" usb
)
%SystemRoot%\system32\pause.exe
goto :menu

:run_profiles
echo.
node "%QBRANCH_SCRIPT%" profiles
goto :menu

:run_skills
echo.
node "%QBRANCH_SCRIPT%" skills
goto :menu

:run_models
echo.
node "%QBRANCH_SCRIPT%" models
%SystemRoot%\system32\pause.exe
goto :menu

:run_settings
echo.
node "%QBRANCH_SCRIPT%" config
%SystemRoot%\system32\pause.exe
goto :menu

:session_ended
echo.
echo %C_CYAN%==============================================================================%C_RESET%
echo %C_GOLD%Mission session concluded. Press any key to return to Q-Branch or close window.%C_RESET%
%SystemRoot%\system32\pause.exe >nul
goto :menu

:exit_007
echo.
echo %C_CYAN%Q-Branch: Mission completed. Safe travels, 007.%C_RESET%
%SystemRoot%\system32\timeout.exe /t 1 >nul
exit /b 0
