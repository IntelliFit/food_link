// Emoji are plain Unicode so the room gains expression without adding image weight to the package.
export const MEAL_MESSAGE_MAX = 500

export const MEAL_EMOJIS: readonly string[] = [
  '😀', '😄', '😁', '😆', '😅', '🤣', '😊', '😍', '🥰', '😘',
  '😋', '😎', '🤗', '🤔', '😴', '😭', '😢', '😡', '🥺', '🙃',
  '👍', '👌', '🙏', '👏', '💪', '🤝', '👋', '🎉', '❤️', '🔥',
  '🍚', '🍜', '🍲', '🍣', '🍤', '🍗', '🥩', '🥗', '🍕', '🍔',
  '🍢', '🥟', '🍱', '🥘', '🍰', '🍦', '🧋', '☕', '🍺', '🍉',
  '🚶', '🏃', '🕐', '📍', '🚇', '🚲', '☔', '☀️', '🌙', '✅',
]

export const MEAL_QUICK_PHRASES: readonly string[] = [
  '我到了～',
  '我大概晚到10分钟',
  '我在门口等你们',
  '位置在哪儿，发一下～',
  '吃得很开心，下次再约！',
]

// Counts by code point so a surrogate-pair emoji is one character, matching how the server limits length.
export function mealMessageLength(value: string): number {
  return Array.from(value).length
}

export function clipMealText(value: string, max = MEAL_MESSAGE_MAX): string {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') : value
}

export function appendMealText(current: string, addition: string, max = MEAL_MESSAGE_MAX): string {
  const next = `${current}${addition}`
  return mealMessageLength(next) > max ? current : next
}
