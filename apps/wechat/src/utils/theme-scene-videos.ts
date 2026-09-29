import type { BalancedThemeId } from './balanced-theme'

export type ThemeSceneSurface = 'home' | 'stats' | 'community' | 'profile'

/** Only add reviewed, playable scene videos. Missing assets keep the original still image. */
export const THEME_SCENE_VIDEOS: Partial<Record<BalancedThemeId, Partial<Record<ThemeSceneSurface, string>>>> = {
  'way-of-water': {
    home: '/packageThemeScenes/assets/water-home-v3.mp4',
    stats: '/packageThemeScenes/assets/water-stats-v3.mp4',
    community: '/packageThemeScenes/assets/water-community-v3.mp4',
    profile: '/packageThemeScenes/assets/water-profile-v3.mp4',
  },
}

export function getThemeSceneVideo(theme: BalancedThemeId, surface: ThemeSceneSurface): string | undefined {
  return THEME_SCENE_VIDEOS[theme]?.[surface]
}

export function hasThemeSceneVideo(theme: BalancedThemeId): boolean {
  return Object.values(THEME_SCENE_VIDEOS[theme] || {}).some(Boolean)
}
