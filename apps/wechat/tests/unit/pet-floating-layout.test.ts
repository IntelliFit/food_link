import { floatingPetLayout } from '../../src/utils/pet-floating-layout'
import { PET_RIGS, rigPose } from '../../src/utils/pet-rig'
import { JIANWEN_COMPANION_SRC, ORIGINAL_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

test.each(Object.values(PET_RIGS))('$key preserves source scale and ground contact across phone widths and tools', rig => {
  const sprite = rig.key === 'guigui' ? ORIGINAL_COMPANION_SRC : rig.key === 'jianwen' ? JIANWEN_COMPANION_SRC : undefined
  const pet = { builtin_avatar_id: rig.key === 'taiji' ? 'taiji-xiaozi-01' : rig.key+'-01' }
  for (const width of [320, 375, 402, 430]) {
    for (const vehicle of ['bicycle', 'scooter', 'skateboard', 'walk'] as const) {
      const layout = floatingPetLayout(pet, sprite, vehicle, width)
      const walking = vehicle === 'walk'
      const pose = rigPose(rig, walking ? undefined : vehicle, walking ? 'walk' : 'ride', 0)
      const unit = walking ? layout.transportSize * .85 / 220 : layout.transportSize / 200
      expect(unit * pose.scale).toBeCloseTo(layout.standingSize / rig.frame[3], 8)
      expect(layout.top + pose.floor * unit + (walking ? layout.transportSize * .05 : 0)).toBeCloseTo(layout.ground, 8)
      expect(layout.left + layout.transportSize / 2).toBeCloseTo(20 * width / 750 + rig.hip.x * layout.standingSize / rig.frame[3], 8)
      // At the parked position the entire moving plane is beyond the right edge.
      expect(width + 28 * width / 750 + layout.left).toBeGreaterThan(width)
    }
  }
})
