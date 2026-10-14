const root = '/packageThemeScenes/assets'
export const BALANCED_SCENES = {
  miniatureGarden: `${root}/miniature-garden-v4.webp`,
  miniatureDesk: `${root}/miniature-desk-v4.webp`,
  miniatureProfile: `${root}/miniature-profile-v10.webp`,
  miniatureSquare: `${root}/miniature-square-v4.webp`,
  picturebookDay: `${root}/picturebook-day-v4.webp`,
  picturebookDesk: `${root}/picturebook-desk-v4.webp`,
  picturebookProfile: `${root}/picturebook-profile-v10.webp`,
  waterVessel: `${root}/water-vessel-v4.webp`,
  waterRock: `${root}/water-rock-v6.webp`,
  waterHome: `${root}/water-home-v5.webp`,
  waterStats: `${root}/water-stats-v5.webp`,
  waterCommunity: `${root}/water-community-v5.webp`,
  waterProfile: `${root}/water-profile-v5.webp`,
  naturalLeaves: `${root}/natural-leaves-v4.webp`,
  naturalRings: `${root}/natural-rings-v8.webp`,
  naturalDrawer: `${root}/natural-drawer-v8.webp`,
  naturalPaper: `${root}/natural-paper-v8.webp`,
  motionBranch: `${root}/motion-branch-v9.webp`,
  motionCloud: `${root}/motion-cloud-v9.webp`,
  easternSoup: `${root}/eastern-soup-v4.webp`,
  galleryCollage: `${root}/gallery-collage-v4.webp`,
  galleryProfile: `${root}/gallery-profile-v10.webp`,
} as const

let pending: Promise<void> | undefined
let retryPending: Promise<void> | undefined
let revision = 0
const listeners = new Set<(revision: number, imageError?: boolean, detail?: string) => void>()
type LazyError = { subpackage?: Array<string | { root?: string; name?: string }>; errMsg?: string }
declare const wx: { onLazyLoadError?: (listener: (event: LazyError) => void) => void; offLazyLoadError?: (listener: (event: LazyError) => void) => void }
const onLazyError = (event: LazyError) => {
  if (event.subpackage?.some(pkg => typeof pkg === 'string' ? /packageThemeScenes|theme-scenes/.test(pkg) : pkg.root?.startsWith('packageThemeScenes') || pkg.name === 'theme-scenes')) {
    console.warn('[theme-scenes] component package unavailable:', event.errMsg || 'unknown error')
    reportBalancedSceneImageError(`组件下载：${event.errMsg || '未返回原因'}`)
  }
}

export function getBalancedScenesRevision(): number { return revision }
export function subscribeBalancedScenes(listener: (revision: number, imageError?: boolean, detail?: string) => void): () => void {
  if (!listeners.size && typeof wx !== 'undefined') wx.onLazyLoadError?.(onLazyError)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof wx !== 'undefined') wx.offLazyLoadError?.(onLazyError)
  }
}
function notifyReady(): void { listeners.forEach(listener => listener(revision)) }
/** Image failure requests a retry affordance without invalidating the downloaded package. */
export function reportBalancedSceneImageError(detail?: string): void {
  listeners.forEach(listener => detail ? listener(revision, true, detail.slice(0, 180)) : listener(revision, true))
}

/** Permit rendering; the async native component owns the package download.
 * Loading JS does not permit a main-package Image to read private artwork. */
export function loadBalancedScenes(): Promise<void> {
  if (!pending) {
    pending = Promise.resolve().then(notifyReady)
  }
  return pending
}

/** Remount the native async components and images that failed to decode. */
export function retryBalancedScenes(): Promise<void> {
  if (!retryPending) {
    revision += 1
    retryPending = Promise.resolve().then(notifyReady).finally(() => { retryPending = undefined })
  }
  return retryPending
}
