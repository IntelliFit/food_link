import { authenticatedRequest, uploadAuthenticatedFile } from './api'

/** 称重科研数据：带食物秤读数的中餐克重样本，用于建立评测集。 */
export type ResearchScene = 'canteen' | 'home' | 'takeout' | 'restaurant' | 'other'
export type ResearchWeighingMode = 'whole' | 'itemized'
export type ResearchContainer = 'bowl' | 'plate' | 'tray' | 'box' | 'other'
export type ResearchTareMode = 'measured' | 'zeroed'
export type ResearchReference = 'none' | 'chopsticks' | 'spoon' | 'card' | 'hand' | 'other'
export type ResearchPhotoRole =
  | 'tare_scale' | 'gross_scale' | 'item_scale'
  | 'eval_top' | 'eval_angle' | 'eval_top_ref' | 'eval_angle_ref'
export type ResearchSampleStatus = 'pending' | 'approved' | 'rejected'

export interface ResearchItemPayload {
  name: string
  cumulative_reading_grams: number
  contains_bone: boolean
  contains_soup: boolean
  cooking_method?: string
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

const BASE = '/api/research-weight-samples'

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
