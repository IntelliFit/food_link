# Mobile 开发与构建指南

本文档说明 `apps/mobile`（Expo / React Native）的日常调试、真机联调，以及 Android APK / iOS 安装包的构建方式。

当前技术栈：**Expo SDK 56**、**React 19**、**React Native 0.85**。项目采用 **Managed Workflow**（仓库内暂无 `android/`、`ios/` 原生目录，需要时通过 `expo prebuild` 生成）。

---

## 项目位置

| 路径 | 说明 |
|------|------|
| `apps/mobile/` | Mobile 应用源码 |
| `packages/core/` | 共享类型 |
| `packages/api-client/` | 共享 API 客户端 |
| `scripts/start-mobile-dev.cjs` | 局域网一键启动脚本 |
| `patches/expo+56.0.11.patch` | Expo HMR 兼容补丁（monorepo 必需） |

---

## 前置条件

1. 根目录已执行 `npm install`（会自动运行 `patch-package` 打补丁）。
2. 手机安装与项目 **SDK 版本一致** 的 [Expo Go](https://expo.dev/go)（当前为 **SDK 56**）。
3. 本地调试后端：`npm run dev:backend`（默认 `0.0.0.0:3010`）。
4. 构建安装包额外需要 [EAS CLI](https://docs.expo.dev/build/setup/) 或本地 Android Studio / Xcode 环境（见下文）。

---

## 日常开发调试

### 一键局域网启动（推荐）

在项目根目录：

```bash
# 终端 1：后端
npm run dev:backend

# 终端 2：Mobile（自动检测局域网 IP）
npm run dev:mobile
```

脚本 `scripts/start-mobile-dev.cjs` 会自动：

- 选择本机局域网 IPv4（跳过 Docker、Hyper-V、WSL 等虚拟网卡）
- 设置 `REACT_NATIVE_PACKAGER_HOSTNAME`（Expo 二维码地址）
- 设置 `EXPO_PUBLIC_API_BASE_URL`（App 请求后端的地址）
- 以 `--lan` 模式启动 Metro

启动后终端会打印类似：

```text
[mobile-dev] 已选择局域网 IP: 192.168.8.193
[mobile-dev] API 地址: http://192.168.8.193:3010
[mobile-dev] Expo 地址: exp://192.168.8.193:8081
```

手机与电脑需在同一局域网；用 Expo Go 扫终端二维码即可。

在 `apps/mobile` 目录内等价命令：

```bash
npm run start:lan
```

### 手动覆盖局域网 IP

自动检测选错网卡时：

```powershell
# PowerShell
$env:MOBILE_DEV_LAN_IP="192.168.8.193"; npm run dev:mobile
```

```bash
# Bash
MOBILE_DEV_LAN_IP=192.168.8.193 npm run dev:mobile
```

其他可选环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MOBILE_DEV_LAN_IP` | 自动检测 | 手动指定局域网 IP |
| `MOBILE_DEV_API_PORT` | `3010` | 后端端口 |
| `MOBILE_DEV_METRO_PORT` | `8081` | Metro 端口；被占用时脚本会先尝试结束旧 Metro，再自动换端口 |

脚本会显式传入 `--port`，避免 Expo 交互式换端口后脚本仍打印 8081 的地址不一致问题。

> Expo 终端里 `Web: http://localhost:xxxx` 仅供**电脑浏览器**调试，手机请扫二维码或打开 `exp://<局域网IP>:<端口>`。

### 其他开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev:mobile` | 根目录：局域网一键启动 |
| `npm --workspace apps/mobile run start` | 普通 Expo 启动（不自动设局域网 IP） |
| `npm --workspace apps/mobile run android` | 启动并尝试打开 Android 模拟器 |
| `npm --workspace apps/mobile run ios` | 启动并尝试打开 iOS 模拟器（仅 macOS） |
| `npm run typecheck:mobile` | TypeScript 类型检查 |
| `npm run release:mobile:android` | Android 单一发布入口。默认本地 Gradle 构建 APK 后上传 COS；`dev` 分支发布体验版并使用 `https://dev.api.healthymax.cn`；`main` 分支发布正式版并使用 `https://api.healthymax.cn`；其它分支拒绝执行。 |

### Expo 终端快捷键

| 按键 | 作用 |
|------|------|
| `r` | 重新加载 JS |
| `m` | 打开开发菜单 |
| `j` | 打开调试器 |
| `?` | 显示全部快捷键 |

---

## API 地址配置

Mobile 端 API 解析顺序（见 `apps/mobile/src/config.ts`）：

1. 构建/启动时注入的 `EXPO_PUBLIC_API_BASE_URL`
2. `app.json` → `expo.extra.apiBaseUrl`（默认 `http://127.0.0.1:3010`）
3. 兜底 `http://127.0.0.1:3010`

| 场景 | 推荐配置 |
|------|----------|
| 本机 Expo Go 联调 | 由 `npm run dev:mobile` 自动设为 `http://<局域网IP>:3010` |
| 独立安装包连开发 API | 构建时设 `EXPO_PUBLIC_API_BASE_URL=https://dev.api.healthymax.cn` |
| 正式包 | 构建时设 `EXPO_PUBLIC_API_BASE_URL=https://api.healthymax.cn` |

Android 发布统一使用 `npm run release:mobile:android`。脚本会按当前 Git 分支自动选择 API 和发布 channel：`dev` → `beta` / `https://dev.api.healthymax.cn`，`main` → `stable` / `https://api.healthymax.cn`。默认行为是本地 Gradle 构建 APK，然后上传 COS 并更新 channel manifest；其它分支会像后端镜像发布脚本一样直接报错。

如果需要临时回退到 EAS 云构建，显式传入：

```bash
npm run release:mobile:android -- --build-eas-apk
```

登录页底部会显示当前 `API_BASE_URL`，便于确认是否配对。

> `EXPO_PUBLIC_*` 变量在 **打包时** 写入 JS 产物；改 API 地址后需重新构建安装包，不能只改服务端。

更多域名约定见 [api-url-configuration.md](./api-url-configuration.md)。

---

## MuMu 模拟器 / ADB 调试

任意支持 ADB 的 Android 模拟器均可（MuMu、夜神、Android Studio AVD 等）。

```bash
# 查看已连接设备
adb devices

# MuMu 常见需先连接（端口因版本而异）
adb connect 127.0.0.1:5555

# 截图到项目 tmp 目录
adb -s emulator-5554 exec-out screencap -p > tmp/mumu-screen.png

# 查看原生日志（过滤 React/Expo）
adb -s emulator-5554 logcat | findstr /i "ReactNative Expo"
```

MuMu 内安装 **SDK 56** 版 Expo Go 后，可直接在浏览器或 Expo Go 中打开终端打印的 `exp://<IP>:<端口>` 地址。

---

## 类型检查

```bash
npm run typecheck:mobile
```

说明：monorepo 内小程序用 React 18、Mobile 用 React 19。`apps/mobile/tsconfig.typecheck.json` 单独处理类型 paths，避免 Metro 运行时把 `react` 解析到 `@types/react`。

---

## patch-package 补丁

根目录 `npm install` 后会自动执行 `patch-package`。**不要随意删除** `patches/` 下文件。

| 补丁 | 作用 |
|------|------|
| `patches/expo+56.0.11.patch` | 修复 monorepo 下 Expo Go HMR 的 `default of undefined` 崩溃 |
| `patches/@tarojs+taro+4.1.10.patch` | 修复小程序端 React API 被 Taro 覆盖（给 `apps/wechat` 用） |

补丁文件是 diff 片段，不是完整源码，这是正常现象。

---

## 构建安装包

### 三种运行方式对比

| 方式 | 用途 | 是否需要构建 |
|------|------|--------------|
| **Expo Go** | 日常开发、热更新 | 否，扫码即可 |
| **Development Build** | 带自定义原生模块的开发客户端 | 是，类似可调试的独立 App |
| **Preview / Production Build** | 发给测试人员或上架的安装包 | 是 |

当前仓库根目录已配置 `eas.json`，Android 日常发布优先使用根目录单入口命令。

---

### 方案 A：本地 Android 构建并上传（推荐）

Android 默认使用本地构建，避免 EAS 云队列等待。运行：

```bash
npm run release:mobile:android
```

脚本会：

1. 根据当前分支选择 API 和 channel
2. 执行 `apps/mobile/android/gradlew assembleRelease`
3. 复制生成的 APK 到 `dist/mobile-release/android/<version>/<buildNumber>/`
4. 上传 APK、sha256 和 manifest 到腾讯 COS
5. 更新 `channels/beta.json` 或 `channels/stable.json`

如果已经手动构建好 APK，可以只执行上传和 channel 更新：

```bash
npm run release:mobile:android -- --artifact-apk apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

#### Android 签名

APK 必须签名才能安装。当前 Gradle 配置在未提供正式签名时会回退到 debug keystore，因此 APK 可以直接安装测试，但不适合作为长期公开分发签名。

长期分发前建议生成并妥善保存 release keystore，然后在本机或 CI 注入以下环境变量：

```powershell
$env:FOODLINK_ANDROID_KEYSTORE_PATH="D:\secrets\foodlink-release.keystore"
$env:FOODLINK_ANDROID_KEYSTORE_PASSWORD="<store-password>"
$env:FOODLINK_ANDROID_KEY_ALIAS="<key-alias>"
$env:FOODLINK_ANDROID_KEY_PASSWORD="<key-password>"
npm run release:mobile:android
```

同一个 `applicationId` 的 APK 升级安装要求新旧 APK 使用同一签名。换签名后，已安装用户通常需要先卸载旧包才能安装新包。

### 方案 B：EAS Build（备用）

云端构建，**Windows 上也能打 iOS 包**（无需本地 Mac）。适合测试分发与上架。

#### 1. 初次配置（只需一次）

```bash
# 安装 EAS CLI
npm install -g eas-cli

# 登录 Expo 账号（没有则到 expo.dev 注册）
eas login

# 在 mobile 目录初始化构建配置
cd apps/mobile
eas build:configure
```

`eas build:configure` 会在 `apps/mobile/` 生成 `eas.json`。建议按用途配置三个 profile，示例：

```json
{
  "cli": {
    "version": ">= 16.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://dev.api.healthymax.cn"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      },
      "env": {
        "EXPO_PUBLIC_API_BASE_URL": "https://api.healthymax.cn"
      }
    }
  }
}
```

> 当前 Android 发布入口统一打 APK 并上传 release channel；如后续需要 Google Play AAB，可临时把 `production` profile 的 `android.buildType` 调整为 `app-bundle` 或直接运行 EAS 自定义命令。

#### 2. 常用构建命令

在 `apps/mobile` 目录执行：

```bash
# Android 云构建备用入口（在仓库根目录执行）
npm run release:mobile:android -- --build-eas-apk

