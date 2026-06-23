import Taro from '@tarojs/taro'

const PENDING_FRIEND_INVITE_CODE_KEY = 'pending_friend_invite_code'
const PENDING_FRIEND_INVITE_TTL_MS = 2 * 60 * 60 * 1000

interface PendingFriendInvitePayload {
  code: string
  createdAt: number
  source?: string
}

function normalizeInviteCode(code: string): string {
  return String(code || '').trim()
}

export function writePendingFriendInviteCode(code: string, source?: string) {
  const normalized = normalizeInviteCode(code)
  if (!normalized) return
  const payload: PendingFriendInvitePayload = {
    code: normalized,
    createdAt: Date.now(),
    source,
  }
  Taro.setStorageSync(PENDING_FRIEND_INVITE_CODE_KEY, JSON.stringify(payload))
}

export function clearPendingFriendInviteCode() {
  Taro.removeStorageSync(PENDING_FRIEND_INVITE_CODE_KEY)
}

export function readPendingFriendInviteCode(): string {
  const raw = Taro.getStorageSync(PENDING_FRIEND_INVITE_CODE_KEY)
  if (!raw) return ''

  if (typeof raw !== 'string') {
    clearPendingFriendInviteCode()
    return ''
  }

  try {
    const payload = JSON.parse(raw) as Partial<PendingFriendInvitePayload>
    const code = normalizeInviteCode(payload.code || '')
    const createdAt = Number(payload.createdAt || 0)
    if (!code || !Number.isFinite(createdAt) || createdAt <= 0) {
      clearPendingFriendInviteCode()
      return ''
    }
    if (Date.now() - createdAt > PENDING_FRIEND_INVITE_TTL_MS) {
      clearPendingFriendInviteCode()
      return ''
    }
    return code
  } catch {
    // 旧版本曾经直接存纯字符串。为避免历史邀请码污染后续非邀请注册，升级后直接清理。
    clearPendingFriendInviteCode()
    return ''
  }
}
