import { authenticatedRequest, uploadAuthenticatedFile } from './api'

/** 称重科研数据：带食物秤读数的中餐克重样本，用于建立评测集。 */
export type ResearchScene = 'canteen' | 'home' | 'takeout' | 'restaurant' | 'other'
export type ResearchWeighingMode = 'whole' | 'itemized' | 'multi'
export type ResearchContainer = 'bowl' | 'plate' | 'tray' | 'box' | 'other'
/** 一个容器的空重从哪来：先称、归零、吃完再称、常用容器。 */
export type ResearchTareSource = 'measured' | 'zeroed' | 'after_meal' | 'library'
export type ResearchTareMode = ResearchTareSource | 'per_container'
export type ResearchReference = 'none' | 'chopsticks' | 'spoon' | 'card' | 'hand' | 'other'
export type ResearchPhotoRole =
  | 'tare_scale' | 'gross_scale' | 'item_scale' | 'container_gross' | 'container_tare'
  | 'eval_top' | 'eval_angle' | 'eval_top_ref' | 'eval_angle_ref'
export type ResearchSampleStatus = 'pending' | 'approved' | 'rejected'

export interface ResearchItemPayload {
  name: string
  cumulative_reading_grams: number
  contains_bone: boolean
  contains_soup: boolean
  cooking_method?: string
  /** 按盒称：这一盒自己的连盒读数和皮重。 */
  gross_reading_grams?: number
  tare_source?: ResearchTareSource
  tare_grams?: number
  container_id?: string
  container_type?: ResearchContainer
}

export interface ResearchPhotoPayload {
  role: ResearchPhotoRole
  url: string
  item_index?: number
  captured_at?: string
  source?: 'camera' | 'album'
}

export interface ResearchSamplePayload {
  client_key: string
  scene: ResearchScene
  weighing_mode: ResearchWeighingMode
  dish_name: string
  venue_name: string
  city: string
  container_type: ResearchContainer
  tare_mode: ResearchTareMode
  tare_grams: number
  container_id?: string
  gross_reading_grams?: number
  scale_precision_grams: number
  items: ResearchItemPayload[]
  photos: ResearchPhotoPayload[]
  reference_object: ResearchReference
  video_url?: string
  device: Record<string, string>
  notes: string
  consent_version: string
}

export interface ResearchSampleItem {
  name: string
  cumulative_reading_grams: number
  grams: number
  contains_bone: boolean
  contains_soup: boolean
  gross_reading_grams?: number
  tare_grams?: number
  tare_source?: ResearchTareSource
}

export interface ResearchSample {
  id: string
  scene: ResearchScene
  weighing_mode: ResearchWeighingMode
  dish_name: string
  venue_name: string
  total_net_grams: number
  items: ResearchSampleItem[]
  status: ResearchSampleStatus
  quality_tier?: 'A' | 'B' | 'C'
  review_note: string
  reward_credits: number
  created_at?: string
}

export interface ResearchSummary {
  total: number
  pending: number
  approved: number
  rejected: number
}

export interface ResearchMineResult {
  items: ResearchSample[]
  summary: ResearchSummary
  consent_version: string
}

/** 称过一次就能反复用的空容器（同款外卖盒、自家的碗）。 */
export interface SavedResearchContainer {
  id: string
  name: string
  container_type: ResearchContainer
  grams: number
  photo_url: string
  created_at?: string
}

export interface ResearchContainerInput {
  name: string
  container_type: ResearchContainer
  grams: number
  photo_url: string
}

const BASE = '/api/research-weight-samples'
const CONTAINERS_BASE = '/api/research-weight-containers'

export async function getMyResearchSamples(): Promise<ResearchMineResult> {
  const response = await authenticatedRequest(`${BASE}/mine`, { method: 'GET', timeout: 20000 })
  return response.data as ResearchMineResult
}

export async function submitResearchSample(payload: ResearchSamplePayload): Promise<ResearchSample> {
  const response = await authenticatedRequest(BASE, { method: 'POST', data: payload, timeout: 30000 })
  return (response.data as { item: ResearchSample }).item
}

/** 原图上传到本人的科研目录；服务端只接受这里返回的照片。 */
export async function uploadResearchImage(localPath: string): Promise<string> {
  const payload = await uploadAuthenticatedFile(localPath, `${BASE}/upload-image`)
  const url = String(payload?.image_url || '').trim()
  if (!url) throw new Error('照片上传失败，请重试')
  return url
}

export async function uploadResearchVideo(localPath: string): Promise<string> {
  const payload = await uploadAuthenticatedFile(localPath, `${BASE}/upload-video`)
  const url = String(payload?.video_url || '').trim()
  if (!url) throw new Error('视频上传失败，请重试')
  return url
}

export async function listResearchContainers(): Promise<SavedResearchContainer[]> {
  const response = await authenticatedRequest(CONTAINERS_BASE, { method: 'GET', timeout: 20000 })
  return ((response.data as { items?: SavedResearchContainer[] }).items) || []
}

export async function createResearchContainer(input: ResearchContainerInput): Promise<SavedResearchContainer> {
  const response = await authenticatedRequest(CONTAINERS_BASE, { method: 'POST', data: input, timeout: 20000 })
  return (response.data as { item: SavedResearchContainer }).item
}

export async function archiveResearchContainer(id: string): Promise<void> {
  await authenticatedRequest(`${CONTAINERS_BASE}/${encodeURIComponent(id)}/archive`, { method: 'POST', timeout: 20000 })
}