# dev 分支：构建体验版 APK，注入 https://dev.api.healthymax.cn，更新 beta channel
# main 分支：构建正式版 APK，注入 https://api.healthymax.cn，更新 stable channel
# 其它分支：拒绝执行

# iOS 测试包（需 Apple 开发者账号；产物为 IPA，通过 TestFlight 或 ad hoc 安装）
npm run build:ios:preview
# 等价：eas build -p ios --profile preview

# iOS 正式包（App Store）
npm run build:ios:production
# 等价：eas build -p ios --profile production

# 开发客户端如确需构建，可直接执行：
npx eas-cli build -p android --profile development
```

也可在根目录：

```bash
npm run build:mobile:ios:preview
```

构建完成后，终端会给出下载链接；也可在 [expo.dev](https://expo.dev) 控制台查看。

#### 3. 本地 EAS 构建（可选）

不想用云端、且本机已装好 Android SDK / Xcode 时：

```bash
cd apps/mobile
eas build -p android --profile preview --local
eas build -p ios --profile preview --local    # 仅 macOS
```

---

### 方案 C：本地原生工程构建

适合需要频繁改原生代码、或不想依赖 EAS 云构建的场景。

#### 1. 生成原生目录

```bash
cd apps/mobile
npx expo prebuild
```

会在 `apps/mobile/` 下生成 `android/`、`ios/`（已加入 `.gitignore` 为宜，或按团队规范决定是否入库）。

#### 2. Android APK（Windows / macOS / Linux）

前置：安装 [Android Studio](https://developer.android.com/studio)，配置 `ANDROID_HOME`，接受 SDK 许可。

```bash
cd apps/mobile

