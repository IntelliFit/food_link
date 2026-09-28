import { fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'

import { FeedImageGrid } from '../../src/pages/community/components/FeedImageGrid'

const urls = Array.from({ length: 10 }, (_, index) => `https://cdn.example.com/${index + 1}.jpg`)

describe('FeedImageGrid', () => {
  beforeEach(() => {
    ;(Taro as any).previewImage = jest.fn()
  })

  it.each([
    [1, 'is-single'],
    [2, 'is-two'],
    [3, 'is-three-column'],
    [4, 'is-four'],
    [5, 'is-three-column'],
  ])('uses the moments layout for %i images', (count, layoutClass) => {
    const view = render(<FeedImageGrid urls={urls.slice(0, count)} />)

    const grid = view.container.querySelector('.feed-photo-grid')
    expect(grid).toHaveClass(layoutClass)
    expect(grid?.querySelectorAll('.feed-photo-grid-item')).toHaveLength(count)
  })

  it('keeps a single image proportional and crops only multi-image thumbnails', () => {
    const single = render(<FeedImageGrid urls={urls.slice(0, 1)} />)
    expect(single.container.querySelector('img')).toHaveAttribute('mode', 'widthFix')

    const multiple = render(<FeedImageGrid urls={urls.slice(0, 3)} />)
    multiple.container.querySelectorAll('img').forEach((image) => {
      expect(image).toHaveAttribute('mode', 'aspectFill')
    })
  })

  it('previews the tapped original image with the full URL list', () => {
    const view = render(<FeedImageGrid urls={urls.slice(0, 3)} />)
    fireEvent.click(view.container.querySelectorAll('.feed-photo-grid-item')[1])

    expect((Taro as any).previewImage).toHaveBeenCalledWith({
      current: urls[1],
      urls: urls.slice(0, 3),
    })
  })

  it('shows at most nine thumbnails and marks hidden images', () => {
    const view = render(<FeedImageGrid urls={urls} />)

    expect(view.container.querySelectorAll('.feed-photo-grid-item')).toHaveLength(9)
    expect(view.getByText('+1')).toBeInTheDocument()
  })
})
