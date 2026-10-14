const root = '/packageThemeScenes/assets'
const natureRoot = '/packageThemeScenesNature/assets'
const galleryRoot = '/packageThemeScenesGallery/assets'
export const BALANCED_SCENES = {
  miniatureGarden: `${galleryRoot}/miniature-garden-v4.jpg`,
  miniatureDesk: `${galleryRoot}/miniature-desk-v4.jpg`,
  miniatureProfile: `${galleryRoot}/miniature-profile-v10.jpg`,
  miniatureSquare: `${galleryRoot}/miniature-square-v4.jpg`,
  picturebookDay: `${natureRoot}/picturebook-day-v4.jpg`,
  picturebookDesk: `${natureRoot}/picturebook-desk-v4.jpg`,
  picturebookProfile: `${natureRoot}/picturebook-profile-v10.jpg`,
  waterVessel: `${root}/water-vessel-v4.jpg`,
  waterRock: `${root}/water-rock-v6.jpg`,
  waterHome: `${root}/water-home-v5.jpg`,
  waterStats: `${root}/water-stats-v5.jpg`,
  waterCommunity: `${root}/water-community-v5.jpg`,
  waterProfile: `${root}/water-profile-v5.jpg`,
  naturalLeaves: `${natureRoot}/natural-leaves-v4.jpg`,
  naturalRings: `${natureRoot}/natural-rings-v8.png`,
  naturalDrawer: `${natureRoot}/natural-drawer-v8.jpg`,
  naturalPaper: `${natureRoot}/natural-paper-v8.jpg`,
  motionBranch: `${root}/motion-branch-v9.png`,
  motionCloud: `${root}/motion-cloud-v9.png`,
  easternSoup: `${root}/eastern-soup-v4.jpg`,
  galleryCollage: `${galleryRoot}/gallery-collage-v4.jpg`,
  galleryProfile: `${galleryRoot}/gallery-profile-v10.jpg`,
} as const

let pending: Promise<void> | undefined
let retryPending: Promise<void> | undefined
let revision = 0
const listeners = new Set<(revision: number, imageError?: boolean, detail?: string) => void>()
type LazyError = { subpackage?: Array<string | { root?: string; name?: string }>; errMsg?: string }
declare const wx: { onLazyLoadError?: (listener: (event: LazyError) => void) => void; offLazyLoadError?: (listener: (event: LazyError) => void) => void }
const onLazyError = (event: LazyError) => {
  if (event.subpackage?.some(pkg => typeof pkg === 'string' ? /packageThemeScenes|theme-scenes/.test(pkg) : pkg.root?.startsWith('packageThemeScenes') || pkg.name?.startsWith('theme-scenes'))) {
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