# 调试包（自动装到模拟器/真机）
npx expo run:android

# Release APK
npx expo run:android --variant release
```

Release APK 常见输出路径：

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

也可直接用 Gradle：

```bash
cd apps/mobile/android
./gradlew assembleRelease        # APK
./gradlew bundleRelease          # AAB
```

构建前通过环境变量指定 API：

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="https://dev.api.healthymax.cn"
npx expo run:android --variant release
```

#### 3. iOS IPA（仅 macOS）

前置：安装 Xcode、CocoaPods，Apple 开发者账号。

```bash
cd apps/mobile
npx expo run:ios

# Release 构建（需在 Xcode 中配置签名与导出 IPA）
npx expo run:ios --configuration Release
```

iOS 签名、Provisioning Profile、TestFlight 上传通常在 **Xcode → Product → Archive** 或 `eas build -p ios` 中完成。Windows 无法本地打 iOS 包。

---

## 发布前检查清单

- [ ] `apps/mobile/app.json` 中 `version` 与预期一致
- [ ] 构建 profile 的 `EXPO_PUBLIC_API_BASE_URL` 指向正确环境
- [ ] `npm run typecheck:mobile` 通过
- [ ] 在目标设备上验证登录、首页、拍照分析、保存记录等主流程
- [ ] Android 正式分发确认 `production` profile 的 API 与包类型符合本次发布目标

