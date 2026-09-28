import Taro from '@tarojs/taro'
import { communityGetNotifications, friendGetRequests, getAccessToken, getUnreadMessageCount } from './api'

export interface SocialInboxSnapshot { interactions: number; messages: number; friendRequests: number }
const empty = (): SocialInboxSnapshot => ({ interactions: 0, messages: 0, friendRequests: 0 })
const listeners = new Set<() => void>()
let owner = ''
let snapshot = empty()
let refreshedAt = 0
let pending: Promise<SocialInboxSnapshot> | null = null
let generation = 0

function currentOwner(): string {
  const token = getAccessToken()
  const key = token ? `${Taro.getStorageSync('user_id') || ''}:${token}` : ''
  if (owner !== key) { owner = key; snapshot = empty(); refreshedAt = 0; pending = null; generation += 1 }
  return key
}

export function resetSocialInbox(): void {
  owner = ''; snapshot = empty(); refreshedAt = 0; pending = null; generation += 1
  listeners.forEach(listener => listener())
}
export function getSocialInboxSnapshot(): SocialInboxSnapshot { currentOwner(); return snapshot }
export function subscribeSocialInbox(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
const count = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0

export function refreshSocialInbox(force = false): Promise<SocialInboxSnapshot> {
  const key = currentOwner()
  if (!key) return Promise.resolve(snapshot)
  if (pending) return pending
  if (!force && refreshedAt && Date.now() - refreshedAt < 30000) return Promise.resolve(snapshot)
  const currentGeneration = generation
  const request = Promise.allSettled([communityGetNotifications(1), getUnreadMessageCount(), friendGetRequests()]).then(([interactions, messages, friends]) => {
    if (currentOwner() !== key || currentGeneration !== generation) return getSocialInboxSnapshot()
    snapshot = {
      interactions: interactions.status === 'fulfilled' ? count(interactions.value.unread_count) : snapshot.interactions,
      messages: messages.status === 'fulfilled' ? count(messages.value.count) : snapshot.messages,
      friendRequests: friends.status === 'fulfilled' ? (friends.value.list || []).length : snapshot.friendRequests,
    }
    refreshedAt = Date.now()
    listeners.forEach(listener => listener())
    return snapshot
  }).finally(() => { if (pending === request) pending = null })
  pending = request
  return request
}

export function socialInboxTotal(value: SocialInboxSnapshot): number { return value.interactions + value.messages + value.friendRequests }
