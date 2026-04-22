import Taro from '@tarojs/taro'

/** 微信 saveImageToPhotosAlbum fail 回调常见结构 */
export type WeappSaveImageErr = { errMsg?: string; errno?: number }

/**
 * 部分真机/正式包将临时文件路径表现为 `http(s)://tmp/...`，需转为 `wxfile://tmp/...` 再参与 saveFile / 存相册。
 * 与 `packageExtra/pages/analyze/index.tsx` 中逻辑一致。
 */
export function normalizeWeappTmpImagePath(path: string): string {
  const raw = (path || '').trim()
  if (!raw) return ''
  if (/^https?:\/\/tmp\//i.test(raw)) {
    return raw.replace(/^https?:\/\/tmp\//i, 'wxfile://tmp/')
  }
  return raw
}

const isTempImagePath = (path: string): boolean => {
  const raw = (path || '').trim()
  if (!raw) return false
  return /^https?:\/\/tmp\//i.test(raw) || /^wxfile:\/\/tmp\//i.test(raw)
}

/**
 * 将 canvas 导出的临时图规范并尽量落盘到 USER_DATA_PATH，避免真机上 `saveImageToPhotosAlbum` 因路径格式/临时失效而失败。
 */
export async function resolveImagePathForAlbumSave(src: string): Promise<string> {
  const raw = (src || '').trim()
  if (!raw) return ''
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return raw

  const userDataPath = (Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH
  if (!userDataPath) return normalizeWeappTmpImagePath(raw) || raw

  const normalized = normalizeWeappTmpImagePath(raw)
  if (!isTempImagePath(raw) && !isTempImagePath(normalized)) {
    try {
      const info = await Taro.getImageInfo({ src: raw })
      if (info.path) return info.path
    } catch {
      /* ignore */
    }
    return raw
  }

  const candidates: string[] = []
  const pushCandidate = (nextPath?: string): void => {
    const next = (nextPath || '').trim()
    if (!next || candidates.includes(next)) return
    candidates.push(next)
  }

  pushCandidate(raw)
  pushCandidate(normalized)

  for (const s of [raw, normalized]) {
    if (!s) continue
    try {
      const info = await Taro.getImageInfo({ src: s })
      if (info.path) pushCandidate(info.path)
    } catch {
      /* ignore */
    }
  }

  for (const tempFilePath of candidates) {
    const ext = (tempFilePath.match(/\.(jpg|jpeg|png|webp)(?:\?.*)?$/i)?.[0] || '.png').replace(/\?.*$/, '')
    const targetPath = `${userDataPath}/poster_album_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`
    try {
      const savedFilePath = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().saveFile({
          tempFilePath,
          filePath: targetPath,
          success: (res: { savedFilePath?: string }) => resolve(String(res?.savedFilePath || targetPath)),
          fail: reject
        })
      })
      if (savedFilePath) return savedFilePath
    } catch (err) {
      console.warn('[resolveImagePathForAlbumSave] saveFile failed, try next', tempFilePath, err)
    }
  }

  console.warn('[resolveImagePathForAlbumSave] all saveFile failed, fallback path', { raw, normalized, candidates })
  return normalized || raw
}

const isAuthError = (err: WeappSaveImageErr): boolean => {
  const msg = (err.errMsg || '').toLowerCase()
  return msg.includes('auth deny') || msg.includes('authorize') || msg.includes('auth denied')
}

/** 未在平台隐私保护指引中声明「保存到相册」时常见 */
const isPrivacyApiBlocked = (err: WeappSaveImageErr): boolean => {
  const msg = (err.errMsg || '').toLowerCase()
  return err.errno === 1025 || msg.includes('privacy') || msg.includes('banned')
}

export interface SavePosterToAlbumHandlers {
  onSuccess: () => void
  /** 需直接展示给用户的短提示（非授权类；授权由本函数内弹窗处理） */
  onToast: (message: string) => void
}

/**
 * 保存本地图片到系统相册（海报等）。会先解析/持久化临时路径，并区分授权失败、隐私未开放与文件问题。
 */
export async function savePosterToPhotosAlbum(filePath: string, handlers: SavePosterToAlbumHandlers): Promise<void> {
  const pathIn = (filePath || '').trim()
  if (!pathIn) {
    handlers.onToast('图片路径无效')
    return
  }

  let resolved: string
  try {
    resolved = await resolveImagePathForAlbumSave(pathIn)
  } catch (e) {
    console.error('[savePosterToPhotosAlbum] resolveImagePathForAlbumSave error', e)
    resolved = normalizeWeappTmpImagePath(pathIn) || pathIn
  }

  Taro.saveImageToPhotosAlbum({
    filePath: resolved,
    success: () => handlers.onSuccess(),
    fail: (err: WeappSaveImageErr) => {
      console.error('[savePosterToPhotosAlbum] saveImageToPhotosAlbum fail', err)
      if (isAuthError(err)) {
        Taro.showModal({
          title: '提示',
          content: '需要您授权保存图片到相册',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) Taro.openSetting()
          }
        })
        return
      }
      if (isPrivacyApiBlocked(err)) {
        Taro.showModal({
          title: '无法保存到相册',
          content:
            '正式版会校验「用户隐私保护指引」。请在微信公众平台为小程序补充「保存图片到相册/写入相册」等说明，并发布新版本。开发版不校验，故本地正常。',
          showCancel: false
        })
        return
      }
      const msg = (err.errMsg || '').toLowerCase()
      if (msg.includes('no such file') || msg.includes('not exist') || msg.includes('file not found')) {
        handlers.onToast('临时文件已失效，请关闭后重新生成海报再保存')
        return
      }
      handlers.onToast('保存失败，请重试')
    }
  })
}
