export type RankingPreviewSettled<TUser, TFood, TContribution> = {
  user: PromiseSettledResult<TUser> | null
  food: PromiseSettledResult<TFood>
  contribution: PromiseSettledResult<TContribution> | null
}

export async function settleRankingPreviewRequests<TUser, TFood, TContribution = never>(
  userRequest: Promise<TUser> | null,
  foodRequest: Promise<TFood>,
  contributionRequest: Promise<TContribution> | null = null,
): Promise<RankingPreviewSettled<TUser, TFood, TContribution>> {
  const [user, food, contribution] = await Promise.allSettled([
    userRequest || Promise.resolve(null),
    foodRequest,
    contributionRequest || Promise.resolve(null),
  ])
  return {
    user: userRequest ? user as PromiseSettledResult<TUser> : null,
    food: food as PromiseSettledResult<TFood>,
    contribution: contributionRequest ? contribution as PromiseSettledResult<TContribution> : null,
  }
}
