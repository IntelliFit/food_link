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

/** 读数可信（两个模型一致，或只有一个读出且没有分歧）时才拿来核对填写值。 */
const confirmed = (reading?: PhotoReading) =>
  Boolean(reading && typeof reading.grams === 'number' && (reading.agreement === 'agree' || reading.agreement === 'single'))

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
  if (reading.agreement === 'disagree') return { text: reading.message || '两次读数不一致，建议重拍', warn: true }
  return { text: `${reading.message || '没读清秤上的数字'}；不重拍也能提交，但这条不计分`, warn: true }
}

/** 自动读出的克重，填进空着的或和上次自动填的值相同的输入框。 */
export function autofillValue(current: string, previous: PhotoReading | undefined, next: PhotoReading): string | null {
  if (!confirmed(next)) return null
  const trimmed = String(current).trim()
  const previousValue = typeof previous?.grams === 'number' ? String(previous.grams) : ''
  if (trimmed && trimmed !== previousValue) return null
  return String(next.grams)
}
