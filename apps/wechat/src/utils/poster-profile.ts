import Taro from '@tarojs/taro'
import { getUserProfile } from './api'

export type PosterUserProfile = {
  nickname: string
  avatar: string
}

const emptyPosterUserProfile = (): PosterUserProfile => ({ nickname: '', avatar: '' })

function normalizeProfile(raw: any): PosterUserProfile {
  if (!raw || typeof raw !== 'object') return emptyPosterUserProfile()
  return {
    nickname: String(raw.name || raw.nickname || raw.nickName || raw.nick_name || '').trim(),
    avatar: String(raw.avatar || raw.avatarUrl || raw.avatar_url || '').trim(),
  }
}

function isSameStoredUser(ownerUserId?: string): boolean {
  const targetUserId = String(ownerUserId || '').trim()
  if (!targetUserId) return true
  const storedUserId = String(Taro.getStorageSync('user_id') || '').trim()
  return Boolean(storedUserId && storedUserId === targetUserId)
}

export function getLocalPosterUserProfile(ownerUserId?: string): PosterUserProfile {
  if (!isSameStoredUser(ownerUserId)) return emptyPosterUserProfile()
  try {
    const raw = Taro.getStorageSync('userInfo')
    const info = typeof raw === 'string' ? JSON.parse(raw) : raw
    return normalizeProfile(info)
  } catch {
    return emptyPosterUserProfile()
  }
}

export function mergePosterUserProfile(
  primary?: Partial<PosterUserProfile> | null,
  fallback?: Partial<PosterUserProfile> | null,
): PosterUserProfile {
  return {
    nickname: String(primary?.nickname || fallback?.nickname || '').trim(),
    avatar: String(primary?.avatar || fallback?.avatar || '').trim(),
  }
}

export async function getCurrentPosterUserProfile(ownerUserId?: string): Promise<PosterUserProfile> {
  const localProfile = getLocalPosterUserProfile(ownerUserId)
  if (!isSameStoredUser(ownerUserId)) return localProfile
  try {
    const remote = await getUserProfile()
    const remoteProfile = normalizeProfile(remote)
    const merged = mergePosterUserProfile(remoteProfile, localProfile)
    if (merged.nickname || merged.avatar) {
      const stored = Taro.getStorageSync('userInfo') || {}
      const nextStored = {
        ...(typeof stored === 'object' ? stored : {}),
        ...(merged.nickname ? { name: merged.nickname, nickname: merged.nickname } : {}),
        ...(merged.avatar ? { avatar: merged.avatar } : {}),
      }
      Taro.setStorageSync('userInfo', nextStored)
    }
    return merged
  } catch {
    return localProfile
  }
}
