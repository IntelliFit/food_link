import { Boxes, Download, FileJson2, PackageCheck, Smartphone, Store } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const releaseBaseUrl = 'https://download.healthymax.cn'
const releaseVersion = '0.0.1'
const releaseBuild = '2'
const releasePath = `${releaseBaseUrl}/releases/android/${releaseVersion}/${releaseBuild}`

export type AppDownloadOption = {
  id: string
  label: string
  description: string
  href: string
  meta: string
  icon: LucideIcon
  primary?: boolean
}

export const appDownload = {
  eyebrow: 'App 下载',
  title: '食探 App 0.0.1\n现在可以下载体验。',
  description:
    'Android 直装包适合手机直接安装体验；AAB 是应用商店上架包，保留给分发渠道和审核流程使用。',
  version: releaseVersion,
  build: releaseBuild,
  releaseBaseUrl,
  options: [
    {
      id: 'stable-apk',
      label: 'Android APK 正式通道',
      description: '适合 Android 手机直接下载并安装。',
      href: `${releasePath}/foodlink-${releaseVersion}-${releaseBuild}.apk`,
      meta: `stable · v${releaseVersion} (${releaseBuild})`,
      icon: Download,
      primary: true,
    },
    {
      id: 'beta-apk',
      label: 'Android APK 内测通道',
      description: '用于提前体验同一版安装包。',
      href: `${releasePath}/foodlink-${releaseVersion}-${releaseBuild}.apk`,
      meta: `beta · v${releaseVersion} (${releaseBuild})`,
      icon: Smartphone,
    },
    {
      id: 'stable-aab',
      label: 'Android AAB 商店包',
      description: '用于应用商店上传审核，不是手机直装包。',
      href: `${releasePath}/foodlink-${releaseVersion}-${releaseBuild}.aab`,
      meta: `stable · app bundle`,
      icon: Store,
    },
    {
      id: 'beta-aab',
      label: 'Android AAB 内测包',
      description: '用于渠道侧测试和后续商店分发。',
      href: `${releasePath}/foodlink-${releaseVersion}-${releaseBuild}.aab`,
      meta: `beta · app bundle`,
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
      href: `${releasePath}/manifest.json`,
    },
  ],
  checksumLabel: 'SHA256 校验随版本目录发布',
  checksumIcon: PackageCheck,
  manifestIcon: FileJson2,
} as const
