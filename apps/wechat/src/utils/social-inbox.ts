import Taro from '@tarojs/taro'
import { communityGetNotifications, friendGetRequests, getAccessToken, getUnreadMessageCount } from './api'

export interface SocialInboxSnapshot {
  interactions: number
  messages: number
  friendRequests: number
}

const emptySnapshot = (): SocialInboxSnapshot => ({ interactions: 0, messages: 0, friendRequests: 0 })
const listeners = new Set<() => void>()
let owner = ''
let snapshot = emptySnapshot()
let refreshedAt = 0
let pending: Promise<SocialInboxSnapshot> | null = null
let menuRequestedBy = ''

function sessionKey(): string {
  try {
    const token = getAccessToken()
    return token ? `${String(Taro.getStorageSync('user_id') || '')}:${token}` : ''
  } catch {
    return ''
  }
}

function currentOwner(): string {
  const next = sessionKey()
  if (owner !== next) {
    owner = next
    snapshot = emptySnapshot()
    refreshedAt = 0
    pending = null
    menuRequestedBy = ''
  }
  return next
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export function getSocialInboxSnapshot(): SocialInboxSnapshot {
  currentOwner()
  return snapshot
}

export function subscribeSocialInbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function refreshSocialInbox(force = false): Promise<SocialInboxSnapshot> {
  const key = currentOwner()
  if (!key) return Promise.resolve(snapshot)
  if (pending) return pending
  if (!force && refreshedAt && Date.now() - refreshedAt < 30000) return Promise.resolve(snapshot)
  const request = Promise.allSettled([
    communityGetNotifications(1),
    getUnreadMessageCount(),
    friendGetRequests(),
  ]).then(([interactions, messages, friends]) => {
    if (currentOwner() !== key) return getSocialInboxSnapshot()
    snapshot = {
      interactions: interactions.status === 'fulfilled' ? count(interactions.value.unread_count) : snapshot.interactions,
      messages: messages.status === 'fulfilled' ? count(messages.value.count) : snapshot.messages,
      friendRequests: friends.status === 'fulfilled' ? (friends.value.list || []).length : snapshot.friendRequests,
    }
    refreshedAt = Date.now()
    listeners.forEach(listener => listener())
    return snapshot
  }).finally(() => {
    if (pending === request) pending = null
  })
  pending = request
  return request
}

export function socialInboxTotal(inbox: SocialInboxSnapshot): number {
  return inbox.interactions + inbox.messages + inbox.friendRequests
}

export function socialInboxReminder(inbox: SocialInboxSnapshot): string | undefined {
  const messages = inbox.interactions + inbox.messages
  const parts: string[] = []
  if (messages) parts.push(`${messages} 条新消息`)
  if (inbox.friendRequests) parts.push(`${inbox.friendRequests} 个好友申请`)
  return parts.length ? `有 ${parts.join('和 ')}，点我看看` : undefined
}

export function requestSocialMenuOpen(): void {
  menuRequestedBy = currentOwner()
}

export function consumeSocialMenuOpen(): boolean {
  const key = currentOwner()
  const requested = Boolean(key && key === menuRequestedBy)
  menuRequestedBy = ''
  return requested
}
