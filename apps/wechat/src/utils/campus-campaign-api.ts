import { authenticatedRequest, publicRequest } from './api'

/** 高校伙伴计划：健身社团发起的校园饮食数据采集活动。 */
export type CampaignRole = 'leader' | 'core' | 'member'

export interface CampusCampaign {
  id: string
  title: string
  join_code: string
  status: 'active' | 'ended' | 'draft'
  open: boolean
  starts_at: string
  ends_at: string
  school_id: string
  school_name: string
  org_name: string
  goals: Record<string, unknown>
  club_reward_note: string
  member_count: number
  approved_count: number
}

export interface CampaignMemberStats {
  user_id: string
  nickname: string
  role: CampaignRole
  has_scale: boolean
  submitted: number
  approved: number
  photo_records: number
  membership_granted: boolean
}

export interface CampaignStation {
  id: string
  session_date: string
  meal_period: 'breakfast' | 'lunch' | 'dinner' | 'other'
  kind: 'weigh_station' | 'same_dish'
  location_text: string
  catalog_item_id?: string
  scale_precision_grams: number
  notes: string
}

export interface CampaignMine {
  campaign: CampusCampaign | null
  role: CampaignRole | ''
  has_scale: boolean
  stats: CampaignMemberStats
  stations: CampaignStation[]
  /** 已计入活动的拍照记录（最近的几十条），刷新后也能标出来。 */
  linked?: Array<{ food_record_id: string; dish_name: string }>
}

export interface CampaignLeader {
  campaign: CampusCampaign
  core_cap: number
  core_count: number
  members: CampaignMemberStats[]
  stations: CampaignStation[]
}

export interface BoardEntry {
  rank: number
  name: string
  school_name?: string
  approved: number
  members?: number
  per_member?: number
  dishes: number
}

export interface JoinInput {
  has_scale: boolean
  scale_precision_grams?: number
  join_source: 'qr' | 'link' | 'code'
  consent_version: string
}

export interface StationInput {
  session_date: string
  meal_period: CampaignStation['meal_period']
  kind: CampaignStation['kind']
  location_text: string
  catalog_item_id?: string
  scale_precision_grams: number
  notes?: string
}

export interface CampaignDish {
  id: string
  name: string
  canteen_name: string
  floor: string
  window_name: string
  /** 菜名里没有完整的搜索词，只是名字相近。 */
  close?: boolean
}

export interface RecordLinkInput {
  food_record_id: string
  catalog_item_id?: string
  dish_name?: string
  user_adjusted?: boolean
}

const BASE = '/api/campus-campaigns'
const code = (value: string) => encodeURIComponent(value.trim().toUpperCase())

async function get<T>(url: string): Promise<T> {
  const response = await authenticatedRequest(url, { method: 'GET', timeout: 15000 })
  return response.data as T
}

/** 游客能看的接口：不登录也不会被带去登录页；登录了会带上身份（排行榜显示昵称）。 */
async function getPublic<T>(url: string): Promise<T> {
  const response = await publicRequest(url, { method: 'GET', timeout: 15000 })
  return response.data as T
}

/** 游客也能看活动介绍和排行榜。 */
export async function getCampaignByCode(joinCode: string): Promise<CampusCampaign> {
  return (await getPublic<{ campaign: CampusCampaign }>(`${BASE}/by-code/${code(joinCode)}`)).campaign
}

export async function getCampaignMembersBoard(joinCode: string): Promise<BoardEntry[]> {
  return (await getPublic<{ items?: BoardEntry[] }>(`${BASE}/by-code/${code(joinCode)}/board`)).items || []
}

export async function getCampaignsBoard(): Promise<BoardEntry[]> {
  return (await getPublic<{ items?: BoardEntry[] }>(`${BASE}/board`)).items || []
}

export async function joinCampaign(joinCode: string, input: JoinInput): Promise<CampaignMine> {
  const response = await authenticatedRequest(`${BASE}/by-code/${code(joinCode)}/join`, { method: 'POST', data: input, timeout: 15000 })
  return (response.data as { mine: CampaignMine }).mine
}

export async function getMyCampaign(): Promise<CampaignMine> {
  return (await get<{ mine: CampaignMine }>(`${BASE}/mine`)).mine
}

export async function linkCampaignRecord(input: RecordLinkInput): Promise<boolean> {
  const response = await authenticatedRequest(`${BASE}/records`, { method: 'POST', data: input, timeout: 15000 })
  return Boolean((response.data as { linked?: boolean }).linked)
}

/** 本活动学校食堂里的菜，按菜名搜；只有活动成员能搜。 */
export async function searchCampaignDishes(campaignId: string, keyword: string): Promise<CampaignDish[]> {
  const query = encodeURIComponent(keyword.trim())
  return (await get<{ items?: CampaignDish[] }>(`${BASE}/${encodeURIComponent(campaignId)}/dishes?q=${query}`)).items || []
}

export async function getCampaignLeader(campaignId: string): Promise<CampaignLeader> {
  return (await get<{ leader: CampaignLeader }>(`${BASE}/${encodeURIComponent(campaignId)}/leader`)).leader
}

export async function setCampaignCoreMember(campaignId: string, userId: string, core: boolean): Promise<CampaignLeader> {
  const response = await authenticatedRequest(`${BASE}/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(userId)}/core`, {
    method: 'PUT', data: { core }, timeout: 20000,
  })
  return (response.data as { leader: CampaignLeader }).leader
}

export async function createCampaignStation(campaignId: string, input: StationInput): Promise<CampaignStation> {
  const response = await authenticatedRequest(`${BASE}/${encodeURIComponent(campaignId)}/stations`, { method: 'POST', data: input, timeout: 15000 })
  return (response.data as { station: CampaignStation }).station
}
