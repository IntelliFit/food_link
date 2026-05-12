export interface WeappShareImageMenuErrorLike {
  errMsg?: string
}

export function isShowShareImageMenuCancel(err?: WeappShareImageMenuErrorLike | null): boolean {
  const message = String(err?.errMsg || '').trim().toLowerCase()
  if (!message) return false
  return message.includes('showshareimagemenu:fail cancel') || message.includes('cancel')
}
