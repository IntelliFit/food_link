import type { ScaleAgreement, ScaleReadingResult } from '../../../utils/research-weight-api'

/** 一张秤照片的自动读数结果，跟着照片存在草稿里。 */
export interface PhotoReading {
  grams?: number
  agreement: ScaleAgreement
  message: string
  resolution?: number
}

interface ReadablePhoto {
  reading?: PhotoReading
}

export function toPhotoReading(result: ScaleReadingResult): PhotoReading {
  return {
    agreement: result.agreement,
    message: result.message || '',
    ...(result.readable && typeof result.grams === 'number' ? { grams: result.grams } : {}),
    ...(typeof result.resolution_grams === 'number' && result.resolution_grams > 0 ? { resolution: result.resolution_grams } : {}),
  }
}

const hasGrams = (reading?: PhotoReading) => Boolean(reading && typeof reading.grams === 'number')
/** 两个模型读数一致才拦提交：和服务端一样，只有这种情况会被直接驳回。 */
const confirmed = (reading?: PhotoReading) => hasGrams(reading) && reading?.agreement === 'agree'
/** 只有一个模型读出：可以帮忙填数，但只提醒、不拦提交。 */
const single = (reading?: PhotoReading) => hasGrams(reading) && reading?.agreement === 'single'

const formatReading = (grams: number) => (Number.isInteger(grams) ? `${grams}g` : `${grams.toFixed(1)}g`)

/**
 * 填的读数和照片里秤上的数字对不上时返回提示，否则返回空字符串。
 * 容差与后端一致：秤的精度、显示屏的最小步长和 1g 取最大。
 */
export function readingProblem(label: string, typed: string, photo: ReadablePhoto | undefined, precision: number): string {
  const reading = photo?.reading
  if (!confirmed(reading)) return ''
  const value = Number(String(typed).trim())
  if (!String(typed).trim() || !Number.isFinite(value)) return ''
  const tolerance = Math.max(precision, reading?.resolution ?? 1, 1)
  if (Math.abs(value - (reading?.grams ?? 0)) <= tolerance + 1e-9) return ''
  return `${label}填的是 ${formatReading(value)}，照片里是 ${formatReading(reading?.grams ?? 0)}，请改正或重拍`
}

/** 照片下方的一行说明：读出了什么、读不出时怎么办。 */
export function readingNote(photo: ReadablePhoto | undefined): { text: string; warn: boolean } | null {
  const reading = photo?.reading
  if (!reading) return null
  if (confirmed(reading)) return { text: reading.message || `已读出 ${formatReading(reading.grams ?? 0)}`, warn: false }
  if (single(reading)) return { text: `只读到一次：${formatReading(reading.grams ?? 0)}，请自己核对一下`, warn: true }
  if (reading.agreement === 'disagree') return { text: reading.message || '两次读数不一致，建议重拍', warn: true }
  return { text: `${reading.message || '没读清秤上的数字'}；不重拍也能提交，但这条不计分`, warn: true }
}

/** 自动读出的克重只填进空着的输入框，不覆盖手填的值。 */
export function autofillValue(current: string, next: PhotoReading): string | null {
  if (!confirmed(next) && !single(next)) return null
  if (String(current).trim()) return null
  return String(next.grams)
}

/** 换照片前，输入框里的值是不是从旧照片自动填的（是就清掉，等新照片的读数）。 */
export function filledFrom(value: string, photo: ReadablePhoto | undefined): boolean {
  const grams = photo?.reading?.grams
  return typeof grams === 'number' && String(grams) === String(value).trim()
}
