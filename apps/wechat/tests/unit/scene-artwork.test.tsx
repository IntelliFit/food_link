import { SceneArtwork } from '../../src/components/SceneArtwork'

test('packaged artwork renders a native resource owner and forwards decode/error events', () => {
  const loaded = jest.fn()
  const failed = jest.fn()
  // A jsdom custom element cannot dispatch WeChat native component events.
  const component = SceneArtwork({ src: '/packageThemeScenes/assets/gallery-profile-v10.webp', className: 'portrait', mode: 'widthFix', onLoad: loaded, onError: failed })
  expect(component.type).toBe('theme-scene-image')
  expect(component.props.asset).toBe('gallery-profile-v10.webp')
  expect(component.props.sceneclass).toBe('portrait')
  expect(component.props.mode).toBe('widthFix')
  expect(component.props.src).toBeUndefined()
  component.props.onLoad()
  component.props.onError()
  expect(loaded).toHaveBeenCalledTimes(1)
  expect(failed).toHaveBeenCalledTimes(1)
})
