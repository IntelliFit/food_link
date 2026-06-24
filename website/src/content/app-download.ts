import { Boxes, Download, FileJson2, PackageCheck, Smartphone, Store } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const releaseBaseUrl = 'https://download.healthymax.cn'
const fallbackReleaseVersion = '0.0.1'
const fallbackReleaseBuild = '4'
const fallbackStableReleasePath = `${releaseBaseUrl}/releases/android/stable/${fallbackReleaseVersion}/${fallbackReleaseBuild}`
const fallbackBetaReleasePath = `${releaseBaseUrl}/releases/android/beta/${fallbackReleaseVersion}/${fallbackReleaseBuild}`

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
    'Android APK 适合手机直接下载安装；商店包会在后续应用商店分发流程中提供。',
  version: fallbackReleaseVersion,
  build: fallbackReleaseBuild,
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
      href: `${fallbackStableReleasePath}/foodlink-${fallbackReleaseVersion}-${fallbackReleaseBuild}.apk`,
      meta: `stable · v${fallbackReleaseVersion} (${fallbackReleaseBuild})`,
      icon: Download,
      primary: true,
    },
    {
      id: 'beta-apk',
      channel: 'beta',
      artifact: 'apk',
      label: 'Android APK 内测通道',
      description: '最新内测安装包，用于提前体验。',
      href: `${fallbackBetaReleasePath}/foodlink-${fallbackReleaseVersion}-${fallbackReleaseBuild}.apk`,
      meta: `beta · v${fallbackReleaseVersion} (${fallbackReleaseBuild})`,
      icon: Smartphone,
    },
    {
      id: 'stable-aab',
      channel: 'stable',
      artifact: 'aab',
      label: 'Android AAB 商店包',
      description: '用于应用商店上传审核；未发布时隐藏。',
      href: `${fallbackStableReleasePath}/foodlink-${fallbackReleaseVersion}-${fallbackReleaseBuild}.aab`,
      meta: 'stable · app bundle',
      icon: Store,
    },
    {
      id: 'beta-aab',
      channel: 'beta',
      artifact: 'aab',
      label: 'Android AAB 内测包',
      description: '用于渠道侧测试和后续商店分发。',
      href: `${fallbackBetaReleasePath}/foodlink-${fallbackReleaseVersion}-${fallbackReleaseBuild}.aab`,
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
      href: `${fallbackStableReleasePath}/manifest.json`,
    },
  ],
  checksumLabel: 'SHA256 校验随版本目录发布',
  checksumIcon: PackageCheck,
  manifestIcon: FileJson2,
} as const
