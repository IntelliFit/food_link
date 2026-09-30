import { getThemeSceneVideo, hasThemeSceneVideo } from '../src/utils/theme-scene-videos'

test('enables the reviewed water scene clip on every balanced surface', () => {
  expect(getThemeSceneVideo('way-of-water', 'home')).toBe('/packageThemeScenes/assets/water-home-v6.mp4')
  expect(getThemeSceneVideo('way-of-water', 'stats')).toBe('/packageThemeScenes/assets/water-stats-v6.mp4')
  expect(getThemeSceneVideo('way-of-water', 'community')).toBe('/packageThemeScenes/assets/water-community-v6.mp4')
  expect(getThemeSceneVideo('way-of-water', 'profile')).toBe('/packageThemeScenes/assets/water-profile-v6.mp4')
  expect(hasThemeSceneVideo('way-of-water')).toBe(true)
  expect(hasThemeSceneVideo('natural-symbiosis')).toBe(false)
})
