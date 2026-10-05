import { Smartphone } from 'lucide-react'

const releaseBaseUrl = 'https://download.healthymax.cn'
const version = '4.6.5'
const build = '64'

export const appDownload = {
  eyebrow: 'App 下载',
  title: '食探 App\n现在可以下载使用',
  description: '下载最新 Android 版本，体验食物识别、饮食记录与消息提醒等功能。',
  // 沿用已发布 APK 的实际路径与清单；存储通道不作为用户选版本的入口。
  manifestUrl: `${releaseBaseUrl}/channels/beta.json`,
  version,
  href: `${releaseBaseUrl}/releases/android/beta/${version}/${build}/foodlink-${version}-${build}.apk`,
  label: 'Android App 下载',
  downloadDescription: '当前版本，直接下载安装。',
  installationNote: '适用于 Android 手机。下载完成后，打开安装包并按系统提示安装。',
  icon: Smartphone,
} as const
