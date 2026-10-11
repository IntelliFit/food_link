import Taro, { useShareAppMessage } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { LOGIN_LOGO_URL } from '../utils/static-asset-cdn-url'
import type { MealMeetup } from '../utils/meal-meetup'
import { createMealInvitationCover, getMealInvitation } from './invitation'

export function useMealInvitation(row?: MealMeetup, unavailable = false) {
  const [clock, setClock] = useState(Date.now)
  const invitation = unavailable ? undefined : getMealInvitation(row)
  const key = invitation ? JSON.stringify(invitation) : ''
  const [cover, setCover] = useState({ key: '', imageUrl: '' })
  const startsAt = row?.starts_at
  const status = row?.status

  useEffect(() => {
    if (!startsAt || status !== 'active') return
    const delay = Date.parse(startsAt) - Date.now()
    if (!Number.isFinite(delay) || delay < 0) return
    const timer = setTimeout(() => setClock(Date.now()), Math.min(delay + 50, 2147483647))
    return () => clearTimeout(timer)
  }, [startsAt, status, clock])

  useEffect(() => {
    let active = true
    if (key && cover.key !== key) {
      // The key contains public invitation fields only and avoids redrawing on unrelated reloads.
      void createMealInvitationCover(JSON.parse(key)).then(imageUrl => {
        if (active) setCover({ key, imageUrl })
      }).catch(() => { /* Fall back to the app's public CDN logo, never a screenshot of member details. */ })
    }
    return () => { active = false }
  }, [key, cover.key])

  const canInvite = Boolean(invitation)
  useEffect(() => {
    void Taro.hideShareMenu({ menus: ['shareTimeline'] }).catch(() => {})
    const menu = canInvite
      ? Taro.showShareMenu({ showShareItems: ['shareAppMessage'] })
      : Taro.hideShareMenu({ menus: ['shareAppMessage'] })
    void menu.catch(() => {})
  }, [canInvite])

  useShareAppMessage(() => {
    const current = unavailable ? undefined : getMealInvitation(row)
    if (!current) return { title: '来食探找饭搭子，一起好好吃饭', path: '/pages/community/index', imageUrl: LOGIN_LOGO_URL }
    return { title: current.shareTitle, path: current.path, imageUrl: cover.key === JSON.stringify(current) ? cover.imageUrl : LOGIN_LOGO_URL }
  })

  return invitation
}
