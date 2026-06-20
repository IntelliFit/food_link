#!/usr/bin/env bash
# 启动 Android 模拟器并运行 App 开发版
# 用法：在 Git Bash 中执行 bash scripts/start-mobile-android-emulator.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export JAVA_HOME="$PROJECT_ROOT/tools/jdk-17.0.19+10"
export ANDROID_HOME="$PROJECT_ROOT/tools/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

echo "JAVA_HOME: $JAVA_HOME"
echo "ANDROID_HOME: $ANDROID_HOME"

cd "$PROJECT_ROOT/apps/mobile"
npx expo run:android
