import AsyncStorage from '@react-native-async-storage/async-storage'

const PENDING_FRIEND_INVITE_CODE_KEY = 'pending_friend_invite_code'
const PENDING_FRIEND_INVITE_TTL_MS = 2 * 60 * 60 * 1000

interface PendingFriendInvitePayload {
  code: string
  createdAt: number
  source?: string
}

function normalizeInviteCode(code?: string): string {
  return String(code || '').trim()
}

export async function writePendingFriendInviteCode(code: string, source?: string): Promise<void> {
  const normalized = normalizeInviteCode(code)
  if (!normalized) return
  const payload: PendingFriendInvitePayload = { code: normalized, createdAt: Date.now(), source }
  await AsyncStorage.setItem(PENDING_FRIEND_INVITE_CODE_KEY, JSON.stringify(payload)).catch(() => undefined)
}

export async function clearPendingFriendInviteCode(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_FRIEND_INVITE_CODE_KEY).catch(() => undefined)
}

export async function readPendingFriendInviteCode(): Promise<string> {
  const raw = await AsyncStorage.getItem(PENDING_FRIEND_INVITE_CODE_KEY).catch(() => null)
  if (!raw) return ''
  try {
    const payload = JSON.parse(raw) as Partial<PendingFriendInvitePayload>
    const code = normalizeInviteCode(payload.code)
    const createdAt = Number(payload.createdAt || 0)
    if (!code || !Number.isFinite(createdAt) || createdAt <= 0 || Date.now() - createdAt > PENDING_FRIEND_INVITE_TTL_MS) {
      await clearPendingFriendInviteCode()
      return ''
    }
    return code
  } catch {
    await clearPendingFriendInviteCode()
    return ''
  }
}
