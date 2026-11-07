import assert from 'node:assert/strict'
import test from 'node:test'

import { campaignInputFromForm, emptyCampaignForm, sharePath } from '../src/lib/campus-campaign-form.ts'

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
  assert.deepEqual(campaignInputFromForm({ ...filled(), orgId: '' }), { error: '请选择社团' })
  assert.deepEqual(campaignInputFromForm({ ...filled(), endsAt: '2026-11-01T00:00' }), { error: '请填写正确的起止时间' })
  assert.deepEqual(campaignInputFromForm({ ...filled(), coreCap: '300' }), { error: '核心成员名额需在 0 到 200 之间' })
  assert.match(String((campaignInputFromForm({ ...filled(), leaders: 'not-an-id' }) as { error: string }).error), /负责人 ID 不正确/)
})

test('share path points at the campaign page', () => {
  assert.equal(sharePath('ABC234'), 'packageResearch/pages/campus-campaign/index?code=ABC234')
})
