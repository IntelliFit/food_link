import { getThemeSceneVideo, hasThemeSceneVideo } from '../src/utils/theme-scene-videos'

test('enables the reviewed water scene clip on every balanced surface', () => {
  const waterClip = '/packageThemeScenes/assets/water-home-v2.mp4'
  expect(getThemeSceneVideo('way-of-water', 'home')).toBe(waterClip)
  expect(getThemeSceneVideo('way-of-water', 'stats')).toBe(waterClip)
  expect(getThemeSceneVideo('way-of-water', 'community')).toBe(waterClip)
  expect(getThemeSceneVideo('way-of-water', 'profile')).toBe(waterClip)
  expect(hasThemeSceneVideo('way-of-water')).toBe(true)
  expect(hasThemeSceneVideo('natural-symbiosis')).toBe(false)
})
