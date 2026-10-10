import Taro from '@tarojs/taro'
import { clearAllStorage, getAccessToken, publicRequest } from './api'
import { redirectToLogin } from './withAuth'

export type MealProfile = { user_id: string; nickname: string; avatar: string }
export type MealParticipation = MealProfile & { status: string; revision: number; note: string }
export type MealMeetup = {
  id: string; host: MealProfile; title: string; description: string
  venue_name: string; address: string; latitude?: number; longitude?: number
  starts_at: string; ends_at: string; timezone: string; meal_type: string
  budget: number; payment: 'aa' | 'separate'; capacity: number; member_count: number
  status: string; is_host: boolean; own_status: string; own_revision: number
  can_enter_room: boolean; members: MealProfile[]; applications?: MealParticipation[]; managed_members?: MealParticipation[]
}
export type MealEvent = { id: string; actor: MealProfile; kind: string; content: string; created_at: string }
export type CreateMealMeetup = {
  request_id: string; title: string; description: string; venue_name: string; address: string
  latitude?: number; longitude?: number; starts_at: string; timezone: string
  budget: number; payment: 'aa' | 'separate'; capacity: number
}
export const MEAL_CHANGED = 'meal-meetup-changed'
export const mealPath = (page: 'detail' | 'create' | 'mine' | 'room', id?: string) =>
  `/packageMeal/pages/${page}/index${id ? `?id=${encodeURIComponent(id)}` : ''}`
export function mealRequestKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 3) | 8).toString(16)
  })
}
export async function mealRequest<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: Record<string, unknown>, privateRead = false): Promise<T> {
  const token = getAccessToken()
  if ((method === 'POST' || privateRead) && !token) {
    redirectToLogin()
    throw new Error('请先登录')
  }
  // publicRequest preserves business 403s without treating block/member denial as token expiry.
  let result
  try { result = await publicRequest(`/api/meal-meetups${path}`, { method, data, timeout: 10000 }) }
  catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 401 && token && token === getAccessToken()) {
      clearAllStorage()
      redirectToLogin()
    }
    throw error
  }
  if (method === 'POST') Taro.eventCenter.trigger(MEAL_CHANGED)
  return result.data as T
}
export const mealStatus: Record<string, string> = {
  active: '正在找搭子', full: '已满员', started: '已开始', ended: '已结束', cancelled: '已取消', hidden: '已关闭',
  pending: '待发起人确认', accepted: '已加入', rejected: '申请未通过', withdrawn: '已撤回', left: '已退出', removed: '已移出', host: '我发起的',
}
// First release's venue picker publishes China venues with Asia/Shanghai time.
export function chinaDate(value = new Date()): string { return new Date(value.getTime() + 8 * 3600000).toISOString().slice(0, 10) }
export function mealWhen(value: string): string {
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ')
}
