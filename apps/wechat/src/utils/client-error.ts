import Taro from '@tarojs/taro'
import { publicRequest } from './api'
import { applyPendingAppUpdate } from './app-update'
import { productUpdateVersion } from './product-updates'

export type ClientErrorKind = 'error' | 'rejection'

const MAX_REPORTS_PER_LAUNCH = 5
const MAX_MESSAGE_LENGTH = 2000
const REPORT_TIMEOUT_MS = 8000
/** Taro 的错误边界要等 React 提交后才会清空页面，稍等再判断是否空白。 */
const PAGE_COMMIT_DELAY_MS = 100
const MAX_RECOVERY_PROMPTS = 2
const HOME_PAGE_URL = '/pages/index/index'
const DELETE_GUIDE = '请在微信首页下拉，长按「食探」删除，再搜索「食探」重新打开并登录。你的饮食记录保存在云端，不会丢失。'

const reported = new Set<string>()
let sawError = false
let recoveryPrompts = 0
let recoveryOpen = false

function errorText(raw: unknown): string {
  const text = raw instanceof Error ? `${raw.message}\n${raw.stack || ''}` : String(raw || '')
  return text.slice(0, MAX_MESSAGE_LENGTH)
}

function currentPage(): { route?: string; $taroPath?: string } | undefined {
  try {
    const pages = Taro.getCurrentPages() as Array<{ route?: string; $taroPath?: string }>
    return pages[pages.length - 1]
  } catch {
    return undefined
  }
}

/**
 * Taro 的页面错误边界捕获渲染异常后只留下一个空 root：
 * 不抛到 wx.onError，页面上也没有任何提示，用户看到的就是白屏。
 */
function currentPageIsBlank(): boolean {
  try {
    const path = currentPage()?.$taroPath
    if (!path) return false
    const root = document.getElementById(path)
    return Boolean(root) && root!.childNodes.length === 0
  } catch {
    return false
  }
}

function reportClientError(kind: ClientErrorKind, message: string, pageBlank: boolean): void {
  const key = `${kind}:${message.slice(0, 200)}`
  if (reported.has(key) || reported.size >= MAX_REPORTS_PER_LAUNCH) return
  reported.add(key)
  const payload = {
    kind,
    message,
    route: String(currentPage()?.route || ''),
    app_version: productUpdateVersion(),
    page_blank: pageBlank,
  }
  try {
    // 后台「运维中心 - 实时日志」可查，不依赖我们自己的后端。
    (Taro as any).getRealtimeLogManager?.()?.error?.('client-error', payload)
  } catch {
    // 日志不可用不影响使用。
  }
  void publicRequest('/api/client-errors', { method: 'POST', data: payload, timeout: REPORT_TIMEOUT_MS }).catch(() => {
    // 上报是尽力而为，失败不再重试，也不能再触发上报。
  })
}

function reopenApp(): void {
  if (applyPendingAppUpdate()) return
  void Taro.reLaunch({ url: HOME_PAGE_URL }).catch(() => {
    // 跳转失败时用户仍可按提示删除后重新打开。
  })
}

function offerRecovery(): void {
  if (recoveryOpen || recoveryPrompts >= MAX_RECOVERY_PROMPTS) return
  recoveryOpen = true
  recoveryPrompts += 1
  const firstPrompt = recoveryPrompts === 1
  void Taro.showModal({
    title: firstPrompt ? '页面打开失败' : '页面还是打不开',
    content: firstPrompt ? '页面出了点问题，点击重新打开。' : DELETE_GUIDE,
    showCancel: false,
    confirmText: firstPrompt ? '重新打开' : '我知道了',
    confirmColor: '#2e6b50',
  }).then(() => {
    recoveryOpen = false
    if (firstPrompt) reopenApp()
  }).catch(() => {
    recoveryOpen = false
  })
}

/** 上报前端错误；如果错误让当前页面变成白屏，再给用户一条出路。 */
export function handleClientError(kind: ClientErrorKind, raw: unknown): void {
  const message = errorText(raw)
  if (kind === 'rejection') {
    reportClientError(kind, message, false)
    return
  }
  sawError = true
  setTimeout(() => {
    const pageBlank = currentPageIsBlank()
    reportClientError(kind, message, pageBlank)
    if (pageBlank) offerRecovery()
  }, PAGE_COMMIT_DELAY_MS)
}

/** 回到前台时页面仍是白屏，再提示一次（比如提示弹窗被别的弹窗顶掉）。 */
export function recheckBlankPageAfterError(): void {
  if (sawError && currentPageIsBlank()) offerRecovery()
}
