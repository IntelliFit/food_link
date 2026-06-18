import { derivePetAnimal, derivePetAppearance, derivePetSeed, stableHash } from '../src'

describe('pet appearance derivation', () => {
  it('matches known mini-program frontend hash outputs for animal shape', () => {
    const examples = [
      ['guest', 'fox'],
      ['seed', 'hamster'],
      ['qingtuan', 'fox'],
      ['user-123', 'bunny'],
      ['pet-seed:with:suffix', 'cat'],
    ] as const

    for (const [seed, animal] of examples) {
      expect(derivePetAnimal({ pet_seed: seed, name: 'fallback-name' })).toBe(animal)
    }
  })

  it('keeps pet_seed ahead of name so the same backend pet stays recognizable cross-platform', () => {
    const withSeed = { pet_seed: 'stable-cross-platform-seed', name: 'renamed companion' }
    const renamed = { pet_seed: 'stable-cross-platform-seed', name: 'another display name' }

    expect(derivePetSeed(withSeed)).toBe('stable-cross-platform-seed')
    expect(derivePetAnimal(withSeed)).toBe(derivePetAnimal(renamed))
  })

  it('derives full fallback appearance from the same mini-program seed contract', () => {
    expect(derivePetAppearance({ pet_seed: 'guest' })).toMatchObject({
      color: 'berry',
      shape: 'drop',
      animal: 'fox',
      pattern: 'pattern-4',
      accessory: 'leaf',
    })
    expect(derivePetAppearance({ pet_seed: 'seed' })).toMatchObject({
      color: 'sunny',
      shape: 'round',
      animal: 'hamster',
      pattern: 'pattern-1',
      accessory: 'sprout',
    })
    expect(derivePetAppearance({ pet_seed: 'pet-seed:with:suffix' })).toMatchObject({
      color: 'aqua',
      shape: 'bean',
      animal: 'cat',
      pattern: 'pattern-4',
      accessory: 'scarf',
    })
  })

  it('keeps backend appearance fields ahead of derived fallback values', () => {
    expect(derivePetAppearance({
      pet_seed: 'guest',
      color: 'matcha',
      shape: 'puff',
      pattern: 'pattern-2',
      accessory: 'halo',
    })).toMatchObject({
      color: 'matcha',
      shape: 'puff',
      animal: 'fox',
      pattern: 'pattern-2',
      accessory: 'halo',
    })
  })

  it('falls back to name and then guest for pre-seed or empty states', () => {
    expect(derivePetSeed({ name: 'qingtuan' })).toBe('qingtuan')
    expect(derivePetSeed(null)).toBe('guest')
  })

  it('keeps the unsigned 31x hash algorithm stable for cross-platform compatibility', () => {
    expect(stableHash('guest:animal')).toBe(3668838878)
    expect(stableHash('seed:animal')).toBe(4271520549)
    expect(stableHash('user-123:animal')).toBe(1277232006)
  })
})
