import Taro from '@tarojs/taro'

/**
 * 将 data URL / 网络图转为 Canvas 2D createImage 可用的本地路径。
 * 真机与部分基础库下直接赋 data:image 给 img.src 可能无法解码，需落盘后再加载。
 */
export async function resolveCanvasImageSrc(src: string): Promise<string> {
  const raw = (src || '').trim()
  if (!raw) return ''

  if (/^data:image\//i.test(raw)) {
    const compact = raw.replace(/\s/g, '')
    const m = /^data:image\/[^;]+;base64,(.+)$/i.exec(compact)
    if (!m) return raw
    const userDataPath = (Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH
    if (!userDataPath) return raw
    const path = `${userDataPath}/cv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`
    try {
      await new Promise<void>((resolve, reject) => {
        Taro.getFileSystemManager().writeFile({
          filePath: path,
          data: m[1],
          encoding: 'base64',
          success: () => resolve(),
          fail: reject
        })
      })
      return path
    } catch (e) {
      console.warn('[resolveCanvasImageSrc] data URI writeFile failed', e)
      return raw
    }
  }

  if (/^https?:\/\//.test(raw)) {
    try {
      const info = await Taro.getImageInfo({ src: raw })
      return info.path || raw
    } catch (e) {
      console.warn('[resolveCanvasImageSrc] getImageInfo failed', e)
      return raw
    }
  }

  return raw
}