---

## 常见问题

### Expo Go 提示 SDK 版本不兼容 / `requires a newer version of Expo Go`

**原因：** 项目是 **Expo SDK 56**，手机上的 Expo Go 版本更旧（常见：Play 商店未更新、MuMu 里装的是旧 APK、iOS 未升级）。

**处理：**

1. **真机**：到应用商店更新 Expo Go 到最新版；若仍不行，打开 [expo.dev/go](https://expo.dev/go) 按 **SDK 56** 下载安装包。
2. **MuMu / 模拟器**：卸载旧 Expo Go，从 [expo.dev/go](https://expo.dev/go) 下载 **SDK 56** 对应 Android APK 再安装（Play 商店在模拟器里经常是旧版）。
3. **不想追 Expo Go 版本**：改用 Development Build（`eas build --profile development`）或本地 `npx expo run:android`，不依赖 Expo Go。

> 之前 MuMu 能跑、真机不能跑，几乎都是两台设备上的 Expo Go 主版本不一致。

### 手机能打开 App 但接口全失败

- 确认 `npm run dev:backend` 已启动
- 确认登录页底部 API 不是 `127.0.0.1`（真机无法访问你电脑的 localhost）
- 用 `npm run dev:mobile` 重新启动，或手动设置 `MOBILE_DEV_LAN_IP`

### Metro 报 `Unable to resolve "react"`

多为 `tsconfig.json` 把 `react` paths 指到了 `@types/react`。运行时 paths 已移除，类型检查走 `tsconfig.typecheck.json`。停止 Metro 后重新 `npm run dev:mobile`。

### `Cannot read property 'default' of undefined`

确认 `patches/expo+56.0.11.patch` 存在且 `npm install` 后已应用。可检查 `node_modules/expo/src/async-require/hmr.ts` 是否含 `MetroHMRClientModule.default ?? MetroHMRClientModule`。

### 手机报 `Failed to download remote update`

通常是手机连错了 Metro 地址或端口：

1. 关闭所有旧的 Expo/Metro 终端，重新 `npm run dev:mobile`
2. 以脚本打印的 `exp://<IP>:<端口>` 为准（不要用手动输入的旧地址）
3. 确认手机与电脑在同一局域网，防火墙放行 Node/Metro 入站
4. 不要用 `http://localhost:xxxx`（那是电脑本地地址，手机访问不到）

### `npm run dev:mobile` 直接退出 / 询问是否换端口

说明 8081 上还有旧 Metro 进程。脚本现在会在启动前自动结束占用端口的进程；若 8081 仍不可用，会**自动改用 8082 等端口**，无需手动回答 yes/no。

若仍失败，手动结束占用进程后重试：

```powershell
# 查看占用 8081 的 PID
netstat -ano | findstr LISTENING | findstr :8081

# 结束对应进程（将 <PID> 替换为实际值）
taskkill /PID <PID> /F
```

### 端口 8081 被占用

脚本会先清理旧 Metro，再以实际可用端口启动。手机扫码时以终端里 **`Metro: exp://...`** 或脚本打印的地址为准。

---

## 相关文档

- [API 地址配置说明](./api-url-configuration.md)
- [Expo EAS Build 官方文档](https://docs.expo.dev/build/introduction/)
- [Expo 本地构建](https://docs.expo.dev/guides/local-app-development/)
