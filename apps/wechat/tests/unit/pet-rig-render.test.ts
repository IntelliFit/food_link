import { PET_RIGS, rigPose } from '../../src/utils/pet-rig'
import { drawPetRig } from '../../src/utils/pet-rig-render'

test.each(Object.keys(PET_RIGS).flatMap(key => (['bicycle', 'scooter', 'skateboard'] as const).map(vehicle => ({ key, vehicle }))))('$key keeps its outer $vehicle leg visible in front of the garment', ({ key, vehicle }) => {
  const rig = PET_RIGS[key], image = {} as CanvasImageSource
  const drawImage = jest.fn()
  const ctx = new Proxy({ globalAlpha: 1, drawImage }, {
    get(target, property) { return property in target ? target[property as keyof typeof target] : () => undefined },
  }) as unknown as CanvasRenderingContext2D
  drawPetRig(ctx, image, rig, rigPose(rig, vehicle, 'ride', 0), vehicle)
  const calls = drawImage.mock.calls
  const torso = calls.findIndex(call => call.length === 9 && call.slice(1, 5).every((n, i) => n === rig.torso[i]))
  expect(torso).toBeGreaterThan(0)
  // Both textured bones and the attached outer shoe must survive the coat's paint.
  expect(calls[torso + 1]).toEqual([image, 0, 0])
  expect(calls[torso + 2]).toEqual([image, 0, 0])
  expect(calls[torso + 3]).toHaveLength(9)
  expect(calls[torso + 3][1]).toBe(rig.legs[0][2].x - (rig.legWidth + 4) / 2)
})
