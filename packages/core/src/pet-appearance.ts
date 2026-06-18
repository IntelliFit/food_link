export const PET_ANIMALS = ['cat', 'bunny', 'bear', 'fox', 'hamster'] as const
export const PET_COLORS = ['mint', 'berry', 'sunny', 'aqua', 'grape', 'peach', 'cream', 'matcha'] as const
export const PET_SHAPES = ['round', 'bean', 'puff', 'drop'] as const
export const PET_ACCESSORIES = ['leaf', 'sprout', 'scarf', 'drop', 'star', 'cap', 'bow', 'halo'] as const
export const PET_PATTERNS = ['pattern-0', 'pattern-1', 'pattern-2', 'pattern-3', 'pattern-4'] as const

export type PetAnimal = typeof PET_ANIMALS[number]
export type PetColor = typeof PET_COLORS[number]
export type PetShape = typeof PET_SHAPES[number]
export type PetAccessory = typeof PET_ACCESSORIES[number]
export type PetPattern = typeof PET_PATTERNS[number]

export interface PetAppearanceSeed {
  pet_seed?: string | null
  name?: string | null
  color?: string | null
  shape?: string | null
  accessory?: string | null
  pattern?: string | null
}

export interface DerivedPetAppearance {
  seed: string
  color: string
  shape: string
  animal: PetAnimal
  pattern: string
  accessory: string
}

export function derivePetSeed(pet?: PetAppearanceSeed | null, fallback = 'guest'): string {
  return pet?.pet_seed || pet?.name || fallback
}

export function derivePetAnimal(pet?: PetAppearanceSeed | null, fallback = 'guest'): PetAnimal {
  const seed = derivePetSeed(pet, fallback)
  return PET_ANIMALS[stableHash(`${seed}:animal`) % PET_ANIMALS.length]
}

export function derivePetAppearance(pet?: PetAppearanceSeed | null, fallback = 'guest'): DerivedPetAppearance {
  const seed = derivePetSeed(pet, fallback)
  return {
    seed,
    color: pet?.color || PET_COLORS[stableHash(`${seed}:color`) % PET_COLORS.length],
    shape: pet?.shape || PET_SHAPES[stableHash(`${seed}:shape`) % PET_SHAPES.length],
    animal: PET_ANIMALS[stableHash(`${seed}:animal`) % PET_ANIMALS.length],
    pattern: pet?.pattern || PET_PATTERNS[stableHash(`${seed}:pattern`) % PET_PATTERNS.length],
    accessory: pet?.accessory || PET_ACCESSORIES[stableHash(`${seed}:accessory`) % PET_ACCESSORIES.length],
  }
}

export function stableHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}
