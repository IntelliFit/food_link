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

export function openPetChat(starterQuestion?: unknown): void {
  const starter = typeof starterQuestion === 'string' ? starterQuestion.trim() : ''
  const query = starter ? `?starter=${encodeURIComponent(starter)}` : ''
  openWithoutStacking(`${extraPkgUrl('/pages/pet-chat/index')}${query}`)
}

export function openPetSettings(): void {
  openWithoutStacking(extraPkgUrl('/pages/pet-home/index'))
}
