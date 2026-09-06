import AsyncStorage from '@react-native-async-storage/async-storage'

export const HOME_PET_MEAL_PROMPT_SEEN_KEY = 'home_pet_meal_prompt_seen_v1'

function promptKey(userId: string, date: string, mealType: string): string {
  return `${userId.trim()}:${date}:${mealType}`
}

function parseSeenMap(raw: string | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => entry[1] === true),
    )
  } catch {
    return {}
  }
}

export async function hasSeenHomePetMealPrompt(
  userId: string,
  date: string,
  mealType: string,
): Promise<boolean> {
  const key = promptKey(userId, date, mealType)
  if (!userId.trim() || !date || !mealType) return true
  const seen = parseSeenMap(await AsyncStorage.getItem(HOME_PET_MEAL_PROMPT_SEEN_KEY))
  return seen[key] === true
}

export async function markHomePetMealPromptSeen(
  userId: string,
  date: string,
  mealType: string,
): Promise<void> {
  if (!userId.trim() || !date || !mealType) return
  const key = promptKey(userId, date, mealType)
  const seen = parseSeenMap(await AsyncStorage.getItem(HOME_PET_MEAL_PROMPT_SEEN_KEY))
  delete seen[key]
  seen[key] = true
  const recent = Object.fromEntries(Object.entries(seen).slice(-30))
  await AsyncStorage.setItem(HOME_PET_MEAL_PROMPT_SEEN_KEY, JSON.stringify(recent))
}
