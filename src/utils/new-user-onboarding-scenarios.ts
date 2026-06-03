/** 与登录页 handleLoginSuccess 判定逻辑对齐的新用户引导调试场景 */

export type NewUserOnboardingScenarioId =
  | 'profile_empty'
  | 'profile_wechat_user'
  | 'profile_missing_avatar'
  | 'profile_missing_nickname'
  | 'phone_bind_only'
  | 'chain_profile_then_phone'

export interface NewUserOnboardingScenario {
  id: NewUserOnboardingScenarioId
  title: string
  desc: string
  /** 模拟接口返回的初始头像（COS/https） */
  initialAvatar?: string
  /** 模拟接口返回的初始昵称 */
  initialNickname?: string
  /** 直接展示手机号绑定弹窗 */
  openPhoneBind?: boolean
  /** 保存个人信息后自动展示手机号绑定 */
  chainPhoneBind?: boolean
}

/** 调试页预填头像示例（仅 UI，不要求域名可下载） */
export const DEBUG_SAMPLE_AVATAR_URL =
  'https://thirdwx.qlogo.cn/mmopen/vi_32/POgEwh4mIHO4nibH0KlMECNjjM/0'

export const NEW_USER_ONBOARDING_SCENARIOS: NewUserOnboardingScenario[] = [
  {
    id: 'profile_empty',
    title: '完善个人信息（全空）',
    desc: '模拟旧数据：nickname、avatar 均为空；弹窗会预填默认头像与微信用户_随机6位数字',
  },
  {
    id: 'profile_wechat_user',
    title: '完善个人信息（微信用户）',
    desc: '昵称为「微信用户」时仍会要求完善',
    initialNickname: '微信用户',
  },
  {
    id: 'profile_missing_avatar',
    title: '仅有昵称、缺头像',
    desc: '有 nickname 但 avatar 为空时仍会弹出完善信息',
    initialNickname: '已有昵称用户',
  },
  {
    id: 'profile_missing_nickname',
    title: '仅有头像、缺昵称',
    desc: '有 avatar 但 nickname 为空时仍会弹出完善信息',
    initialAvatar: DEBUG_SAMPLE_AVATAR_URL,
  },
  {
    id: 'phone_bind_only',
    title: '绑定手机号',
    desc: '头像昵称已完善，库中无手机号时的「完善账号」弹窗',
    openPhoneBind: true,
    initialAvatar: DEBUG_SAMPLE_AVATAR_URL,
    initialNickname: '已完善用户',
  },
  {
    id: 'chain_profile_then_phone',
    title: '完整链路：信息 → 手机号',
    desc: '先完善个人信息，保存后弹出手机号授权（不调真实接口）',
    chainPhoneBind: true,
  },
]

export function findOnboardingScenario(
  id: string | undefined
): NewUserOnboardingScenario | undefined {
  if (!id) return undefined
  return NEW_USER_ONBOARDING_SCENARIOS.find((s) => s.id === id)
}

/** 与登录页相同的「是否需要完善头像昵称」判定 */
export function shouldShowProfileFormFromApiUser(api: {
  nickname?: string | null
  avatar?: string | null
}): boolean {
  const nickname = String(api.nickname || '').trim()
  const avatar = String(api.avatar || '').trim()
  return !nickname || !avatar || nickname === '微信用户'
}
