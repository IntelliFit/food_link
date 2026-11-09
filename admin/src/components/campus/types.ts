/** 后台高校伙伴计划页用到的接口数据。 */
export type ClubView = {
  id: string
  school_id: string
  school_name: string
  name: string
  status: string
  agreement_version: string
  campaign_count: number
  created_at?: string
}

export type CampaignRow = {
  id: string
  title: string
  join_code: string
  status: 'draft' | 'active' | 'ended'
  open: boolean
  starts_at: string
  ends_at: string
  school_id: string
  school_name: string
  org_name: string
  member_count: number
  approved_count: number
  club_reward_note: string
  core_member_cap: number
}

export type SchoolOption = { id: string; name: string; city?: string }

export const STATUS_LABELS: Record<CampaignRow['status'], string> = { draft: '草稿（成员还不能加入）', active: '进行中', ended: '已结束' }
