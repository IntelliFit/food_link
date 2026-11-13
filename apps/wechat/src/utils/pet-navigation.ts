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
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'evening_snack'
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

/**
 * 伙伴页「问问」：进聊天页接着最近一次对话聊（页面会恢复上一段），光标直接放进输入框。
 * 不替用户发任何话；要开新话题，聊天页右上角有「新对话」。
 */
export const PET_CONTINUE_ENTRY = 'pet_tab_continue'

export function continuePetChat(): void {
  Taro.navigateTo({ url: `${extraPkgUrl('/pages/pet-chat/index')}?entry=${PET_CONTINUE_ENTRY}` })
}

/**
 * 「我在意的」只在伙伴页改。别处（完整分析页）点「在伙伴页改」时留一个标记再切到伙伴页，
 * 伙伴页 onShow 读到标记就打开弹窗并清掉标记。
 */
const PET_FOCUS_SHEET_REQUEST_KEY = 'pet_focus_sheet_open_request'
const PET_TAB_URL = '/pages/pet/index'

export function openPetFocusSheet(): void {
  try {
    Taro.setStorageSync(PET_FOCUS_SHEET_REQUEST_KEY, '1')
  } catch (_) {}
  void Taro.switchTab({ url: PET_TAB_URL })
}

/** 伙伴页用：有没有人请它打开「我在意的」；读一次就清掉 */
export function takePetFocusSheetRequest(): boolean {
  try {
    const requested = Boolean(Taro.getStorageSync(PET_FOCUS_SHEET_REQUEST_KEY))
    if (requested) Taro.removeStorageSync(PET_FOCUS_SHEET_REQUEST_KEY)
    return requested
  } catch (_) {
    return false
  }
}

export function openPetSettings(): void {
  openWithoutStacking(extraPkgUrl('/pages/pet-home/index'))
}
