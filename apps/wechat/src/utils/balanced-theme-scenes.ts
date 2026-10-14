type AsyncRequire = { async: (path: string) => Promise<unknown> }

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
let ready = false
const listeners = new Set<(revision: number, imageError?: boolean) => void>()

export function getBalancedScenesRevision(): number { return revision }
export function subscribeBalancedScenes(listener: (revision: number, imageError?: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function notifyReady(): void { listeners.forEach(listener => listener(revision)) }
/** Image failure requests a retry affordance without invalidating the downloaded package. */
export function reportBalancedSceneImageError(): void { listeners.forEach(listener => listener(revision, true)) }

/** Share one download across all tabs; a failed request remains retryable. */
export function loadBalancedScenes(): Promise<void> {
  if (!pending) {
    // This utility is shared in root common.js. WeChat require.async accepts
    // module-relative paths; image resource URLs below remain root-relative.
    pending = Promise.resolve().then(() => (require as unknown as AsyncRequire).async('./packageThemeScenes/ready.js'))
      .then(() => { ready = true; notifyReady() })
      .catch(error => { pending = undefined; ready = false; throw error })
  }
  return pending
}

/** A package retry also remounts images that previously failed to decode. */
export function retryBalancedScenes(): Promise<void> {
  if (!retryPending) {
    const wasReady = ready
    revision += 1
    retryPending = loadBalancedScenes().then(() => { if (wasReady) notifyReady() }).finally(() => { retryPending = undefined })
  }
  return retryPending
}
