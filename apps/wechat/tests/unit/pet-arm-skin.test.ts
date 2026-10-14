import { armSkin } from '../../src/utils/pet-arm-skin'
import { boardingPose, distance, PET_RIGS, rigPose } from '../../src/utils/pet-rig'

const area = (points: { x: number; y: number }[]) => (points[1].x - points[0].x) * (points[2].y - points[0].y) - (points[1].y - points[0].y) * (points[2].x - points[0].x)

test.each(Object.keys(PET_RIGS))('%s arm skin retains winding through complete motion cycles', key => {
  const rig = PET_RIGS[key]
  for (const tool of ['bicycle', 'scooter', 'skateboard', 'walk'] as const) {
    const duration = tool === 'bicycle' ? 1600 : tool === 'scooter' ? 3200 : tool === 'skateboard' ? 3400 : 1800
    for (let sample = 0; sample < 60; sample++) {
      const pose = rigPose(rig, tool, tool === 'walk' ? 'walk' : 'ride', duration * sample / 60)
      for (const side of [0, 1]) {
        const source = rig.armSource?.bone || rig.arms[side]
        const hipX = rig.armSource?.hipX || rig.hip.x + Math.floor(source[0].x / rig.frame[2]) * rig.frame[2]
        const width = rig.armSource?.width || rig.armWidth
        const triangles = armSkin(source, pose.arms[side], width, pose.scale * rig.armWidth / width, hipX)
        for (const triangle of triangles) {
          const sourceArea = area(triangle.map(vertex => vertex.source)), targetArea = area(triangle.map(vertex => vertex.target))
          expect(sourceArea).toBeLessThan(-.001)
          expect(targetArea).toBeLessThan(-.001)
        }
        // Adjacent quads share the actual vertex objects, so neither animation
        // nor affine mapping can leave a geometric crack at their boundary.
        for (let i = 0; i < triangles.length - 2; i += 2) {
          expect(triangles[i][2]).toBe(triangles[i + 2][0])
          expect(triangles[i + 1][1]).toBe(triangles[i + 2][1])
        }
      }
    }
  }
})

test.each(Object.keys(PET_RIGS))('%s boarding and alighting retain arm lengths and unfolded UV strips', key => {
  const rig = PET_RIGS[key]
  let maxSourceArea = -Infinity, maxTargetArea = -Infinity, minBone = Infinity
  for (const tool of ['bicycle', 'scooter', 'skateboard'] as const) {
    const cycle = tool === 'bicycle' ? 1600 : tool === 'scooter' ? 3200 : 3400
    for (let phase = 0; phase < 10; phase++) for (let step = 0; step <= 40; step++) {
      const pose = boardingPose(rig, rigPose(rig, tool, 'ride', cycle * phase / 10), step / 40)
      for (const side of [0, 1]) {
        minBone = Math.min(minBone, distance(pose.arms[side][0], pose.arms[side][1]), distance(pose.arms[side][1], pose.arms[side][2]))
        const source = rig.armSource?.bone || rig.arms[side], width = rig.armSource?.width || rig.armWidth
        const hipX = rig.armSource?.hipX || rig.hip.x + Math.floor(source[0].x / rig.frame[2]) * rig.frame[2]
        for (const triangle of armSkin(source, pose.arms[side], width, pose.scale * rig.armWidth / width, hipX)) {
          const a = area(triangle.map(vertex => vertex.source)), b = area(triangle.map(vertex => vertex.target))
          if (!Number.isFinite(a) || !Number.isFinite(b)) throw Error('Non-finite arm mesh')
          maxSourceArea = Math.max(maxSourceArea, a); maxTargetArea = Math.max(maxTargetArea, b)
        }
      }
    }
  }
  expect(minBone).toBeGreaterThan(1)
  expect(maxSourceArea).toBeLessThan(-.001)
  expect(maxTargetArea).toBeLessThan(-.001)
})
