import type {
  ResearchContainer,
  ResearchPhotoPayload,
  ResearchPhotoRole,
  ResearchReference,
  ResearchSamplePayload,
  ResearchScene,
  ResearchTareMode,
  ResearchWeighingMode,
} from '../../../utils/research-weight-api'

/** 与后端 domain.ConsentVersion 保持一致；授权文案变化时两边一起升级。 */
export const RESEARCH_CONSENT_VERSION = '2026-10-28'
export const MAX_ITEMS = 12
export const MAX_NET_GRAMS = 5000
export const MAX_READING_GRAMS = 10000

export const SCENES: Array<{ key: ResearchScene; label: string }> = [
  { key: 'canteen', label: '食堂' },
  { key: 'home', label: '家里' },
  { key: 'takeout', label: '外卖' },
  { key: 'restaurant', label: '餐馆' },
  { key: 'other', label: '其他' },
]
export const CONTAINERS: Array<{ key: ResearchContainer; label: string }> = [
  { key: 'bowl', label: '碗' },
  { key: 'plate', label: '盘' },
  { key: 'tray', label: '餐盘' },
  { key: 'box', label: '餐盒' },
  { key: 'other', label: '其他' },
]
export const REFERENCES: Array<{ key: ResearchReference; label: string }> = [
  { key: 'none', label: '不拍' },
  { key: 'chopsticks', label: '筷子' },
  { key: 'spoon', label: '勺子' },
  { key: 'card', label: '卡片' },
  { key: 'hand', label: '手' },
  { key: 'other', label: '其他' },
]
export const PRECISIONS = [0.1, 1, 2]

export interface DraftPhoto {
  url: string
  capturedAt: string
}

export interface DraftItem {
  id: string
  name: string
  reading: string
  containsBone: boolean
  containsSoup: boolean
  photo?: DraftPhoto
}

export interface ResearchDraft {
  clientKey: string
  scene: ResearchScene
  mode: ResearchWeighingMode
  dishName: string
  venueName: string
  city: string
  container: ResearchContainer
  precision: number
  tareMode: ResearchTareMode
  tare: string
  gross: string
  items: DraftItem[]
  reference: ResearchReference
  notes: string
  videoUrl: string
  photos: Partial<Record<Exclude<ResearchPhotoRole, 'item_scale'>, DraftPhoto>>
}

export function newClientKey(now = Date.now()): string {
  return `rw-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newItem(seed = Date.now()): DraftItem {
  return { id: `item-${seed.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: '', reading: '', containsBone: false, containsSoup: false }
}

