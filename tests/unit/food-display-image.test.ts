import {
  collectFoodDisplayImageUrls,
  hasFoodDisplayImage,
  pickFoodDisplayImageUrl,
  sanitizeFoodDisplayImageUrl,
} from '../../src/utils/food-display-image'

describe('food-display-image', () => {
  it('accepts https CDN urls', () => {
    const url = 'https://cdn-food-images.example.com/standard-food/a.jpg'
    expect(sanitizeFoodDisplayImageUrl(url)).toBe(url)
    expect(hasFoodDisplayImage({ image_path: url })).toBe(true)
  })

  it('rejects bare storage keys and empty literals', () => {
    expect(sanitizeFoodDisplayImageUrl('standard-food/backfill/id/x.jpg')).toBe('')
    expect(sanitizeFoodDisplayImageUrl('null')).toBe('')
    expect(sanitizeFoodDisplayImageUrl('')).toBe('')
  })

  it('merges image_paths and image_path with dedupe', () => {
    const urls = collectFoodDisplayImageUrls({
      image_path: 'https://cdn.example.com/a.jpg',
      image_paths: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    })
    expect(urls).toEqual(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'])
    expect(pickFoodDisplayImageUrl({ image_paths: urls })).toBe('https://cdn.example.com/a.jpg')
  })
})
