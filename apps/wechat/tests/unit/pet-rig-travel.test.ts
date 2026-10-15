import { petRigTravelX } from '../../src/utils/pet-rig-travel'

test('screen-space travel is continuous, monotonic and reaches exact endpoints', () => {
  for (const [from, to, easing] of [[0, 132, 'depart'], [132, -8, 'return']] as const) {
    const travel = { id: 1, from, to, duration: 1000, easing }
    const positions = Array.from({ length: 101 }, (_, i) => petRigTravelX(travel, i * 10))
    expect(positions[0]).toBe(from)
    expect(positions[100]).toBe(to)
    expect(petRigTravelX(travel, 2000)).toBe(to)
    expect(positions.every((x, i) => !i || (x - positions[i - 1]) * (to - from) >= 0)).toBe(true)
    expect(Math.max(...positions.slice(1).map((x, i) => Math.abs(x - positions[i])))).toBeLessThan(5)
  }
})
