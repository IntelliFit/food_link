import { DEFAULT_AVATAR_URL } from './static-asset-cdn-url'

/** 与后端 login_service 中 defaultUserAvatarKey 保持一致 */
export const DEFAULT_USER_AVATAR_COS_KEY = '_system/default_avatar.jpg'

const LEGACY_WECHAT_NICKNAME_PREFIX = '微信用户_'
export const DEFAULT_REGISTRATION_NICKNAME_PREFIX = '食探用户_'

/** 默认头像 CDN 地址，用于注册弹窗预填与离线展示 */
export const defaultAvatarImage = DEFAULT_AVATAR_URL

/** 新用户默认昵称：食探用户_{6 位随机数字} */
export function buildDefaultWechatNickname(_openid?: string): string {
  const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  return `${DEFAULT_REGISTRATION_NICKNAME_PREFIX}${suffix}`
}

/** 解析 API 或本地应展示的头像 URL */
export function resolveRegistrationAvatar(avatar?: string | null): string {
  const value = String(avatar || '').trim()
  return value || defaultAvatarImage
}

/** 解析 API 或本地应展示的昵称 */
export function resolveRegistrationNickname(
  nickname: string | null | undefined,
  openid: string
): string {
  const value = String(nickname || '').trim()
  if (value && value !== '微信用户' && !value.startsWith(LEGACY_WECHAT_NICKNAME_PREFIX)) {
    return value
  }
  return buildDefaultWechatNickname(openid)
}
