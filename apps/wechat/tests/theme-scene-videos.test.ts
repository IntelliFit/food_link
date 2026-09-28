import { getThemeSceneVideo, hasThemeSceneVideo } from '../src/utils/theme-scene-videos'

test('enables only reviewed theme scene clips', () => {
  expect(getThemeSceneVideo('way-of-water', 'home')).toBe('/packageThemeScenes/assets/water-home-v1.mp4')
  expect(getThemeSceneVideo('way-of-water', 'stats')).toBeUndefined()
  expect(hasThemeSceneVideo('way-of-water')).toBe(true)
  expect(hasThemeSceneVideo('natural-symbiosis')).toBe(false)
})
