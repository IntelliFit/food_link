type AsyncRequire = { async: (path: string) => Promise<unknown> }

const root = '/packageThemeScenes/assets'
export const BALANCED_SCENES = {
  miniatureGarden: `${root}/miniature-garden-v4.webp`,
  miniatureDesk: `${root}/miniature-desk-v4.webp`,
  miniatureSquare: `${root}/miniature-square-v4.webp`,
  picturebookDay: `${root}/picturebook-day-v4.webp`,
  picturebookDesk: `${root}/picturebook-desk-v4.webp`,
  waterVessel: `${root}/water-vessel-v4.webp`,
  waterRock: `${root}/water-rock-v6.webp`,
  waterHome: `${root}/water-home-v3.webp`,
  waterStats: `${root}/water-stats-v3.webp`,
  waterCommunity: `${root}/water-community-v3.webp`,
  waterProfile: `${root}/water-profile-v3.webp`,
  naturalLeaves: `${root}/natural-leaves-v4.webp`,
  naturalRings: `${root}/natural-rings-v8.webp`,
  naturalDrawer: `${root}/natural-drawer-v8.webp`,
  naturalPaper: `${root}/natural-paper-v8.webp`,
  motionBranch: `${root}/motion-branch-v9.webp`,
  motionCloud: `${root}/motion-cloud-v9.webp`,
  easternSoup: `${root}/eastern-soup-v4.webp`,
  galleryCollage: `${root}/gallery-collage-v4.webp`,
} as const

let pending: Promise<void> | undefined
/** Share one download across all tabs; a failed request remains retryable. */
export function loadBalancedScenes(): Promise<void> {
  if (!pending) {
    pending = (require as unknown as AsyncRequire).async('/packageThemeScenes/ready.js')
      .then(() => undefined)
      .catch(error => { pending = undefined; throw error })
  }
  return pending
}
