import * as React from 'react'
import { act, render } from '@testing-library/react'
import { ThemeSceneImage } from '../../src/components/ThemeSceneImage'
import { ThemeSceneScope } from '../../src/components/ThemeSceneScope'
import { retryBalancedScenes, subscribeBalancedScenes } from '../../src/utils/balanced-theme-scenes'

let mockCachedLoad = false
let mockCallbacks: Array<{ onLoad: () => void; onError: (detail: string) => void }> = []
jest.mock('../../src/components/SceneArtwork', () => ({ SceneArtwork: (props: any) => {
  const React = require('react')
  React.useLayoutEffect(() => { if (mockCachedLoad) props.onLoad() }, [props.src])
  mockCallbacks.push(props)
  return React.createElement('img', { src: props.src })
} }))

beforeEach(() => { mockCachedLoad = false; mockCallbacks = []; jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

test('cached native load before the passive timer remains loaded after 20 seconds', async () => {
  mockCachedLoad = true
  const listener = jest.fn()
  const stop = subscribeBalancedScenes(listener)
  try {
    render(<ThemeSceneImage src='/packageThemeScenesNature/assets/natural-paper-v8.jpg' className='paper' />)
    await act(async () => { await Promise.resolve() })
    act(() => jest.advanceTimersByTime(20000))
    expect(listener.mock.calls.some(call => call[1] === true)).toBe(false)
    expect(listener.mock.calls.some(call => call[3]?.phase === 'loaded')).toBe(true)
  } finally { stop() }
})

test('retry ignores callbacks from the old image and preserves distinct owners for duplicate files', async () => {
  const listener = jest.fn()
  const stop = subscribeBalancedScenes(listener)
  try {
    const src = '/packageThemeScenesGallery/assets/miniature-garden-v4.jpg'
    const { unmount } = render(<ThemeSceneScope.Provider value='page'><ThemeSceneImage src={src} className='background' /><ThemeSceneImage src={src} className='review' /></ThemeSceneScope.Provider>)
    await act(async () => { await Promise.resolve() })
    const [first, second] = mockCallbacks
    act(() => { first.onError('first failed'); second.onError('second failed') })
    const errors = listener.mock.calls.filter(call => call[1] === true)
    expect(errors).toHaveLength(2)
    expect(errors[0][3].scope).toBe('page')
    expect(errors[0][3].owner).not.toBe(errors[1][3].owner)
    await act(async () => { await retryBalancedScenes() })
    listener.mockClear()
    act(() => { first.onLoad(); first.onError('late old error') })
    expect(listener).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(20000))
    expect(listener.mock.calls.filter(call => call[1] === true)).toHaveLength(2)
    listener.mockClear()
    unmount()
    const removed = listener.mock.calls.filter(call => call[3]?.phase === 'disposed')
    expect(removed).toHaveLength(2)
    expect(removed[0][3].owner).not.toBe(removed[1][3].owner)
  } finally { stop() }
})
