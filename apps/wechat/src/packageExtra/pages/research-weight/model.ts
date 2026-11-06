import type {
  ResearchContainer,
  ResearchContainerInput,
  ResearchPhotoPayload,
  ResearchPhotoRole,
  ResearchReference,
  ResearchSamplePayload,
  ResearchScene,
  ResearchTareSource,
  ResearchWeighingMode,
  SavedResearchContainer,
} from '../../../utils/research-weight-api'
import { readingProblem, type PhotoReading } from './reading'

/** 与后端 domain.ConsentVersion 保持一致；授权文案变化时两边一起升级。 */
export const RESEARCH_CONSENT_VERSION = '2026-10-28'
export const MAX_ITEMS = 12
export const MAX_CONTAINERS = 8
export const MAX_NET_GRAMS = 5000
export const MAX_READING_GRAMS = 10000
export const MAX_TOTAL_GRAMS = 10000
/** 常用容器的重量上限，与后端 MaxContainerGrams 一致。 */
export const MAX_CONTAINER_GRAMS = 3000

export const SCENES: Array<{ key: ResearchScene; label: string }> = [
  { key: 'takeout', label: '外卖' },
  { key: 'canteen', label: '食堂' },
  { key: 'home', label: '家里' },
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
export const TARE_SOURCES: Array<{ key: ResearchTareSource; label: string }> = [
  { key: 'after_meal', label: '吃完再称' },
  { key: 'measured', label: '先称空的' },
  { key: 'zeroed', label: '秤已归零' },
  { key: 'library', label: '常用容器' },
]
export const PRECISIONS = [0.1, 1, 2]

export interface DraftPhoto {
  url: string
  capturedAt: string
  /** 饭菜照片只允许现拍，记为 camera；秤的照片不区分来源。 */
  source?: 'camera' | 'album'
  /** 秤的照片：服务端自动读出的数字。 */
  reading?: PhotoReading
}

/** 从高校共建活动页进入时带上的称重日和菜品。 */
export interface CampusContext {
  stationSessionId?: string
  catalogItemId?: string
  label: string
}

/** 分项累加：同一个容器里依次加入的一样食物。 */
export interface DraftItem {
  id: string
  name: string
  reading: string
  containsBone: boolean
  containsSoup: boolean
  photo?: DraftPhoto
}

/** 按盒称：一个外卖盒或一只碗，自己的连盒读数和皮重。 */
export interface DraftContainer {
  id: string
  name: string
  gross: string
  grossPhoto?: DraftPhoto
  tareSource: ResearchTareSource
  tare: string
  tarePhoto?: DraftPhoto
  libraryId: string
  saveToLibrary: boolean
  libraryName: string
  containsBone: boolean
  containsSoup: boolean
}

export type EvalRole = 'eval_top' | 'eval_angle' | 'eval_top_ref' | 'eval_angle_ref'

export interface ResearchDraft {
  clientKey: string
  startedAt: string
  scene: ResearchScene
  mode: Exclude<ResearchWeighingMode, 'whole'>
  dishName: string
  venueName: string
  city: string
  precision: number
  containers: DraftContainer[]
  container: ResearchContainer
  tareSource: ResearchTareSource
  tare: string
  tareLibraryId: string
  tarePhoto?: DraftPhoto
  items: DraftItem[]
  reference: ResearchReference
  notes: string
  videoUrl: string
  photos: Partial<Record<EvalRole, DraftPhoto>>
  campus?: CampusContext
}

export type Library = Record<string, SavedResearchContainer>

const randomPart = () => Math.random().toString(36).slice(2, 8)

export function newClientKey(now = Date.now()): string {
  return `rw-${now.toString(36)}-${randomPart()}${randomPart()}`
}

/** 外卖默认吃完再称空盒，其余场景默认先称空容器。 */
export function defaultTareSource(scene: ResearchScene): ResearchTareSource {
  return scene === 'takeout' ? 'after_meal' : 'measured'
}

export function newItem(seed = Date.now()): DraftItem {
  return { id: `item-${seed.toString(36)}-${randomPart()}`, name: '', reading: '', containsBone: false, containsSoup: false }
}

export function newContainer(tareSource: ResearchTareSource = 'after_meal', seed = Date.now()): DraftContainer {
  return {
    id: `box-${seed.toString(36)}-${randomPart()}`, name: '', gross: '', tareSource, tare: '', libraryId: '',
    saveToLibrary: false, libraryName: '', containsBone: false, containsSoup: false,
  }
}

export function emptyDraft(now = Date.now()): ResearchDraft {
  return {
    clientKey: newClientKey(now), startedAt: new Date(now).toISOString(), scene: 'takeout', mode: 'multi',
    dishName: '', venueName: '', city: '', precision: 1, containers: [newContainer('after_meal', now)],
    container: 'bowl', tareSource: 'measured', tare: '', tareLibraryId: '', items: [newItem(now)],
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

function tareGrams(source: ResearchTareSource, tare: string, libraryId: string, library: Library): number | null {
  if (source === 'zeroed') return 0
  if (source === 'library') return library[libraryId] ? round1(library[libraryId].grams) : null
  return parseGrams(tare)
}

export function containerNet(container: DraftContainer, library: Library): number | null {
  const gross = parseGrams(container.gross)
  const tare = tareGrams(container.tareSource, container.tare, container.libraryId, library)
  return gross === null || tare === null ? null : round1(gross - tare)
}

/** 分项累加的每项增量 = 本次读数 − 上一次读数（第一项减皮重）。 */
export function itemIncrements(draft: ResearchDraft, library: Library): Array<number | null> {
  let previous = tareGrams(draft.tareSource, draft.tare, draft.tareLibraryId, library)
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

/** 整顿净重；有任何一盒还算不出来时返回 null。 */
export function netGrams(draft: ResearchDraft, library: Library): number | null {
  if (draft.mode === 'multi') {
    const nets = draft.containers.map((container) => containerNet(container, library))
    return nets.some((net) => net === null) ? null : round1((nets as number[]).reduce((sum, net) => sum + net, 0))
  }
  const tare = tareGrams(draft.tareSource, draft.tare, draft.tareLibraryId, library)
  const last = parseGrams(draft.items[draft.items.length - 1]?.reading ?? '')
  return tare === null || last === null ? null : round1(last - tare)
}

const needsTareReading = (source: ResearchTareSource) => source === 'measured' || source === 'after_meal'

/**
 * 换皮重来源时，旧的空盒照片和读数只在"先称"和"吃完称"之间通用；
 * 换成归零或常用容器（或反过来）就清掉，免得一张 18g 的照片被当成归零证据。
 */
export function tareSwitchPatch(from: ResearchTareSource, to: ResearchTareSource): { tare?: string; tarePhoto?: undefined } {
  if (from === to || (needsTareReading(from) && needsTareReading(to))) return {}
  return { tare: '', tarePhoto: undefined }
}

export interface DraftCheck {
  /** 第一条未完成的提示；全部完成时为空字符串。 */
  problem: string
  /** 只差吃完后再称的空盒，可以先去吃饭。 */
  waitingForMeal: boolean
}

const AFTER_MEAL = 'after_meal'

function checkTare(label: string, source: ResearchTareSource, tare: string, photo: DraftPhoto | undefined, libraryId: string, library: Library): string {
  if (source === 'library') return library[libraryId] ? '' : `${label}选一个常用容器`
  if (source === 'zeroed') return photo ? '' : `拍${label}归零时的读数`
  const value = parseGrams(tare)
  if (value !== null && value > 0 && value <= MAX_READING_GRAMS && photo) return ''
  // 吃完再称：什么都还没填才算"等吃完"；拍了照或填了数，就提示缺的那一项。
  if (source === 'after_meal' && value === null && !photo) return AFTER_MEAL
  return value === null || value <= 0 ? `填${label}空容器的读数` : `拍${label}空容器的读数`
}

const problemOnly = (problem: string): DraftCheck => ({ problem, waitingForMeal: false })

/** 皮重照片的读数核对：归零时秤上应该是 0，常用容器不用核对。 */
function tareReadingProblem(label: string, source: ResearchTareSource, tare: string, photo: DraftPhoto | undefined, precision: number): string {
  if (source === 'library') return ''
  return readingProblem(label, source === 'zeroed' ? '0' : tare, photo, precision)
}

function checkContainers(draft: ResearchDraft, library: Library): DraftCheck {
  let waitingForMeal = false
  for (let index = 0; index < draft.containers.length; index += 1) {
    const container = draft.containers[index]
    const label = `第${index + 1}盒`
    if (!container.name.trim()) return problemOnly(`给${label}起个名字，如 米饭`)
    const gross = parseGrams(container.gross)
    if (gross === null || gross <= 0 || gross > MAX_READING_GRAMS) return problemOnly(`填${label}连盒的读数`)
    if (!container.grossPhoto) return problemOnly(`拍${label}连盒的读数`)
    const grossMismatch = readingProblem(`${label}连盒读数`, container.gross, container.grossPhoto, draft.precision)
    if (grossMismatch) return problemOnly(grossMismatch)
    const tareProblem = checkTare(label, container.tareSource, container.tare, container.tarePhoto, container.libraryId, library)
    if (tareProblem === AFTER_MEAL) {
      waitingForMeal = true
      continue
    }
    if (tareProblem) return problemOnly(tareProblem)
    const tareMismatch = tareReadingProblem(`${label}空盒读数`, container.tareSource, container.tare, container.tarePhoto, draft.precision)
    if (tareMismatch) return problemOnly(tareMismatch)
    const net = containerNet(container, library)
    if (net === null || net <= 0) return problemOnly(`${label}的连盒读数必须大于空盒重量`)
    if (net > MAX_NET_GRAMS) return problemOnly('单盒食物不能超过5000g')
  }
  if (waitingForMeal) return { problem: '吃完回来称空盒', waitingForMeal: true }
  const total = netGrams(draft, library)
  if (total !== null && total > MAX_TOTAL_GRAMS) return problemOnly('一顿饭不能超过10000g')
  return problemOnly('')
}

function checkItemized(draft: ResearchDraft, library: Library): DraftCheck {
  const tareProblem = checkTare('', draft.tareSource, draft.tare, draft.tarePhoto, draft.tareLibraryId, library)
  if (tareProblem && tareProblem !== AFTER_MEAL) return problemOnly(tareProblem)
  const tareMismatch = tareProblem ? '' : tareReadingProblem('空容器读数', draft.tareSource, draft.tare, draft.tarePhoto, draft.precision)
  if (tareMismatch) return problemOnly(tareMismatch)
  if (draft.items.length === 0) return problemOnly('请至少添加一项')
  const increments = itemIncrements(draft, library)
  for (let index = 0; index < draft.items.length; index += 1) {
    const item = draft.items[index]
    if (!item.name.trim()) return problemOnly(`请填写第${index + 1}项的名称`)
    const reading = parseGrams(item.reading)
    if (reading === null || reading > MAX_READING_GRAMS) return problemOnly(`填第${index + 1}项的秤上读数`)
    if (!item.photo) return problemOnly(`拍第${index + 1}项的秤上读数`)
    const itemMismatch = readingProblem(`第${index + 1}项读数`, item.reading, item.photo, draft.precision)
    if (itemMismatch) return problemOnly(itemMismatch)
    const increment = increments[index]
    if (tareProblem !== AFTER_MEAL && (increment === null || increment <= 0)) {
      return problemOnly(`第${index + 1}项的秤上读数必须大于上一次读数`)
    }
  }
  if (tareProblem === AFTER_MEAL) return { problem: '吃完回来称空容器', waitingForMeal: true }
  const net = netGrams(draft, library)
  if (net === null || net <= 0) return problemOnly('第1项的秤上读数必须大于空容器重量')
  if (net > MAX_NET_GRAMS) return problemOnly('单份食物不能超过5000g')
  return problemOnly('')
}

/** 规则与后端 BuildSample 一致；评测照片至少一张即可。 */
export function checkDraft(draft: ResearchDraft, library: Library): DraftCheck {
  if (!draft.dishName.trim()) return problemOnly('写一下这顿吃的什么')
  if (!draft.photos.eval_top && !draft.photos.eval_angle) return problemOnly('先拍一张整顿饭的照片')
  const weighing = draft.mode === 'multi' ? checkContainers(draft, library) : checkItemized(draft, library)
  if (weighing.problem && !weighing.waitingForMeal) return weighing
  const refCount = Number(Boolean(draft.photos.eval_top_ref)) + Number(Boolean(draft.photos.eval_angle_ref))
  if (draft.reference !== 'none' && refCount === 0) return problemOnly('选择了参照物，请补拍参照物照片')
  return weighing
}

function photoPayload(role: ResearchPhotoRole, photo: DraftPhoto, itemIndex?: number): ResearchPhotoPayload {
  return {
    role, url: photo.url, captured_at: photo.capturedAt,
    ...(photo.source ? { source: photo.source } : {}),
    ...(itemIndex === undefined ? {} : { item_index: itemIndex }),
  }
}

function evalPhotos(draft: ResearchDraft): ResearchPhotoPayload[] {
  const roles: EvalRole[] = ['eval_top', 'eval_angle']
  if (draft.reference !== 'none') roles.push('eval_top_ref', 'eval_angle_ref')
  return roles.flatMap((role) => {
    const photo = draft.photos[role]
    return photo ? [photoPayload(role, photo)] : []
  })
}

function multiPayload(draft: ResearchDraft, library: Library): Pick<ResearchSamplePayload, 'items' | 'photos'> {
  const photos = evalPhotos(draft)
  const items = draft.containers.map((container, index) => {
    const saved = container.tareSource === 'library' ? library[container.libraryId] : undefined
    if (container.grossPhoto) photos.push(photoPayload('container_gross', container.grossPhoto, index))
    if (container.tareSource !== 'library' && container.tarePhoto) photos.push(photoPayload('container_tare', container.tarePhoto, index))
    return {
      name: container.name.trim(),
      cumulative_reading_grams: 0,
      gross_reading_grams: parseGrams(container.gross) ?? 0,
      tare_source: container.tareSource,
      ...(needsTareReading(container.tareSource) ? { tare_grams: parseGrams(container.tare) ?? 0 } : {}),
      ...(saved ? { container_id: saved.id } : {}),
      ...(draft.scene === 'takeout' && !saved ? { container_type: 'box' as ResearchContainer } : {}),
      contains_bone: container.containsBone,
      contains_soup: container.containsSoup,
    }
  })
  return { items, photos }
}

function itemizedPayload(draft: ResearchDraft): Pick<ResearchSamplePayload, 'items' | 'photos'> {
  const photos = evalPhotos(draft)
  if (draft.tareSource !== 'library' && draft.tarePhoto) photos.push(photoPayload('tare_scale', draft.tarePhoto))
  draft.items.forEach((item, index) => {
    if (item.photo) photos.push(photoPayload('item_scale', item.photo, index))
  })
  const items = draft.items.map((item) => ({
    name: item.name.trim(),
    cumulative_reading_grams: parseGrams(item.reading) ?? 0,
    contains_bone: item.containsBone,
    contains_soup: item.containsSoup,
  }))
  return { items, photos }
}

export function buildPayload(draft: ResearchDraft, library: Library, device: Record<string, string>): ResearchSamplePayload {
  const multi = draft.mode === 'multi'
  const weighed = multi ? multiPayload(draft, library) : itemizedPayload(draft)
  const sampleContainer: ResearchContainer = multi ? (draft.scene === 'takeout' ? 'box' : 'other') : draft.container
  return {
    client_key: draft.clientKey,
    scene: draft.scene,
    weighing_mode: draft.mode,
    dish_name: draft.dishName.trim(),
    venue_name: draft.venueName.trim(),
    city: draft.city.trim(),
    container_type: sampleContainer,
    tare_mode: multi ? 'per_container' : draft.tareSource,
    tare_grams: !multi && needsTareReading(draft.tareSource) ? parseGrams(draft.tare) ?? 0 : 0,
    ...(!multi && draft.tareSource === 'library' ? { container_id: draft.tareLibraryId } : {}),
    scale_precision_grams: draft.precision,
    items: weighed.items,
    photos: weighed.photos,
    reference_object: draft.reference,
    ...(draft.videoUrl ? { video_url: draft.videoUrl } : {}),
    device,
    notes: draft.notes.trim(),
    consent_version: RESEARCH_CONSENT_VERSION,
    ...(draft.campus?.stationSessionId ? { station_session_id: draft.campus.stationSessionId } : {}),
    ...(draft.campus?.catalogItemId ? { catalog_item_id: draft.campus.catalogItemId } : {}),
  }
}

/** 提交成功后要存进常用容器的空盒：称过重量、拍过照片、勾选了保存。 */
export function containersToSave(draft: ResearchDraft): ResearchContainerInput[] {
  if (draft.mode !== 'multi') return []
  return draft.containers.flatMap((container) => {
    const grams = parseGrams(container.tare)
    if (!container.saveToLibrary || !needsTareReading(container.tareSource) || !container.tarePhoto || grams === null || grams <= 0 || grams > MAX_CONTAINER_GRAMS) return []
    return [{
      name: (container.libraryName.trim() || `${container.name.trim()}的盒子`).slice(0, 20),
      container_type: (draft.scene === 'takeout' ? 'box' : 'bowl') as ResearchContainer,
      grams,
      photo_url: container.tarePhoto.url,
    }]
  })
}

/**
 * 提交成功后开始下一顿：保留场景、地点、秤和称法；分项累加还保留皮重和照片
 * （食堂同款碗只需称一次），其余读数和照片清空。
 */
export function nextDraftAfterSubmit(draft: ResearchDraft, now = Date.now()): ResearchDraft {
  return {
    ...emptyDraft(now),
    scene: draft.scene, mode: draft.mode, venueName: draft.venueName, city: draft.city, precision: draft.precision,
    container: draft.container, tareSource: draft.tareSource, tare: draft.tareSource === 'after_meal' ? '' : draft.tare,
    tareLibraryId: draft.tareLibraryId, tarePhoto: draft.tareSource === 'after_meal' ? undefined : draft.tarePhoto,
    reference: draft.reference, containers: [newContainer(defaultTareSource(draft.scene), now)],
    // 同一个称重日、同一道菜常常连着称几份，活动信息留着。
    ...(draft.campus ? { campus: draft.campus } : {}),
  }
}

/** 首页"进行中的一顿"：填过任何内容就算开始了。 */
export function draftHasContent(draft: ResearchDraft): boolean {
  const anyPhoto = Object.values(draft.photos).some(Boolean)
  const anyContainer = draft.containers.some((c) => c.name.trim() || c.gross.trim() || c.grossPhoto)
  const anyItem = draft.items.some((item) => item.name.trim() || item.reading.trim() || item.photo)
  return Boolean(draft.dishName.trim() || anyPhoto || anyContainer || anyItem)
}

export const STATUS_LABELS: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '未通过' }

export function libraryIndex(containers: SavedResearchContainer[]): Library {
  return containers.reduce<Library>((index, container) => ({ ...index, [container.id]: container }), {})
}
