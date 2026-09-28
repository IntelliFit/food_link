import { resolveInviteProfileTarget } from '../../src/packageExtra/pages/invite-friends/invite-profile-target'

describe('resolveInviteProfileTarget', () => {
  it('uses the scanned invite code instead of the signed-in user', () => {
    expect(resolveInviteProfileTarget({
      routeInviteCode: 'kai-code',
      currentUserId: 'xiaomage-user-id',
    })).toEqual({ type: 'invite_code', value: 'kai-code' })
  })

  it('prefers an explicit shared user id over the invite code', () => {
    expect(resolveInviteProfileTarget({
      routeFromUserId: 'kai-user-id',
      routeInviteCode: 'kai-code',
      currentUserId: 'xiaomage-user-id',
    })).toEqual({ type: 'user_id', value: 'kai-user-id' })
  })

  it('falls back to the signed-in user only for the personal invite page', () => {
    expect(resolveInviteProfileTarget({
      currentUserId: 'xiaomage-user-id',
    })).toEqual({ type: 'user_id', value: 'xiaomage-user-id' })
  })

  it('ignores empty route values', () => {
    expect(resolveInviteProfileTarget({
      routeFromUserId: '  ',
      routeInviteCode: '',
      currentUserId: '  ',
    })).toBeNull()
  })
})
