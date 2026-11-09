/** 后台高校伙伴计划：建活动表单的校验、同一社团判重、发给社团的说明文字。 */
export type CampaignForm = {
  orgId: string
  title: string
  startsAt: string
  endsAt: string
  coreCap: string
  planCode: string
  /** 负责人用户 ID，逗号分隔；页面上用搜索选人，不用手填。 */
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

export type ClubLike = { id: string; school_id: string; name: string }

export type InviteCampaign = {
  title: string
  join_code: string
  school_name: string
  org_name: string
  ends_at: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 24 * 3600 * 1000

export function emptyCampaignForm(): CampaignForm {
  return { orgId: '', title: '', startsAt: '', endsAt: '', coreCap: '15', planCode: 'standard_monthly', leaders: '', rewardNote: '' }
}

/** 接口返回的时间（UTC）在北京时间是哪一天。 */
export function beijingDay(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso.slice(0, 10) : beijingDate(ms)
}

/** 北京时间的日期（YYYY-MM-DD）。 */
function beijingDate(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 北京时间的整点（YYYY-MM-DDTHH:00），给 datetime-local 用。 */
function beijingHour(ms: number): string {
  return `${new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 13)}:00`
}

/**
 * 默认四周：从现在这个整点开始（点「开始活动」后马上能加入，不用等到 8 点），
 * 第 28 天晚上结束（北京时间）。
 */
export function defaultCampaignForm(now = Date.now(), orgId = ''): CampaignForm {
  return {
    ...emptyCampaignForm(), orgId, title: '食堂称重月',
    startsAt: beijingHour(now), endsAt: `${beijingDate(now + 27 * DAY_MS)}T23:59`,
  }
}

/** datetime-local 的值按北京时间理解。 */
function beijingISO(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = new Date(`${local}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function leaderIds(form: CampaignForm): string[] {
  return form.leaders.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean)
}

export function campaignInputFromForm(form: CampaignForm): CampaignInput | { error: string } {
  if (!form.orgId) return { error: '请先选社团（没有就在第 1 步建一个）' }
  const title = form.title.trim()
  if (!title) return { error: '请填写活动名称' }
  const startsAt = beijingISO(form.startsAt)
  const endsAt = beijingISO(form.endsAt)
  if (!startsAt || !endsAt || endsAt <= startsAt) return { error: '请填写正确的起止时间' }
  const cap = Number(form.coreCap)
  if (!Number.isInteger(cap) || cap < 0 || cap > 200) return { error: '核心成员名额需在 0 到 200 之间' }
  const leaders = leaderIds(form)
  const bad = leaders.find((value) => !UUID.test(value))
  if (bad) return { error: `负责人 ID 不正确：${bad}` }
  return {
    org_id: form.orgId, title, starts_at: startsAt, ends_at: endsAt, core_member_cap: cap,
    membership_plan_code: form.planCode.trim() || 'standard_monthly', leader_user_ids: leaders, club_reward_note: form.rewardNote.trim(),
  }
}

/** 与后端 clubKey 一致："清华大学健身协会" 和 "健身 协会" 在清华是同一个社团。 */
export function clubKey(name: string, schoolName: string): string {
  const key = name.replace(/\s+/g, '').toLowerCase()
  const school = schoolName.replace(/\s+/g, '').toLowerCase()
  return school && key.startsWith(school) && key !== school ? key.slice(school.length) : key
}

/** 这所学校里和要建的名字是同一个社团的那个；没有返回 undefined。 */
export function findSameClub<T extends ClubLike>(clubs: T[], schoolId: string, schoolName: string, name: string): T | undefined {
  const key = clubKey(name, schoolName)
  if (!key) return undefined
  return clubs.find((club) => club.school_id === schoolId && clubKey(club.name, schoolName) === key)
}

/** 社团分享和打印小程序码用的页面路径。 */
export function sharePath(joinCode: string): string {
  return `packageResearch/pages/campus-campaign/index?code=${joinCode}`
}

/** 复制给社团负责人的一段话：加入码、怎么进、负责人做什么。 */
export function inviteText(campaign: InviteCampaign, coreCap: number): string {
  const ends = beijingDay(campaign.ends_at)
  return [
    `【食探 · ${campaign.school_name}${campaign.org_name}「${campaign.title}」】`,
    `加入码：${campaign.join_code}（活动到 ${ends}）`,
    '成员怎么加入：微信里打开「食探」小程序 → 我的 → 科研共建 → 高校伙伴计划 → 输入加入码；也可以直接点社团群里转发的小程序卡片。',
    '怎么记：有食物秤的用「用秤记一顿」；没秤的用「拍照记一顿」，记完回到活动页，把这一餐挂到食堂的那道菜上。',
    `负责人：在活动页的「管理」里勾核心成员（最多 ${coreCap} 人，勾上自动开通标准版会员）、建称重日；点右上角转发就能把活动卡片发到群里。`,
  ].join('\n')
}
