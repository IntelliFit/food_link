import {
  LANDSCAPE_PHOTO_FRAME_RATIO,
  PORTRAIT_PHOTO_FRAME_RATIO,
  getCenterCropRect,
  getPhotoFrameRatio,
  getPhotoFrameSize,
} from '../src/photo-frame'

describe('getCenterCropRect', () => {
  it('crops a tall phone photo to 3:4 from the middle and caps the long edge', () => {
    expect(getCenterCropRect(1080, 2400, PORTRAIT_PHOTO_FRAME_RATIO, 1600)).toEqual({
      x: 0, y: 480, width: 1080, height: 1440, outputWidth: 1080, outputHeight: 1440,
    })
    expect(getCenterCropRect(3024, 4032, PORTRAIT_PHOTO_FRAME_RATIO, 1600)).toEqual({
      x: 0, y: 0, width: 3024, height: 4032, outputWidth: 1200, outputHeight: 1600,
    })
  })

  it('crops a tall photo to a 4:3 strip for landscape shots', () => {
    expect(getCenterCropRect(3024, 4032, LANDSCAPE_PHOTO_FRAME_RATIO, 1600)).toEqual({
      x: 0, y: 882, width: 3024, height: 2268, outputWidth: 1600, outputHeight: 1200,
    })
  })

  it('trims the sides when the photo is wider than the frame', () => {
    expect(getCenterCropRect(1920, 1080, LANDSCAPE_PHOTO_FRAME_RATIO, 1600)).toEqual({
      x: 240, y: 0, width: 1440, height: 1080, outputWidth: 1440, outputHeight: 1080,
    })
  })
})

describe('getPhotoFrameRatio', () => {
  it('limits landscape photos to 4:3, however wide they are', () => {
    expect(getPhotoFrameRatio(4 / 3)).toBe(LANDSCAPE_PHOTO_FRAME_RATIO)
    expect(getPhotoFrameRatio(16 / 9)).toBe(LANDSCAPE_PHOTO_FRAME_RATIO)
    expect(getPhotoFrameRatio(3)).toBe(LANDSCAPE_PHOTO_FRAME_RATIO)
  })

  it('limits portrait photos to 3:4, however tall they are', () => {
    expect(getPhotoFrameRatio(3 / 4)).toBe(PORTRAIT_PHOTO_FRAME_RATIO)
    expect(getPhotoFrameRatio(9 / 20)).toBe(PORTRAIT_PHOTO_FRAME_RATIO)
  })

  it('treats square photos and unknown sizes as landscape', () => {
    expect(getPhotoFrameRatio(1)).toBe(LANDSCAPE_PHOTO_FRAME_RATIO)
    expect(getPhotoFrameRatio(Number.NaN)).toBe(LANDSCAPE_PHOTO_FRAME_RATIO)
  })
})

describe('getPhotoFrameSize', () => {
  it('fits the long edge for both orientations', () => {
    expect(getPhotoFrameSize(16 / 9, 640)).toEqual({ width: 640, height: 480 })
    expect(getPhotoFrameSize(9 / 16, 640)).toEqual({ width: 480, height: 640 })
  })
})