export function emptyDraft(now = Date.now()): ResearchDraft {
  return {
    clientKey: newClientKey(now), scene: 'canteen', mode: 'whole', dishName: '', venueName: '', city: '',
    container: 'bowl', precision: 1, tareMode: 'measured', tare: '', gross: '', items: [newItem(now)],
    reference: 'none', notes: '', videoUrl: '', photos: {},
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10

/** 读数输入框是字符串；空或非法时返回 null。与后端一样先按 0.1g 取整再比较。 */
export function parseGrams(raw: string): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? round1(value) : null
}

export function tareGrams(draft: ResearchDraft): number | null {
  return draft.tareMode === 'zeroed' ? 0 : parseGrams(draft.tare)
}

/** 每项增量 = 本次读数 − 上一次读数（第一项减皮重）；读数缺失时为 null。 */
export function itemIncrements(draft: ResearchDraft): Array<number | null> {
  let previous = tareGrams(draft)
  return draft.items.map((item) => {
    const reading = parseGrams(item.reading)
    if (reading === null || previous === null) {
      previous = reading
      return null
    }
    const increment = round1(reading - previous)
    previous = reading
    return increment
  })
}

export function netGrams(draft: ResearchDraft): number | null {
  const tare = tareGrams(draft)
  if (tare === null) return null
  if (draft.mode === 'whole') {
    const gross = parseGrams(draft.gross)
    return gross === null ? null : round1(gross - tare)
  }
  const last = parseGrams(draft.items[draft.items.length - 1]?.reading ?? '')
  return last === null ? null : round1(last - tare)
}

/** 返回第一条未完成的提示；全部完成时返回空字符串。规则与后端 BuildSample 一致。 */
export function draftProblem(draft: ResearchDraft): string {
  if (!draft.dishName.trim()) return '请填写菜名'
  const tare = tareGrams(draft)
  if (draft.tareMode === 'measured' && (tare === null || tare <= 0 || tare > MAX_READING_GRAMS)) return '请填写空容器的读数'
  if (!draft.photos.tare_scale) return '请拍空容器（或归零）时的秤上读数'
  if (draft.mode === 'whole') {
    const gross = parseGrams(draft.gross)
    if (gross === null || tare === null || gross <= tare || gross > MAX_READING_GRAMS) return '总读数必须大于空容器读数'
    if (!draft.photos.gross_scale) return '请拍连容器的秤上总读数'
  } else {
    if (draft.items.length === 0) return '请至少添加一项'
    const increments = itemIncrements(draft)
    for (let index = 0; index < draft.items.length; index += 1) {
      const item = draft.items[index]
      if (!item.name.trim()) return `请填写第${index + 1}项的名称`
      const increment = increments[index]
      const reading = parseGrams(item.reading)
      if (increment === null || increment <= 0 || reading === null || reading > MAX_READING_GRAMS) return `第${index + 1}项的秤上读数必须大于上一次读数`
      if (!item.photo) return `请拍第${index + 1}项的秤上读数`
    }
  }
  const net = netGrams(draft)
  if (net === null || net <= 0) return '净重必须大于0'
  if (net > MAX_NET_GRAMS) return '单份食物不能超过5000g'
  if (!draft.photos.eval_top) return '请拍一张俯拍照片'
  if (!draft.photos.eval_angle) return '请拍一张约45°的照片'
  const refCount = Number(Boolean(draft.photos.eval_top_ref)) + Number(Boolean(draft.photos.eval_angle_ref))
  if (draft.reference !== 'none' && refCount === 0) return '选择了参照物，请补拍参照物照片'
  return ''
}

function photoPayload(role: ResearchPhotoRole, photo: DraftPhoto, itemIndex?: number): ResearchPhotoPayload {
  return { role, url: photo.url, captured_at: photo.capturedAt, ...(itemIndex === undefined ? {} : { item_index: itemIndex }) }
}

/** 只提交与当前称量方式和参照物相符的照片，切换方式后残留的照片不会带上。 */
export function buildPayload(draft: ResearchDraft, device: Record<string, string>): ResearchSamplePayload {
  const roles: Array<Exclude<ResearchPhotoRole, 'item_scale'>> = ['tare_scale', 'eval_top', 'eval_angle']
  if (draft.mode === 'whole') roles.push('gross_scale')
  if (draft.reference !== 'none') roles.push('eval_top_ref', 'eval_angle_ref')
  const photos: ResearchPhotoPayload[] = []
  roles.forEach((role) => {
    const photo = draft.photos[role]
    if (photo) photos.push(photoPayload(role, photo))
  })
  if (draft.mode === 'itemized') {
    draft.items.forEach((item, index) => {
      if (item.photo) photos.push(photoPayload('item_scale', item.photo, index))
    })
  }
  const gross = parseGrams(draft.gross)
  return {
    client_key: draft.clientKey,
    scene: draft.scene,
    weighing_mode: draft.mode,
    dish_name: draft.dishName.trim(),
    venue_name: draft.venueName.trim(),
    city: draft.city.trim(),
    container_type: draft.container,
    tare_mode: draft.tareMode,
    tare_grams: tareGrams(draft) ?? 0,
    ...(draft.mode === 'whole' && gross !== null ? { gross_reading_grams: gross } : {}),
    scale_precision_grams: draft.precision,
    items: draft.mode === 'itemized'
      ? draft.items.map((item) => ({
        name: item.name.trim(),
        cumulative_reading_grams: parseGrams(item.reading) ?? 0,
        contains_bone: item.containsBone,
        contains_soup: item.containsSoup,
      }))
      : [],
    photos,
    reference_object: draft.reference,
    ...(draft.videoUrl ? { video_url: draft.videoUrl } : {}),
    device,
    notes: draft.notes.trim(),
    consent_version: RESEARCH_CONSENT_VERSION,
  }
}

/**
 * 提交成功后开始下一份：保留场景、地点、容器、秤和去皮设置（含皮重照片，
 * 食堂同款碗只需称一次），清空本份的读数与评测照片。
 */
export function nextDraftAfterSubmit(draft: ResearchDraft, now = Date.now()): ResearchDraft {
  return {
    ...emptyDraft(now),
    scene: draft.scene, mode: draft.mode, venueName: draft.venueName, city: draft.city,
    container: draft.container, precision: draft.precision, tareMode: draft.tareMode,
    tare: draft.tare, reference: draft.reference,
    photos: draft.photos.tare_scale ? { tare_scale: draft.photos.tare_scale } : {},
  }
}

export const STATUS_LABELS: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '未通过' }
