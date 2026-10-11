import { readFileSync } from 'fs'
import { join } from 'path'
import sharp = require('sharp')
import type { PetProfile } from '../../src/utils/api'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'
import { petRig } from '../../src/utils/pet-rig'
import { petTransportCapabilities } from '../../src/utils/pet-transport'

const identities = [
  ['guigui', 'jianwen-01', ORIGINAL_COMPANION_SRC],
  ['jianwen', 'jianwen-01', JIANWEN_COMPANION_SRC],
  ['huatuo', 'huatuo-01', undefined],
  ['taiji', 'taiji-xiaozi-01', undefined],
  ['xiaomai', 'xiaomai-01', undefined],
  ['doudou', 'doudou-01', undefined],
] as const
const sourceFile = (src: string) => {
  expect(src.startsWith('/assets/pets/')).toBe(true)
  return join(__dirname, '../../src', src.slice(1))
}
const within = (rect: number[], width: number, height: number) => {
  const [x, y, w, h] = rect
  expect(x).toBeGreaterThanOrEqual(0)
  expect(y).toBeGreaterThanOrEqual(0)
  expect(w).toBeGreaterThan(0)
  expect(h).toBeGreaterThan(0)
  expect(x + w).toBeLessThanOrEqual(width)
  expect(y + h).toBeLessThanOrEqual(height)
}

test.each(identities)('%s transport uses complete current character textures without a separate vehicle atlas', async (key, builtin, sprite) => {
  const pet = { builtin_avatar_id: builtin } as PetProfile
  const rig = petRig(pet, sprite)!
  expect(rig.key).toBe(key)
  expect(petTransportCapabilities(pet, sprite)).toEqual(['bicycle', 'scooter', 'skateboard', 'walk'])
  const source = sharp(sourceFile(rig.src))
  const metadata = await source.metadata()
  expect(metadata.hasAlpha).toBe(true)
  for (const rect of [rig.frame, rig.head, rig.torso, ...(rig.hands || []), ...(rig.gripHand ? [rig.gripHand] : [])]) within(rect, metadata.width!, metadata.height!)
  const frame = await sharp(sourceFile(rig.src)).extract({ left: rig.frame[0], top: rig.frame[1], width: rig.frame[2], height: rig.frame[3] }).ensureAlpha().stats()
  expect(frame.channels[3].max).toBe(255)
  expect(frame.channels[3].min).toBe(0)
  expect(rig.floor).toBeGreaterThan(rig.hip.y)
  if (rig.armSource) {
    const arm = await sharp(sourceFile(rig.armSource.src)).metadata()
    expect(arm.hasAlpha).toBe(true)
    within(rig.armSource.hand, arm.width!, arm.height!)
    if (rig.armSource.grip) within(rig.armSource.grip.hand, arm.width!, arm.height!)
  }
})

test('build copies current character and sleeve textures rather than obsolete vehicle sheets', () => {
  const config = readFileSync(join(__dirname, '../../config/index.ts'), 'utf8')
  expect(config).toContain("from: 'src/assets/pets/companions'")
  expect(config).toContain("from: 'src/assets/pets/motions'")
  expect(config).not.toContain("from: 'src/assets/pets/transport'")
})
