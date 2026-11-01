// The people a user calculates for. Everything entered here stays on this phone:
// it is kept in local storage and never sent to the backend.
import Taro from '@tarojs/taro'
import { ALCOHOL, SMOKING, type Alcohol, type Person, type Sex, type Smoking } from '../engine/engine'
import { ACTIVITY_LEVELS } from './habits'

export const RELATIONS = ['爸爸', '妈妈', '伴侣', '朋友'] as const
export const SELF_LABEL = '我'

const STORAGE_KEY = 'lifespan_people_v1'
const LIMITS = { age: [18, 100], height: [120, 220], weight: [30, 250] } as const

export interface Predictee extends Person {
  id: string
  label: string
}

/** Form state: the three typed numbers stay strings until the form is submitted. */
export interface PersonDraft extends Omit<Person, 'sex' | 'age' | 'height_cm' | 'weight_kg'> {
  label: string
  sex: Sex | null
  age: string
  height: string
  weight: string
}

export function emptyDraft(label: string): PersonDraft {
  return {
    label,
    sex: null,
    age: '',
    height: '',
    weight: '',
    smoking: 'never',
    alcohol: 'less_than_daily',
    pa_met_h: 14,
    sleep_h: 7.5,
    fruit_g: 60,
    fish_g: 15,
    energy_balance_kcal: 0,
  }
}

export function ageFromBirthday(birthday: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const hadBirthday = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day)
  return now.getFullYear() - year - (hadBirthday ? 0 : 1)
}

const ACTIVITY_BY_PROFILE: Record<string, number> = {
  sedentary: ACTIVITY_LEVELS[0][1],
  light: ACTIVITY_LEVELS[1][1],
  moderate: ACTIVITY_LEVELS[2][1],
  active: ACTIVITY_LEVELS[3][1],
  very_active: ACTIVITY_LEVELS[3][1],
}

export interface HealthProfileFields {
  gender?: string | null
  birthday?: string | null
  height?: number | null
  weight?: number | null
  activity_level?: string | null
  health_condition?: { daily_life_activity_level?: string } | null
}

/** Fill the basics from the health profile; anything missing stays blank for the user. */
export function draftWithHealthProfile(draft: PersonDraft, profile: HealthProfileFields, now: Date): PersonDraft {
  const age = profile.birthday ? ageFromBirthday(profile.birthday, now) : null
  const activity = profile.health_condition?.daily_life_activity_level || profile.activity_level || ''
  return {
    ...draft,
    sex: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : draft.sex,
    age: age !== null && age > 0 ? String(age) : draft.age,
    height: profile.height ? String(profile.height) : draft.height,
    weight: profile.weight ? String(profile.weight) : draft.weight,
    pa_met_h: ACTIVITY_BY_PROFILE[activity] ?? draft.pa_met_h,
  }
}

const inRange = (value: number, [lo, hi]: readonly [number, number]): boolean => Number.isFinite(value) && value >= lo && value <= hi

export function validateDraft(draft: PersonDraft): string | null {
  if (!draft.sex) return '请选择性别'
  const age = Number(draft.age)
  if (draft.age.trim() && Number.isFinite(age) && age < LIMITS.age[0]) return '寿命预测器只面向 18 岁及以上'
  if (!draft.age.trim() || !inRange(age, LIMITS.age)) return '请填写 18–100 岁之间的年龄'
  if (!draft.height.trim() || !inRange(Number(draft.height), LIMITS.height)) return '请填写 120–220 cm 之间的身高'
  if (!draft.weight.trim() || !inRange(Number(draft.weight), LIMITS.weight)) return '请填写 30–250 kg 之间的体重'
  return null
}

export function draftToPredictee(draft: PersonDraft, id: string): Predictee {
  const { sex, age, height, weight, ...habits } = draft
  return {
    ...habits,
    id,
    sex: sex as Sex,
    age: Math.round(Number(age)),
    height_cm: Number(height),
    weight_kg: Number(weight),
  }
}

export function predicteeToDraft(person: Predictee): PersonDraft {
  const { id: _id, sex, age, height_cm, weight_kg, ...habits } = person
  return { ...habits, sex, age: String(age), height: String(height_cm), weight: String(weight_kg) }
}

function isPredictee(value: unknown): value is Predictee {
  const person = value as Predictee
  return !!person
    && typeof person.id === 'string'
    && typeof person.label === 'string'
    && (person.sex === 'male' || person.sex === 'female')
    && inRange(person.age, LIMITS.age)
    && inRange(person.height_cm, LIMITS.height)
    && inRange(person.weight_kg, LIMITS.weight)
    && SMOKING.includes(person.smoking as Smoking)
    && ALCOHOL.includes(person.alcohol as Alcohol)
    && [person.pa_met_h, person.fruit_g, person.fish_g, person.sleep_h, person.energy_balance_kcal].every(Number.isFinite)
}

export function loadPeople(): Predictee[] {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEY)
    return Array.isArray(stored) ? stored.filter(isPredictee) : []
  } catch {
    return []
  }
}

export function savePeople(people: Predictee[]): void {
  try {
    Taro.setStorageSync(STORAGE_KEY, people)
  } catch {
    void Taro.showToast({ title: '没能保存在手机上，下次需要重新填写', icon: 'none' })
  }
}

export function clearPeople(): void {
  try {
    Taro.removeStorageSync(STORAGE_KEY)
  } catch {
    void Taro.showToast({ title: '没能清除，请重试', icon: 'none' })
  }
}
