@echo off
REM Wrapper script to call PowerShell bootstrap-dps.ps1 from npm
REM This handles the full PowerShell path and parameter passing correctly

setlocal

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

REM Use full path to PowerShell
set "PS_EXE=%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe"

REM Check if PowerShell exists
if not exist "%PS_EXE%" (
    echo ERROR: PowerShell not found at %PS_EXE%
    exit /b 1
)

REM Call PowerShell script with all parameters
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%bootstrap-dps.ps1" %*

exit /b %ERRORLEVEL%

