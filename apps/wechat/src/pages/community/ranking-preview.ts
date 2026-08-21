export type RankingPreviewSettled<TUser, TFood> = {
  user: PromiseSettledResult<TUser> | null
  food: PromiseSettledResult<TFood>
}

export async function settleRankingPreviewRequests<TUser, TFood>(
  userRequest: Promise<TUser> | null,
  foodRequest: Promise<TFood>
): Promise<RankingPreviewSettled<TUser, TFood>> {
  const [user, food] = await Promise.allSettled([
    userRequest || Promise.resolve(null),
    foodRequest,
  ])
  return {
    user: userRequest ? user as PromiseSettledResult<TUser> : null,
    food: food as PromiseSettledResult<TFood>,
  }
}
