import type { MainTabParamList, RootStackParamList } from '../navigation/types'

export type PendingAuthDestination =
  | { kind: 'tab'; tab: keyof MainTabParamList }
  | { kind: 'circle-post-edit'; params?: RootStackParamList['CirclePostEdit'] }
  | { kind: 'invite-friends'; params?: RootStackParamList['InviteFriends'] }

let pendingDestination: PendingAuthDestination | null = null

export function rememberPendingAuthDestination(destination: PendingAuthDestination | null): void {
  pendingDestination = destination
}

export function takePendingAuthDestination(): PendingAuthDestination | null {
  const destination = pendingDestination
  pendingDestination = null
  return destination
}
