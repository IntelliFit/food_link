@echo off
REM 启动 Android 模拟器并运行 App 开发版
REM 用法：双击运行，或在 CMD/PowerShell 中执行 scripts\start-mobile-android-emulator.bat

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "JAVA_HOME=%PROJECT_ROOT%\tools\jdk-17.0.19+10"
set "ANDROID_HOME=%PROJECT_ROOT%\tools\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\emulator;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"

echo JAVA_HOME: %JAVA_HOME%
echo ANDROID_HOME: %ANDROID_HOME%

cd /d "%PROJECT_ROOT%\apps\mobile"
npx expo run:android
