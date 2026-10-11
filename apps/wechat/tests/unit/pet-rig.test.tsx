import { fireEvent, render } from '@testing-library/react'
import { PET_RIGS, bend, distance, petRig, rigPose, shoeProjection } from '../../src/utils/pet-rig'
import { PetTransportPicker } from '../../src/packagePetStudio/components/PetTransportPicker'
import Taro from '@tarojs/taro'
import { ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import type { PetProfile } from '../../src/utils/api'

const soleBottom = (rig: typeof PET_RIGS[string], pose: ReturnType<typeof rigPose>, i: number) => {
  const shoe = shoeProjection(rig, pose.scale, pose.bodyWidth, pose.footHeading[i])
  return pose.legs[i][2].y + 3 + shoe.width / 2 * Math.abs(Math.sin(pose.footAngles[i])) + shoe.toe * Math.sin(pose.footAngles[i]) + pose.footDepth[i]
}
const kneeBendsForward = (pose: ReturnType<typeof rigPose>, i: number) => {
  const [hip, knee, ankle] = pose.legs[i]
  return (ankle.x - hip.x) * (knee.y - hip.y) - (ankle.y - hip.y) * (knee.x - hip.x)
}

test('nickname cannot change the approved source or unlock another photo character', () => {
  expect(petRig({ name: '鬼鬼', builtin_avatar_id: 'jianwen-01' })?.key).toBe('jianwen')
  expect(petRig({ name: '建文', builtin_avatar_id: 'jianwen-01' }, ORIGINAL_COMPANION_SRC)?.key).toBe('guigui')
  expect(petRig({ pixel_motion_version: 1, pixel_motion_atlas_url: 'my-photo.png' })).toBeUndefined()
  expect(petRig({ builtin_avatar_id: 'huatuo-01' }, '/different-person.png')).toBeUndefined()
})
test.each(Object.keys(PET_RIGS))('%s contacts the pedals throughout a complete cycle without stretching bones', key => {
  const rig = PET_RIGS[key]
  for (let ms = 0; ms <= 1600; ms += 10) {
    const pose = rigPose(rig, 'bicycle', 'ride', ms)
    for (const i of [0, 1]) {
      expect(distance(pose.legs[i][2], pose.pedals[i])).toBeLessThan(.001)
      expect(distance(pose.pedals[i], pose.crank)).toBeCloseTo(pose.radius, 6)
      for (const part of [0, 1]) expect(distance(pose.legs[i][part], pose.legs[i][part + 1])).toBeCloseTo(distance(rig.legs[i][part], rig.legs[i][part + 1]) * pose.scale, 5)
      const [hip, knee, ankle] = pose.legs[i]
      const upper = distance(hip, knee), lower = distance(knee, ankle), reach = distance(hip, ankle)
      const angle = Math.acos(Math.max(-1, Math.min(1, (upper * upper + lower * lower - reach * reach) / (2 * upper * lower)))) * 180 / Math.PI
      expect(angle).toBeGreaterThan(55)
      expect(angle).toBeLessThan(155)
    }
    expect(pose.pedals[0].x + pose.pedals[1].x).toBeCloseTo(pose.crank.x * 2, 6)
    expect(pose.pedals[0].y + pose.pedals[1].y).toBeCloseTo(pose.crank.y * 2, 6)
    const binding = rig.armSource?.grip || rig.gripBinding
    const handScale = pose.scale * (rig.armSource?.grip ? rig.armWidth / rig.armSource.width : 1)
    const offset = binding ? { x: (binding.contact.x - binding.wrist.x) * handScale, y: (binding.contact.y - binding.wrist.y) * handScale } : { x: 0, y: 0 }
    for (const side of [0, 1]) {
      const contact = side === 0 ? pose.farGrip : pose.grip
      expect(contact.x - pose.arms[side][2].x).toBeCloseTo(offset.x, 6)
      expect(contact.y - pose.arms[side][2].y).toBeCloseTo(offset.y, 6)
    }
    expect(pose.farGrip.y).toBeCloseTo(pose.grip.y, 6)
    expect(pose.farGrip.x).toBeCloseTo(pose.grip.x - 3, 6)
  }
})
test.each(Object.keys(PET_RIGS))('%s scooter keeps a planted foot, pushes along the ground and returns to the deck', key => {
  const rig = PET_RIGS[key], stages = new Set<string>()
  const rest = rigPose(rig, 'scooter', 'ride', 0)
  let lastX = Infinity
  for (let ms = 0; ms < 3200; ms += 10) {
    const pose = rigPose(rig, 'scooter', 'ride', ms)
    stages.add(pose.stage)
    expect(pose.legs[1][2].x).toBeCloseTo(105, 5)
    expect(pose.legs[1][2].y + pose.footDepth[1]).toBeCloseTo(pose.deck, 5)
    if (pose.stage === '蹬地') {
      expect(soleBottom(rig, pose, 0)).toBeCloseTo(pose.floor, 5)
      expect(pose.legs[0][2].x).toBeLessThanOrEqual(lastX)
      lastX = pose.legs[0][2].x
    }
    if (pose.stage === '滑行') {
      expect(pose.legs[0][2].y + pose.footDepth[0]).toBeCloseTo(pose.deck, 5)
      const [hip, knee, foot] = pose.legs[1], upper = distance(hip, knee), lower = distance(knee, foot)
      const kneeAngle = Math.acos((upper ** 2 + lower ** 2 - distance(hip, foot) ** 2) / (2 * upper * lower)) * 180 / Math.PI
      expect(kneeAngle).toBeGreaterThan(130)
    }
    const binding = rig.armSource?.grip || rig.gripBinding
    const handScale = pose.scale * (rig.armSource?.grip ? rig.armWidth / rig.armSource.width : 1)
    const gripOffset = binding ? {
      x: (binding.contact.x - binding.wrist.x) * handScale,
      y: (binding.contact.y - binding.wrist.y) * handScale,
    } : { x: 0, y: 0 }
    expect(pose.farGrip.x - pose.arms[0][2].x).toBeCloseTo(gripOffset.x, 6)
    expect(pose.farGrip.y - pose.arms[0][2].y).toBeCloseTo(gripOffset.y, 6)
    expect(distance(pose.grip, rest.grip)).toBeLessThan(.000001)
    expect(distance(pose.farGrip, rest.farGrip)).toBeLessThan(.000001)
    expect(pose.farGrip.x).toBeLessThan(pose.grip.x - 5)
    for (const [shoulder, elbow, wrist] of pose.armLocal) {
      const upper = distance(shoulder, elbow), lower = distance(elbow, wrist)
      const elbowAngle = Math.acos((upper ** 2 + lower ** 2 - distance(shoulder, wrist) ** 2) / (2 * upper * lower)) * 180 / Math.PI
      expect(elbowAngle).toBeGreaterThan(135)
      expect(elbowAngle).toBeLessThan(175)
      // Both wrists remain on the forward-facing bar; neither elbow turns up.
      expect(wrist.x).toBeGreaterThan(shoulder.x)
      expect((wrist.x - shoulder.x) * (elbow.y - shoulder.y) - (wrist.y - shoulder.y) * (elbow.x - shoulder.x)).toBeGreaterThan(0)
    }
    for (const i of [0, 1]) {
      const source = rig.shoulders?.[i] || { x: rig.arms[i][0].x % (rig.key === 'jianwen' ? 160 : 1000), y: rig.arms[i][0].y }
      const offset = (source.x - rig.hip.x) * pose.scale
      const x = offset * pose.bodyWidth, y = (source.y - rig.hip.y) * pose.scale + offset * pose.bodySkew
      expect(pose.arms[i][0].x).toBeCloseTo(pose.hip.x + x * Math.cos(pose.angle) - y * Math.sin(pose.angle), 5)
      expect(pose.arms[i][0].y).toBeCloseTo(pose.hip.y + x * Math.sin(pose.angle) + y * Math.cos(pose.angle), 5)
    }
    for (const i of [0, 1]) for (const part of [0, 1]) {
      const length = distance(rig.arms[i][part], rig.arms[i][part + 1]) * pose.scale
      expect(distance(pose.armLocal[i][part], pose.armLocal[i][part + 1])).toBeCloseTo(length, 5)
      expect(distance(pose.arms[i][part], pose.arms[i][part + 1])).toBeLessThanOrEqual(length + .001)
    }
    for (const i of [0, 1]) expect(kneeBendsForward(pose, i)).toBeLessThanOrEqual(.001)
    for (const i of [0, 1]) for (const part of [0, 1]) expect(distance(pose.legLocal[i][part], pose.legLocal[i][part + 1])).toBeCloseTo(distance(rig.legs[i][part], rig.legs[i][part + 1]) * pose.scale, 5)
  }
  expect([...stages]).toEqual(['滑行', '落脚', '蹬地', '提脚', '收脚'])
  expect(rigPose(rig, 'scooter', 'ride', 0).legs).toEqual(rigPose(rig, 'scooter', 'ride', 3200).legs)
})
test.each(Object.keys(PET_RIGS))('%s board has a distinct two-foot stance, planted front foot and grounded push', key => {
  const rig = PET_RIGS[key], cruising = rigPose(rig, 'skateboard', 'ride', 0)
  expect(cruising.legs[1][2].x).toBeGreaterThan(cruising.hip.x)
  expect(cruising.legs[0][2].x).toBeLessThan(cruising.hip.x)
  expect(cruising.footHeading[1]).toBeCloseTo(-Math.PI / 2)
  expect(rigPose(rig, 'skateboard', 'ride', .65 * 3400).footHeading[1]).toBeCloseTo(0)
  expect(rigPose(rig, 'skateboard', 'ride', .99 * 3400).footHeading[1]).toBeLessThan(-1.5)
  expect(cruising.arms[1][2].x).not.toBeCloseTo(rigPose(rig, 'scooter', 'ride', 0).grip.x)
  for (let ms = 0; ms < 3400; ms += 10) {
    const pose = rigPose(rig, 'skateboard', 'ride', ms)
    expect(distance(pose.legs[1][2], cruising.legs[1][2])).toBeLessThan(1e-10)
    if (pose.stage === '蹬地') expect(soleBottom(rig, pose, 0)).toBeCloseTo(pose.floor, 5)
    for (const i of [0, 1]) expect(kneeBendsForward(pose, i)).toBeLessThanOrEqual(.001)
    for (const i of [0, 1]) for (const part of [0, 1]) expect(distance(pose.legLocal[i][part], pose.legLocal[i][part + 1])).toBeCloseTo(distance(rig.legs[i][part], rig.legs[i][part + 1]) * pose.scale, 5)
  }
  expect(rigPose(rig, 'skateboard', 'ride', 3399).legs[0][2].x).toBeCloseTo(cruising.legs[0][2].x, 2)
})
test.each(Object.keys(PET_RIGS))('%s walks with grounded support, lifted swing and opposing arms without limb stretching', key => {
  const rig = PET_RIGS[key]
  let lifted = false
  for (let ms = 0; ms < 1800; ms += 10) {
    const pose = rigPose(rig, undefined, 'walk', ms)
    expect(pose.contacts.some((contact, i) => contact !== 'air' && Math.abs(soleBottom(rig, pose, i) - pose.floor) < .001)).toBe(true)
    lifted ||= pose.legs.some(leg => leg[2].y < 186)
    for (const i of [0, 1]) {
      const footOffset = pose.legs[i][2].x - pose.legs[i][0].x
      const upperArmOffset = pose.arms[i][1].x - pose.arms[i][0].x
      expect(footOffset * upperArmOffset).toBeLessThanOrEqual(.001)
      expect(kneeBendsForward(pose, i)).toBeLessThanOrEqual(.001)
      for (const part of [0, 1]) {
        expect(distance(pose.legLocal[i][part], pose.legLocal[i][part + 1])).toBeCloseTo(distance(rig.legs[i][part], rig.legs[i][part + 1]) * pose.scale, 5)
        expect(distance(pose.legs[i][part], pose.legs[i][part + 1])).toBeLessThanOrEqual(distance(rig.legs[i][part], rig.legs[i][part + 1]) * pose.scale + .001)
        const physicalLength = distance(rig.arms[i][part], rig.arms[i][part + 1]) * pose.scale
        expect(distance(pose.armLocal[i][part], pose.armLocal[i][part + 1])).toBeCloseTo(physicalLength, 5)
        expect(distance(pose.arms[i][part], pose.arms[i][part + 1])).toBeLessThanOrEqual(physicalLength + .001)
      }
    }
  }
  expect(lifted).toBe(true)
  expect(rigPose(rig, undefined, 'walk', 1799).legs[0][2].x).toBeCloseTo(rigPose(rig, undefined, 'walk', 0).legs[0][2].x, 2)
})
test.each(Object.keys(PET_RIGS))('%s crosses walking contacts without a pelvis or knee snap', key => {
  const rig = PET_RIGS[key]
  for (const phase of [0, .1, .12, .42, .5, .6, .62, .92]) {
    const before = rigPose(rig, undefined, 'walk', (phase - 1e-5) * 1800)
    const after = rigPose(rig, undefined, 'walk', (phase + 1e-5) * 1800)
    expect(distance(before.hip, after.hip)).toBeLessThan(.01)
    for (const side of [0, 1]) for (const joint of [0, 1, 2]) {
      expect(distance(before.legs[side][joint], after.legs[side][joint])).toBeLessThan(.01)
      expect(distance(before.arms[side][joint], after.arms[side][joint])).toBeLessThan(.01)
    }
  }
})
test.each(Object.keys(PET_RIGS))('%s shoulders visibly drive smooth arm swings and elbows only flex forwards', key => {
  const rig = PET_RIGS[key], angles: number[] = []
  let previous: number | undefined
  for (let ms = 0; ms <= 1800; ms += 10) {
    const pose = rigPose(rig, undefined, 'walk', ms)
    for (const [shoulder, elbow, wrist] of pose.armLocal) {
      const upper = Math.atan2(elbow.x - shoulder.x, elbow.y - shoulder.y)
      const lower = Math.atan2(wrist.x - elbow.x, wrist.y - elbow.y)
      expect(lower - upper).toBeGreaterThan(.15)
      expect(lower - upper).toBeLessThan(.41)
    }
    const [shoulder, elbow] = pose.armLocal[0], angle = Math.atan2(elbow.x - shoulder.x, elbow.y - shoulder.y)
    angles.push(angle)
    if (previous !== undefined) expect(Math.abs(angle - previous)).toBeLessThan(.02)
    previous = angle
  }
  expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(.65)
  expect(rigPose(rig, undefined, 'walk', 0).arms).toEqual(rigPose(rig, undefined, 'walk', 1800).arms)
  const back = rigPose(rig, undefined, 'walk', 0), forward = rigPose(rig, undefined, 'walk', 1080)
  expect(back.armDepth[0][2]).toBeLessThan(forward.armDepth[0][2])
  expect(forward.armDepth[0][2]).toBeGreaterThan(0)
  expect(back.armDepth[0][0]).toBeGreaterThan(0)
  expect(forward.armDepth[0][0]).toBeGreaterThan(0)
  expect(back.armDepth[1][0]).toBeLessThan(0)
  expect(forward.armDepth[1][0]).toBeLessThan(0)
  const elbowFlex = (pose: ReturnType<typeof rigPose>) => {
    const [s, e, w] = pose.armLocal[0]
    return Math.atan2(w.x - e.x, w.y - e.y) - Math.atan2(e.x - s.x, e.y - s.y)
  }
  expect(elbowFlex(forward)).toBeGreaterThan(elbowFlex(back) + .20)
  const cruise = rigPose(rig, 'skateboard', 'ride', 0), push = rigPose(rig, 'skateboard', 'ride', 3400 * .70)
  expect(push.armLocal[0][1].x).toBeGreaterThan(cruise.armLocal[0][1].x)
  expect(push.armLocal[1][1].x).toBeLessThan(cruise.armLocal[1][1].x)
})
test.each(Object.keys(PET_RIGS))('%s has heel loading, toe-off and an airborne recovery instead of flat sliding shoes', key => {
  const rig = PET_RIGS[key]
  const heel = rigPose(rig, undefined, 'walk', 0), toe = rigPose(rig, undefined, 'walk', 1000), swing = rigPose(rig, undefined, 'walk', 1400)
  expect(heel.contacts[0]).toBe('heel'); expect(heel.footAngles[0]).toBeLessThan(0)
  expect(toe.contacts[0]).toBe('toe'); expect(toe.footAngles[0]).toBeGreaterThan(0)
  expect(swing.contacts[0]).toBe('air'); expect(soleBottom(rig, swing, 0)).toBeLessThan(swing.floor)
  expect(soleBottom(rig, heel, 0)).toBeCloseTo(heel.floor, 5)
  expect(soleBottom(rig, toe, 0)).toBeCloseTo(toe.floor, 5)
})
test('analytic IK bends without length changes', () => {
  const a = { x: 0, y: 0 }, b = { x: 4, y: 4 }, joint = bend(a, b, 4, 3)
  expect(distance(a, joint)).toBeCloseTo(4)
  expect(distance(joint, b)).toBeCloseTo(3)
})
test('preview pause and resume do not save tools or spend currency', () => {
  jest.clearAllMocks(); (Taro.getStorageSync as jest.Mock).mockReturnValue('')
  const { container } = render(<PetTransportPicker pet={{ id: 'p', builtin_avatar_id: 'jianwen-01' } as PetProfile} account='a' active canSave={() => true} />)
  const toggle = container.querySelector('#journey-motion-toggle')!
  fireEvent.click(toggle)
  expect(container.querySelector('.pet-transport-actor')).toHaveClass('is-paused')
  fireEvent.click(toggle)
  expect(container.querySelector('.pet-transport-actor')).not.toHaveClass('is-paused')
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
})
