/** 后台新建高校共建活动的表单：校验并转成接口要的格式。 */
export type CampaignForm = {
  orgId: string
  title: string
  startsAt: string
  endsAt: string
  coreCap: string
  planCode: string
  leaders: string
  rewardNote: string
}

export type CampaignInput = {
  org_id: string
  title: string
  starts_at: string
  ends_at: string
  core_member_cap: number
  membership_plan_code: string
  leader_user_ids: string[]
  club_reward_note: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function emptyCampaignForm(): CampaignForm {
  return { orgId: '', title: '', startsAt: '', endsAt: '', coreCap: '15', planCode: 'standard_monthly', leaders: '', rewardNote: '' }
}

/** datetime-local 的值按北京时间理解。 */
function beijingISO(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = new Date(`${local}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function campaignInputFromForm(form: CampaignForm): CampaignInput | { error: string } {
  if (!form.orgId) return { error: '请选择社团' }
  const title = form.title.trim()
  if (!title) return { error: '请填写活动名称' }
  const startsAt = beijingISO(form.startsAt)
  const endsAt = beijingISO(form.endsAt)
  if (!startsAt || !endsAt || endsAt <= startsAt) return { error: '请填写正确的起止时间' }
  const cap = Number(form.coreCap)
  if (!Number.isInteger(cap) || cap < 0 || cap > 200) return { error: '核心成员名额需在 0 到 200 之间' }
  const leaders = form.leaders.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean)
  const bad = leaders.find((value) => !UUID.test(value))
  if (bad) return { error: `负责人 ID 不正确：${bad}` }
  return {
    org_id: form.orgId, title, starts_at: startsAt, ends_at: endsAt, core_member_cap: cap,
    membership_plan_code: form.planCode.trim() || 'standard_monthly', leader_user_ids: leaders, club_reward_note: form.rewardNote.trim(),
  }
}

/** 社团分享和打印小程序码用的页面路径。 */
export function sharePath(joinCode: string): string {
  return `packageResearch/pages/campus-campaign/index?code=${joinCode}`
}
