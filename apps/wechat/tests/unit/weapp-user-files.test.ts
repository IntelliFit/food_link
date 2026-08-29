import Taro from '@tarojs/taro'

import { uploadAnalyzeImageFile } from '../../src/utils/api'
import {
  isPublicHttpImageURL,
  isWeappLocalFilePath,
  normalizeWeappLocalFilePath,
} from '../../src/utils/weapp-user-files'

describe('微信本地虚拟文件路径', () => {
  it.each([
    ['http://tmp/photo.png', 'wxfile://tmp/photo.png'],
    ['https://tmp/photo.png', 'wxfile://tmp/photo.png'],
    ['http://usr/analyze_123.png', 'wxfile://usr/analyze_123.png'],
    ['https://usr/analyze_123.png', 'wxfile://usr/analyze_123.png'],
  ])('将开发者工具路径 %s 还原为 %s', (input, expected) => {
    expect(normalizeWeappLocalFilePath(input)).toBe(expected)
    expect(isWeappLocalFilePath(input)).toBe(true)
    expect(isPublicHttpImageURL(input)).toBe(false)
  })

  it('保留真正的公网图片 URL', () => {
    const url = 'https://cdn-food-images.coachlink.fit/user/image.png'
    expect(normalizeWeappLocalFilePath(url)).toBe(url)
    expect(isWeappLocalFilePath(url)).toBe(false)
    expect(isPublicHttpImageURL(url)).toBe(true)
  })

  it('文件直传保留开发者工具的 http://usr 本地路径', async () => {
    const uploadFile = Taro.uploadFile as jest.Mock
    uploadFile.mockImplementationOnce((options: any) => {
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          code: 0,
          data: { imageUrl: 'https://cdn-food-images.coachlink.fit/uploaded.png' },
        }),
        header: {},
      })
    })

    await expect(uploadAnalyzeImageFile('http://usr/analyze_123.png')).resolves.toEqual({
      imageUrl: 'https://cdn-food-images.coachlink.fit/uploaded.png',
    })
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'http://usr/analyze_123.png',
    }))
  })
})
