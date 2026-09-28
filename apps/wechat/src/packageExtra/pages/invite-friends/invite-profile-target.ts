export type InviteProfileTarget =
  | { type: 'user_id'; value: string }
  | { type: 'invite_code'; value: string }

export function resolveInviteProfileTarget(input: {
  routeFromUserId?: string
  routeInviteCode?: string
  currentUserId?: string
}): InviteProfileTarget | null {
  const routeFromUserId = String(input.routeFromUserId || '').trim()
  if (routeFromUserId) return { type: 'user_id', value: routeFromUserId }

  const routeInviteCode = String(input.routeInviteCode || '').trim()
  if (routeInviteCode) return { type: 'invite_code', value: routeInviteCode }

  const currentUserId = String(input.currentUserId || '').trim()
  if (currentUserId) return { type: 'user_id', value: currentUserId }

  return null
}
