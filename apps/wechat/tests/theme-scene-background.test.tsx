import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeSceneBackground } from '../src/components/ThemeSceneBackground'

jest.mock('@tarojs/components', () => ({
  View: ({ children, className }: any) => <div className={className}>{children}</div>,
  Image: ({ src }: any) => <img alt='scene poster' src={src} />,
  Video: ({ src, className, autoplay, muted, loop, controls, onTimeUpdate, onError }: any) => <div data-testid='scene-video' className={className} data-src={src} data-autoplay={autoplay} data-muted={muted} data-loop={loop} data-controls={controls}>
    <button onClick={() => onTimeUpdate?.({ detail: { currentTime: 1 } })}>first frame</button>
    <button onClick={onError}>video error</button>
  </div>,
}))

test('missing or inactive clip keeps original artwork without mounting a player', () => {
  const { rerender } = render(<ThemeSceneBackground poster='/still.webp' active />)
  expect(screen.getByAltText('scene poster')).toHaveAttribute('src', '/still.webp')
  expect(screen.queryByTestId('scene-video')).toBeNull()
  rerender(<ThemeSceneBackground poster='/still.webp' src='/scene.mp4' active={false} />)
  expect(screen.queryByTestId('scene-video')).toBeNull()
})

test('reveals a silent looping clip only after a decoded frame; hiding releases the player', () => {
  const { rerender } = render(<ThemeSceneBackground poster='/still.webp' src='/scene.mp4' active />)
  const video = screen.getByTestId('scene-video')
  expect(video).toHaveAttribute('data-autoplay', 'true')
  expect(video).toHaveAttribute('data-loop', 'true')
  expect(video).toHaveAttribute('data-muted', 'true')
  expect(video).toHaveAttribute('data-controls', 'false')
  expect(video).not.toHaveClass('is-playing')
  fireEvent.click(screen.getByText('first frame'))
  expect(video).toHaveClass('is-playing')
  rerender(<ThemeSceneBackground poster='/still.webp' src='/scene.mp4' active={false} />)
  expect(screen.queryByTestId('scene-video')).toBeNull()
  expect(screen.getByAltText('scene poster')).toBeInTheDocument()
  rerender(<ThemeSceneBackground poster='/still.webp' src='/scene.mp4' active />)
  expect(screen.getByTestId('scene-video')).not.toHaveClass('is-playing')
})

test('failed playback falls back to the still and a new source can recover', () => {
  const { rerender } = render(<ThemeSceneBackground poster='/still.webp' src='/broken.mp4' active />)
  fireEvent.click(screen.getByText('video error'))
  expect(screen.queryByTestId('scene-video')).toBeNull()
  expect(screen.getByAltText('scene poster')).toBeInTheDocument()
  rerender(<ThemeSceneBackground poster='/still.webp' src='/new.mp4' active />)
  expect(screen.getByTestId('scene-video')).toHaveAttribute('data-src', '/new.mp4')
  expect(screen.getByTestId('scene-video')).not.toHaveClass('is-playing')
})
