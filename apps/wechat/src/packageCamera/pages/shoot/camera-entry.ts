import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getTodayRecordDateKey, resolveNewRecordDate } from '../../../utils/record-date'

/** 相机页底部的其他记录方式；拍照本身不在这里。 */
export type CameraSideEntry = 'text' | 'library' | 'favorites' | 'history'

export interface CameraRecordDate {
  date: string
  /** 传进来的日期不在可记录范围里，已改成今天 */
  fellBackToToday: boolean
  backfill: boolean
}

/** 新拍摄默认今天，只有明确的补录路由能保留有效历史日期。 */
export function resolveCameraRecordDate(raw?: string | null, explicitBackfill = false): CameraRecordDate {
  return resolveNewRecordDate(raw, explicitBackfill)
}

export function buildCameraEntryUrl(entry: CameraSideEntry, date: string, explicitBackfill = false): string {
  const target = resolveCameraRecordDate(date, explicitBackfill)
  const query = `?date=${encodeURIComponent(target.date)}${target.backfill ? '&backfill=1' : ''}`
  switch (entry) {
    case 'text':
      return `${extraPkgUrl('/pages/record-text/index')}${query}`
    case 'library':
      return `${extraPkgUrl('/pages/record-manual/index')}${query}`
    case 'favorites':
      return `${extraPkgUrl('/pages/recipes/index')}${query}`
    case 'history':
      return extraPkgUrl('/pages/analyze-history/index')
  }
}

/** 「记到 11月8日」；今天显示「记到今天」。 */
export function formatCameraDateChip(date: string): string {
  if (date === getTodayRecordDateKey()) return '记到今天'
  const matched = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  if (!matched) return '记到今天'
  return `记到 ${Number(matched[1])}月${Number(matched[2])}日`
}

export function buildLoginRedirectUrl(cameraPath: string): string {
  return `${extraPkgUrl('/pages/login/index')}?redirect=${encodeURIComponent(cameraPath)}`
}
