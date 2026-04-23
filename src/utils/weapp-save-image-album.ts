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
  const shouldTryPersist = isTempImagePath(raw) || isTempImagePath(normalized)

  if (!shouldTryPersist) {
    try {
      const info = await Taro.getFileSystemManager().getFileInfo({ filePath: raw })
      if (info.size > 0 && !raw.startsWith(userDataPath)) {
        // 非用户目录下的有效本地文件仍复制一份，规避部分机型对「非持久路径」存相册失败
        const ext = (raw.match(/\.(jpg|jpeg|png|webp)(?:\?.*)?$/i)?.[0] || '.jpg').replace(/\?.*$/, '')
        const targetPath = `${userDataPath}/poster_album_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`
        try {
          const saved = await new Promise<string>((resolve, reject) => {
            Taro.getFileSystemManager().saveFile({
              tempFilePath: raw,
              filePath: targetPath,
              success: (res: { savedFilePath?: string }) => resolve(String(res?.savedFilePath || targetPath)),
              fail: reject
            })
          })
          if (saved) return saved
        } catch {
          /* fall through */
        }
      }
    } catch {
      /* ignore */
    }
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
    } catch (err: any) {
      const errMsg = String(err?.errMsg || err?.message || err || '')
      // USER_DATA_PATH 已满或 tmp 路径无读取权限时，fallback 到规范化路径
      // 但必须先验证临时路径仍可读，避免返回已失效的路径
      if (
        errMsg.includes('exceeded the maximum size') ||
        errMsg.includes('permission denied')
      ) {
        const fallbackPath = normalized || raw
        try {
          const info = await Taro.getFileSystemManager().getFileInfo({ filePath: fallbackPath })
          if (info.size > 0) {
            console.warn('[resolveImagePathForAlbumSave] saveFile skipped due to storage/perm limit, fallback to normalized tmp path', tempFilePath)
            return fallbackPath
          }
        } catch {
          // fallback 路径已失效，不能返回，继续尝试下一个 candidate
        }
      }
      // no such file → 源临时路径已失效，继续尝试下一个 candidate
      console.warn('[resolveImagePathForAlbumSave] saveFile failed, try next', tempFilePath, err)
    }
  }

  console.warn('[resolveImagePathForAlbumSave] all saveFile failed, fallback path', { raw, normalized, candidates })
  const fallback = normalized || raw
  if (fallback) {
    try {
      const info = await Taro.getFileSystemManager().getFileInfo({ filePath: fallback })
      if (info.size > 0) return fallback
    } catch {
      // fallback 路径已失效
    }
  }
  return ''
}

const isAuthError = (err: WeappSaveImageErr): boolean => {
  const raw = err.errMsg || ''
  const msg = raw.toLowerCase()
  if (msg.includes('privacy')) return false
  return (
    msg.includes('auth deny') ||
    msg.includes('authorize') ||
    msg.includes('auth denied') ||
    msg.includes('permission denied') ||
    (msg.includes('permission') &&
      (msg.includes('album') || msg.includes('photo') || msg.includes('photos') || msg.includes('write'))) ||
    err.errno === 103 ||
    err.errno === 104 ||
    raw.includes('未授权') ||
    raw.includes('无权限')
  )
}

/** 保存前确认本地文件可读，避免临时路径已回收仍去调存相册 */
async function assertNonEmptyLocalFile(filePath: string): Promise<boolean> {
  const fp = (filePath || '').trim()
  if (!fp) return false
  try {
    const info = await Taro.getFileSystemManager().getFileInfo({ filePath: fp })
    return typeof info.size === 'number' && info.size > 0
  } catch {
    return false
  }
}

/** 未在平台隐私保护指引中声明「保存到相册」时常见 */
const isPrivacyApiBlocked = (err: WeappSaveImageErr): boolean => {
  const msg = (err.errMsg || '').toLowerCase()
  return err.errno === 1025 || msg.includes('privacy') || msg.includes('banned')
}

/**
 * 在保存前尽量触发一次相册授权（用户点击「保存」时已处于用户手势上下文，符合平台要求）。
 * 若用户曾选「拒绝」，返回 denied，由上层引导 openSetting。
 */
export async function ensureWritePhotosAlbumPermission(): Promise<'granted' | 'denied'> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return 'granted'
  try {
    const { authSetting } = await Taro.getSetting()
    if (authSetting['scope.writePhotosAlbum'] === true) return 'granted'
    if (authSetting['scope.writePhotosAlbum'] === false) return 'denied'
    try {
      await Taro.authorize({ scope: 'scope.writePhotosAlbum' })
      return 'granted'
    } catch {
      const { authSetting: s2 } = await Taro.getSetting()
      if (s2['scope.writePhotosAlbum'] === true) return 'granted'
      return 'denied'
    }
  } catch {
    return 'granted'
  }
}

export interface SavePosterToAlbumHandlers {
  onSuccess: () => void
  /** 需直接展示给用户的短提示（非授权类；授权由本函数内弹窗处理） */
  onToast: (message: string) => void
}

function promptOpenAlbumSettings(): void {
  Taro.showModal({
    title: '提示',
    content: '需要您授权保存图片到相册',
    confirmText: '去设置',
    success: (r) => {
      if (r.confirm) Taro.openSetting()
    }
  })
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

  if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    const perm = await ensureWritePhotosAlbumPermission()
    if (perm === 'denied') {
      promptOpenAlbumSettings()
      return
    }
  }

  let resolved: string
  try {
    resolved = await resolveImagePathForAlbumSave(pathIn)
  } catch (e) {
    console.error('[savePosterToPhotosAlbum] resolveImagePathForAlbumSave error', e)
    resolved = normalizeWeappTmpImagePath(pathIn) || pathIn
  }

  if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    let readable = await assertNonEmptyLocalFile(resolved)
    if (!readable) {
      try {
        resolved = await resolveImagePathForAlbumSave(pathIn)
        readable = await assertNonEmptyLocalFile(resolved)
      } catch {
        /* ignore */
      }
    }
    // 对 canvasToTempFilePath 等生成的临时路径，getFileInfo 可能因路径格式/权限返回 false
    // 若已确认不可读且不是临时路径特征，直接阻断；若是临时路径但已明确不可读，也重新解析一次
    const isTmpLike = isTempImagePath(resolved) || isTempImagePath(pathIn)
    if (!readable && !isTmpLike) {
      handlers.onToast('图片未就绪或已失效，请重新打开海报后再保存')
      return
    }
    if (!readable && isTmpLike && !resolved) {
      handlers.onToast('图片已失效，请重新生成海报后再保存')
      return
    }
  }

  const runSave = (fp: string): Promise<void> =>
    new Promise((resolve, reject) => {
      Taro.saveImageToPhotosAlbum({
        filePath: fp,
        success: () => resolve(),
        fail: reject
      })
    })

  const handleFail = (err: WeappSaveImageErr): void => {
    console.error('[savePosterToPhotosAlbum] saveImageToPhotosAlbum fail', err)
    if (isAuthError(err)) {
      promptOpenAlbumSettings()
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

  try {
    await runSave(resolved)
    handlers.onSuccess()
  } catch (firstErr) {
    const fe = firstErr as WeappSaveImageErr
    if (isAuthError(fe) || isPrivacyApiBlocked(fe)) {
      handleFail(fe)
      return
    }
    try {
      const again = await resolveImagePathForAlbumSave(pathIn)
      if (again && again !== resolved) {
        await runSave(again)
        handlers.onSuccess()
        return
      }
    } catch {
      /* fall through */
    }
    handleFail(fe)
  }
}
