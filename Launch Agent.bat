@echo off
setlocal enabledelayedexpansion
title Q-BRANCH AGENT HUB (007 License to Code)
color 0b

:: Always switch to the directory where this .bat is placed
cd /d "%~dp0"

:: Ensure Windows System32 is first in PATH, then Node, then Git
set "PATH=%SystemRoot%\system32;%SystemRoot%;C:\Program Files\nodejs;C:\Program Files\Git\cmd;%PATH%"

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

:: Path to Q-Branch helper script (detect local script if cloned from GitHub)
if exist "%~dp0qbranch.mjs" (
    set "QBRANCH_SCRIPT=%~dp0qbranch.mjs"
) else (
    set "QBRANCH_SCRIPT=%USERPROFILE%\.claude\qbranch.mjs"
)

:: Support direct command-line arguments: e.g. "Launch Agent.bat claude"
if /i "%~1"=="claude" goto :run_claude
if /i "%~1"=="claude-yolo" goto :run_claude_yolo
if /i "%~1"=="hermes" goto :run_hermes_luna
if /i "%~1"=="hermes-tui" goto :run_hermes_tui
if /i "%~1"=="hermes-deepseek" goto :run_hermes_deepseek
if /i "%~1"=="hermes-yolo" goto :run_hermes_yolo
if /i "%~1"=="setup" goto :run_setup
if /i "%~1"=="install" goto :run_setup
if /i "%~1"=="profiles" goto :run_profiles
if /i "%~1"=="loadouts" goto :run_profiles
if /i "%~1"=="models" goto :run_models
if /i "%~1"=="skills" goto :run_skills
if /i "%~1"=="settings" goto :run_settings

:menu
cls
echo %C_CYAN%==============================================================================%C_RESET%
echo %C_GOLD%      ___   ___  _____     ___        ___   ___    _   _  _  ___  _  _  %C_RESET%
echo %C_GOLD%     / _ \ / _ \^|___  ^|   / _ \      ^| _ ) ^| _ \  /_\ ^| \^| ^|/ __^|^| ^|^| ^| %C_RESET%
echo %C_GOLD%    ^| (_) ^| (_) ^|  / /   ^| (_) ^| --- ^| _ \ ^|   / / _ \^| .` ^| (__ ^| __ ^| %C_RESET%
echo %C_GOLD%     \___/ \___/  /_/     \__\_^|     ^|___/ ^|_^|_\/_/ \_\_^|\_\___^|^|_^|^|_^| %C_RESET%
echo %C_MAGENTA%                 AI AGENT COMMAND CENTER ^| LICENSE TO CODE               %C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
echo  %C_GRAY%OPERATIONAL FOLDER :%C_RESET% %C_WHITE%%CD%%C_RESET%
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
echo  %C_CYAN%--- Q-BRANCH ARSENAL ^& INTELLIGENCE ---%C_RESET%
echo   %C_CYAN%[I]%C_RESET% %C_WHITE%First-Time Agent Setup%C_RESET%   %C_GRAY%- Check/Install Claude, Hermes, API Key ^& Skills%C_RESET%
echo   %C_MAGENTA%[P]%C_RESET% %C_WHITE%Mission Loadouts (Profiles)%C_RESET%%C_GRAY%- 1-Click Strike Team Swap (Special Ops / Restore)%C_RESET%
echo   %C_MAGENTA%[K]%C_RESET% %C_WHITE%Skills Arsenal%C_RESET%            %C_GRAY%- Browse packs, search ^& deploy to project/globally%C_RESET%
echo   %C_MAGENTA%[M]%C_RESET% %C_WHITE%Online Model Browser%C_RESET%       %C_GRAY%- Browse live gateway models, check Free tier ^& switch%C_RESET%
echo   %C_MAGENTA%[S]%C_RESET% %C_WHITE%Gateway Settings%C_RESET%           %C_GRAY%- View/Update API Key and Gateway URL%C_RESET%
echo.
echo   %C_RED%[Q]%C_RESET% %C_WHITE%Q-Branch Signoff%C_RESET%           %C_GRAY%- Return to Base (Exit)%C_RESET%
echo %C_CYAN%==============================================================================%C_RESET%
set /p choice="%C_BOLD%Select an operation [1-6, I, P, K, M, S, Q] (Default is 1): %C_RESET%"

if "%choice%"=="" set choice=1
if /i "%choice%"=="q" goto :exit_007
if "%choice%"=="1" goto :run_claude
if "%choice%"=="2" goto :run_hermes_luna
if "%choice%"=="3" goto :run_hermes_tui
if "%choice%"=="4" goto :run_hermes_deepseek
if "%choice%"=="5" goto :run_claude_yolo
if "%choice%"=="6" goto :run_hermes_yolo
if /i "%choice%"=="i" goto :run_setup
if /i "%choice%"=="p" goto :run_profiles
if /i "%choice%"=="k" goto :run_skills
if /i "%choice%"=="m" goto :run_models
if /i "%choice%"=="s" goto :run_settings

echo %C_RED%Invalid option, please choose from the mission menu.%C_RESET%
%SystemRoot%\system32\timeout.exe /t 2 >nul
goto :menu

:run_claude
echo.
echo %C_GREEN%[*] Launching Claude Code in %CD%...%C_RESET%
where claude >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    claude
) else (
    npx @anthropic-ai/claude-code
)
goto :session_ended

:run_claude_yolo
echo.
echo %C_GOLD%[*] Launching Claude Code (YOLO mode - skipping permission gates)...%C_RESET%
where claude >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    claude --dangerously-skip-permissions
) else (
    npx @anthropic-ai/claude-code --dangerously-skip-permissions
)
goto :session_ended

:run_hermes_luna
echo.
echo %C_GREEN%[*] Launching Hermes Agent (GPT-6 Luna) in %CD%...%C_RESET%
wsl -d kali-linux --cd "%CD%" -u Ade bash -lic "hermes -m gpt-6-luna"
goto :session_ended

:run_hermes_tui
echo.
echo %C_GREEN%[*] Launching Hermes Agent in Modern Visual TUI mode...%C_RESET%
wsl -d kali-linux --cd "%CD%" -u Ade bash -lic "hermes --tui -m gpt-6-luna"
goto :session_ended

:run_hermes_deepseek
echo.
echo %C_GREEN%[*] Launching Hermes Agent (DeepSeek V4.1 Flash 1017) in %CD%...%C_RESET%
wsl -d kali-linux --cd "%CD%" -u Ade bash -lic "hermes -m deepseek-v4.1-flash-1017"
goto :session_ended

:run_hermes_yolo
echo.
echo %C_GOLD%[*] Launching Hermes Agent (YOLO mode - auto-approving tool actions)...%C_RESET%
wsl -d kali-linux --cd "%CD%" -u Ade bash -lic "hermes --yolo"
goto :session_ended

:run_setup
echo.
node "%QBRANCH_SCRIPT%" setup
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
