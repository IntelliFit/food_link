import { SceneArtwork } from '../../src/components/SceneArtwork'

test.each([
  ['/packageThemeScenes/assets/water-home-v5.jpg', 'theme-scene-image', 'water-home-v5.jpg'],
  ['/packageThemeScenesNature/assets/natural-rings-v8.png', 'theme-scene-nature-image', 'natural-rings-v8.png'],
  ['/packageThemeScenesGallery/assets/gallery-profile-v10.jpg', 'theme-scene-gallery-image', 'gallery-profile-v10.jpg'],
])('packaged artwork %s renders its native owner and forwards decode/error events', (src, owner, asset) => {
  const loaded = jest.fn()
  const failed = jest.fn()
  // A jsdom custom element cannot dispatch WeChat native component events.
  const component = SceneArtwork({ src, className: 'portrait', mode: 'widthFix', onLoad: loaded, onError: failed })
  expect(component.type).toBe(owner)
  expect(component.props.asset).toBe(asset)
  expect(component.props.sceneclass).toBe('portrait')
  expect(component.props.mode).toBe('widthFix')
  expect(component.props.src).toBeUndefined()
  component.props.onOwnerready()
  component.props.onLoad()
  component.props.onError()
  expect(loaded).toHaveBeenCalledTimes(1)
  expect(failed).toHaveBeenCalledTimes(1)
})
