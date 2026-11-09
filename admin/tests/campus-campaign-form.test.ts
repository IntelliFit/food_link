import assert from 'node:assert/strict'
import test from 'node:test'

import {
  campaignInputFromForm,
  clubKey,
  defaultCampaignForm,
  emptyCampaignForm,
  findSameClub,
  inviteText,
  beijingDay,
  sharePath,
} from '../src/lib/campus-campaign-form.ts'

const filled = () => ({
  ...emptyCampaignForm(), orgId: 'org-1', title: ' 秋季称重月 ', startsAt: '2026-11-10T08:00', endsAt: '2026-12-08T23:59',
  leaders: '11111111-2222-3333-4444-555555555555，aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
})

test('builds the campaign request in Beijing time', () => {
  const input = campaignInputFromForm(filled())
  assert.ok(!('error' in input))
  assert.equal(input.title, '秋季称重月')
  assert.equal(input.starts_at, '2026-11-10T00:00:00.000Z')
  assert.equal(input.core_member_cap, 15)
  assert.equal(input.membership_plan_code, 'standard_monthly')
  assert.equal(input.leader_user_ids.length, 2)
})

test('rejects incomplete or wrong input', () => {
  assert.match(String((campaignInputFromForm({ ...filled(), orgId: '' }) as { error: string }).error), /先选社团/)
  assert.deepEqual(campaignInputFromForm({ ...filled(), endsAt: '2026-11-01T00:00' }), { error: '请填写正确的起止时间' })
  assert.deepEqual(campaignInputFromForm({ ...filled(), coreCap: '300' }), { error: '核心成员名额需在 0 到 200 之间' })
  assert.match(String((campaignInputFromForm({ ...filled(), leaders: 'not-an-id' }) as { error: string }).error), /负责人 ID 不正确/)
})

test('prefills four weeks starting this hour in Beijing time', () => {
  // 2026-11-08 20:35 UTC is 04:35 on the 9th in Beijing: the campaign starts at 04:00, not 08:00.
  const form = defaultCampaignForm(Date.UTC(2026, 10, 8, 20, 35), 'org-9')
  assert.equal(form.orgId, 'org-9')
  assert.equal(form.startsAt, '2026-11-09T04:00')
  assert.equal(form.endsAt, '2026-12-06T23:59')
  assert.ok(!('error' in campaignInputFromForm(form)))
})

test('treats the same club under a slightly different name as one club', () => {
  assert.equal(clubKey('清华大学健身协会', '清华大学'), clubKey('健身 协会', '清华大学'))
  assert.notEqual(clubKey('健美协会', '清华大学'), clubKey('健身协会', '清华大学'))
  const clubs = [{ id: 'a', school_id: 's1', name: '清华大学健身协会' }, { id: 'b', school_id: 's2', name: '健身协会' }]
  assert.equal(findSameClub(clubs, 's1', '清华大学', '健身协会')?.id, 'a')
  assert.equal(findSameClub(clubs, 's1', '清华大学', '健美协会'), undefined)
  assert.equal(findSameClub(clubs, 's1', '清华大学', '  '), undefined)
})

test('the invite text says how to join and what the leader does', () => {
  const text = inviteText({ title: '秋季称重月', join_code: 'ABC234', school_name: '清华大学', org_name: '健身协会', ends_at: '2026-12-06T15:59:00Z' }, 15)
  assert.match(text, /加入码：ABC234/)
  assert.match(text, /我的 → 科研共建 → 高校伙伴计划/)
  assert.match(text, /最多 15 人/)
})

test('share path points at the campaign page', () => {
  assert.equal(sharePath('ABC234'), 'packageResearch/pages/campus-campaign/index?code=ABC234')
})

test('shows API times as Beijing dates', () => {
  assert.equal(beijingDay('2026-11-08T21:00:00Z'), '2026-11-09')
  assert.equal(beijingDay('2026-12-06T15:59:00Z'), '2026-12-06')
})
