/**
 * 注册新流程（onboarding_v2 实验组 pet_flow）的纯逻辑：开关判断、本地标记、
 * 一句话身体情况解析、数字展示格式。页面和接口调用不放在这里，便于单测。
 */

export const ONBOARDING_EXPERIMENT = 'onboarding_v2'
export const ONBOARDING_CONTROL = 'control'
export const ONBOARDING_PET_FLOW = 'pet_flow'

/** 看过首屏（体验完或点了「先随便逛逛」）后不再弹出 */
export const WELCOME_DONE_KEY = 'onboarding_v2_welcome_done'
/** 首屏盖在首页上时为 1，custom-tab-bar 据此隐藏底栏 */
export const WELCOME_VISIBLE_KEY = 'onboarding_welcome_visible'
/** 新流程建档完成的日期（YYYY-MM-DD）：当天不弹签到、不放 5 步讲解 */
export const FIRST_DAY_KEY = 'onboarding_v2_first_day'
/** 建档完成后首页要弹一次「第一份简报」 */
export const BRIEF_PENDING_KEY = 'onboarding_v2_brief_pending'

export type Gender = 'male' | 'female'
export type OnboardingGoal = 'fat_loss' | 'maintain' | 'muscle_gain'
export type EatPlace = 'campus' | 'office' | 'home' | 'takeout'
export type MoveLevel = 'sedentary' | 'light' | 'moderate'

export interface BodyFacts {
  gender?: Gender
  age?: number
  heightCm?: number
  weightKg?: number
}

export const BODY_LIMITS = {
  age: [10, 100],
  heightCm: [100, 250],
  weightKg: [30, 200],
} as const

const inRange = (value: number, [min, max]: readonly [number, number]) => value >= min && value <= max

/**
 * 从一句话里读出性别、年龄、身高、体重，例如「女，22 岁，163，52 公斤」「男 25 178cm 70kg」。
 * 带单位的数字按单位认；没单位的按大小判断：100–250 当身高，30–200 里剩下的当体重，10–100 当年龄。
 * 读不出的字段留空，由页面让用户补一句。
 */
export function parseBodySentence(input: string): BodyFacts {
  const text = String(input || '').replace(/[，,、；;]/g, ' ').trim()
  const facts: BodyFacts = {}
  if (/女|female/i.test(text)) facts.gender = 'female'
  else if (/男|male/i.test(text)) facts.gender = 'male'

  const take = (pattern: RegExp, convert: (n: number) => number = (n) => n): number | undefined => {
    const m = text.match(pattern)
    return m ? convert(Number(m[1])) : undefined
  }
  const age = take(/(\d{1,3})\s*(?:岁|周岁)/)
  const heightCm = take(/(\d{3}(?:\.\d)?)\s*(?:cm|厘米|公分)/i) ?? take(/(\d(?:\.\d{1,2}))\s*(?:m|米)(?!\w)/i, (n) => Math.round(n * 100))
  const jin = take(/(\d{2,3}(?:\.\d)?)\s*斤/, (n) => n / 2)
  const weightKg = take(/(\d{2,3}(?:\.\d)?)\s*(?:kg|公斤|千克)/i) ?? jin
  if (age != null && inRange(age, BODY_LIMITS.age)) facts.age = age
  if (heightCm != null && inRange(heightCm, BODY_LIMITS.heightCm)) facts.heightCm = heightCm
  if (weightKg != null && inRange(weightKg, BODY_LIMITS.weightKg)) facts.weightKg = round1(weightKg)

  const bare = (text
    .replace(/\d+(?:\.\d+)?\s*(?:岁|周岁|cm|厘米|公分|kg|公斤|千克|斤|m|米)/gi, ' ')
    .match(/\d+(?:\.\d+)?/g) || []).map(Number)
  // 人们一般按「年龄 身高 体重」的顺序说：身高前面的数当年龄，后面的当体重
  const heightAt = facts.heightCm == null ? bare.findIndex((n) => n >= 120 && inRange(n, BODY_LIMITS.heightCm)) : -1
  if (heightAt >= 0) {
    facts.heightCm = bare[heightAt]
    const before = bare.slice(0, heightAt)
    const after = bare.slice(heightAt + 1)
    if (facts.age == null) {
      const age = [...before, ...after].find((n) => inRange(n, BODY_LIMITS.age) && (before.includes(n) || n <= 35))
      if (age != null) facts.age = age
    }
    if (facts.weightKg == null) {
      const weight = [...after, ...before].find((n) => n !== facts.age && inRange(n, BODY_LIMITS.weightKg))
      if (weight != null) facts.weightKg = round1(weight)
    }
    return facts
  }
  for (const n of bare) {
    if (facts.weightKg == null && inRange(n, BODY_LIMITS.weightKg) && n > 35) {
      facts.weightKg = round1(n)
    } else if (facts.age == null && inRange(n, BODY_LIMITS.age)) {
      facts.age = n
    }
  }
  return facts
}

export function missingBodyFields(facts: BodyFacts): string[] {
  const missing: string[] = []
  if (!facts.gender) missing.push('性别')
  if (facts.age == null) missing.push('年龄')
  if (facts.heightCm == null) missing.push('身高')
  if (facts.weightKg == null) missing.push('体重')
  return missing
}

/** 只知道年龄时用当年 7 月 1 日作生日，误差不超过半岁 */
export function birthdayFromAge(age: number, today: Date = new Date()): string {
  return `${today.getFullYear() - Math.round(age)}-07-01`
}

export const MOVE_TO_ACTIVITY: Record<MoveLevel, string> = {
  sedentary: 'sedentary',
  light: 'light',
  moderate: 'moderate',
}

/** 1.2 万+ / 3,500+ / 450+：向下取整，保证页面上的数只会比实际小 */
export function formatTrustCount(n: number): string {
  const value = Math.max(0, Math.floor(Number(n) || 0))
  if (value >= 10000) return `${Math.floor(value / 1000) / 10} 万+`
  if (value >= 1000) return `${(Math.floor(value / 100) * 100).toLocaleString('en-US')}+`
  if (value >= 100) return `${Math.floor(value / 10) * 10}+`
  return String(value)
}

export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 首屏只给新访客：没登录、没走过首屏、不是通过邀请或二维码进来的 */
export function shouldOfferWelcome(input: {
  loggedIn: boolean
  welcomeDone: boolean
  hasPendingInvite: boolean
}): boolean {
  return !input.loggedIn && !input.welcomeDone && !input.hasPendingInvite
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
