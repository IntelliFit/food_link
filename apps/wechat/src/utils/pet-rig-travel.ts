export interface PetRigTravel {
  id: number
  from: number
  to: number
  duration: number
  easing: 'depart' | 'return'
}

/** Screen-space travel and the joints consume the same animation-clock delta. */
export function petRigTravelX(travel: PetRigTravel, elapsed: number) {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(1, travel.duration)))
  const eased = travel.easing === 'depart' ? t * t : 1 - (1 - t) ** 3
  return travel.from + (travel.to - travel.from) * eased
}
