import { Boxes, Download, FileJson2, PackageCheck, Smartphone, Store } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const releaseBaseUrl = 'https://download.healthymax.cn'
const fallbackReleases = {
  stable: { version: '0.0.1', build: '4' },
  beta: { version: '4.6.5', build: '64' },
} as const
const fallbackStableReleasePath = `${releaseBaseUrl}/releases/android/stable/${fallbackReleases.stable.version}/${fallbackReleases.stable.build}`
const fallbackBetaReleasePath = `${releaseBaseUrl}/releases/android/beta/${fallbackReleases.beta.version}/${fallbackReleases.beta.build}`

export type AppDownloadChannel = 'stable' | 'beta'
export type AppDownloadArtifact = 'apk' | 'aab'

export type AppDownloadOption = {
  id: string
  channel: AppDownloadChannel
  artifact: AppDownloadArtifact
  label: string
  description: string
  href: string
  meta: string
  icon: LucideIcon
  primary?: boolean
}

export const appDownload = {
  eyebrow: 'App 下载',
  title: '食探 App\n现在可以下载体验',
  description:
    '当前推荐下载最新 Android 内测版（连接开发环境）。正式通道单独保留，商店包会在后续应用商店分发流程中提供。',
  primaryChannel: 'beta',
  version: fallbackReleases.beta.version,
  build: fallbackReleases.beta.build,
  fallbackReleases,
  releaseBaseUrl,
  channels: {
    stable: `${releaseBaseUrl}/channels/stable.json`,
    beta: `${releaseBaseUrl}/channels/beta.json`,
  },
  options: [
    {
      id: 'stable-apk',
      channel: 'stable',
      artifact: 'apk',
      label: 'Android APK 正式通道',
      description: '当前稳定版安装包，适合日常体验。',
      href: `${fallbackStableReleasePath}/foodlink-${fallbackReleases.stable.version}-${fallbackReleases.stable.build}.apk`,
      meta: `stable · v${fallbackReleases.stable.version} (${fallbackReleases.stable.build})`,
      icon: Download,
    },
    {
      id: 'beta-apk',
      channel: 'beta',
      artifact: 'apk',
      label: 'Android APK 内测通道',
      description: '当前推荐：最新功能体验包，连接开发环境。',
      href: `${fallbackBetaReleasePath}/foodlink-${fallbackReleases.beta.version}-${fallbackReleases.beta.build}.apk`,
      meta: `beta · v${fallbackReleases.beta.version} (${fallbackReleases.beta.build})`,
      icon: Smartphone,
      primary: true,
    },
    {
      id: 'stable-aab',
      channel: 'stable',
      artifact: 'aab',
      label: 'Android AAB 商店包',
      description: '用于应用商店上传审核；未发布时隐藏。',
      href: `${fallbackStableReleasePath}/foodlink-${fallbackReleases.stable.version}-${fallbackReleases.stable.build}.aab`,
      meta: 'stable · app bundle',
      icon: Store,
    },
    {
      id: 'beta-aab',
      channel: 'beta',
      artifact: 'aab',
      label: 'Android AAB 内测包',
      description: '用于渠道侧测试和后续商店分发。',
      href: `${fallbackBetaReleasePath}/foodlink-${fallbackReleases.beta.version}-${fallbackReleases.beta.build}.aab`,
      meta: 'beta · app bundle',
      icon: Boxes,
    },
  ] satisfies AppDownloadOption[],
  manifests: [
    {
      id: 'stable',
      label: 'stable.json',
      href: `${releaseBaseUrl}/channels/stable.json`,
    },
    {
      id: 'beta',
      label: 'beta.json',
      href: `${releaseBaseUrl}/channels/beta.json`,
    },
    {
      id: 'release',
      label: 'manifest.json',
      href: `${fallbackBetaReleasePath}/manifest.json`,
    },
  ],
  checksumLabel: 'SHA256 校验随版本目录发布',
  checksumIcon: PackageCheck,
  manifestIcon: FileJson2,
} as const
