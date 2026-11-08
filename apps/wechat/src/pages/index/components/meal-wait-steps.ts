/** What the home meal card is really doing while the user waits, in the order the server does it. */
export type MealWaitStage = 'locating' | 'searching' | 'scoring' | 'comparing'

export function mealWaitText(stage: MealWaitStage, name: string): string {
  switch (stage) {
    case 'locating': return `${name}在确认你的位置…`
    case 'searching': return '在找你附近开着的店…'
    case 'scoring': return '在算你今天还差多少营养…'
    default: return '在比一比哪几道最合适…'
  }
}
