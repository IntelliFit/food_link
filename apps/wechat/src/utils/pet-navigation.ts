import Taro from '@tarojs/taro'
import { extraPkgUrl } from './subpackage-extra'

function normalizePageRoute(route?: string): string {
  const normalized = String(route || '').trim().replace(/^\/+/, '')
  return normalized ? `/${normalized}` : ''
}

function openWithoutStacking(url: string): void {
  const pages = Taro.getCurrentPages()
  const previousPage = pages.length >= 2 ? pages[pages.length - 2] : undefined
  const targetRoute = url.split('?')[0]

  if (normalizePageRoute(previousPage?.route) === targetRoute) {
    Taro.navigateBack({ delta: 1 })
    return
  }

  Taro.navigateTo({ url })
}

export type PetChatHomeMealEntry = {
  selectedSourceID?: string
  source: 'home_next_meal'
  date: string
  mealType: 'breakfast' | 'lunch' | 'dinner'
  mealLabel: string
  basicAdvice: string
  starterQuestion: string
}

export function openPetChat(input?: unknown): void {
  const context = input && typeof input === 'object' ? input as Partial<PetChatHomeMealEntry> : null
  const starter = typeof input === 'string'
    ? input.trim()
    : String(context?.starterQuestion || '').trim()
  const params: Array<[string, string]> = []
  if (starter) params.push(['starter', starter])
  if (context?.source === 'home_next_meal') {
    params.push(
      ['entry', context.source],
      ['date', String(context.date || '').trim()],
      ['meal_type', String(context.mealType || '').trim()],
      ['meal_label', String(context.mealLabel || '').trim()],
      ['advice', String(context.basicAdvice || '').trim()],
      ['meal_id', String(context.selectedSourceID || '').trim()],
    )
  }
  const query = params.length
    ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
    : ''
  const url = `${extraPkgUrl('/pages/pet-chat/index')}${query}`
  // A newly selected meal must reach onLoad; navigating back discards its context.
  if (context?.source === 'home_next_meal') Taro.navigateTo({ url })
  else openWithoutStacking(url)
}

export function openPetSettings(): void {
  openWithoutStacking(extraPkgUrl('/pages/pet-home/index'))
}
