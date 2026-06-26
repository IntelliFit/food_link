export interface UserSearchResult {
  user_id: string
  nickname: string
  avatar: string
  telephone: string
  open_id: string
  app_open_id: string
  created_at?: string
}

export interface UserSummary {
  user_id: string
  nickname: string
  telephone: string
  avatar: string
  created_at?: string
  earned_credits_balance: number
  is_pro: boolean
  current_plan_code: string
  daily_credits: number
  membership_expires_at?: string | null
  membership_status: string
}

export interface IssuePointsVoucherInput {
  points: number
  note: string
}

export interface IssuePointsVoucherResult {
  voucher_id: string
}
