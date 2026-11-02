import { Input, Text, View } from '@tarojs/components'
import {
  ACTIVITY_LEVELS, ALCOHOL_ANSWERS, ALCOHOL_LABELS, CONDITION_OPTIONS, FISH_LEVELS, FRUIT_LEVELS, SALT_LEVELS, SLEEP_LEVELS, SMOKING_ANSWERS,
  SMOKING_LABELS, VEGETABLE_LEVELS, WEIGHT_TREND_LEVELS, type Level,
} from '../../model/habits'
import { RELATIONS, SELF_LABEL, type PersonDraft } from '../../model/people'

interface ChipsProps<T> {
  options: ReadonlyArray<readonly [label: string, value: T]>
  value: T
  onSelect: (value: T) => void
}

export function Chips<T extends string | number | null>({ options, value, onSelect }: ChipsProps<T>) {
  return (
    <View className='lp-chips'>
      {options.map(([label, option]) => (
        <View
          key={String(option)}
          className={`lp-chip${option === value ? ' is-on' : ''}`}
          role='button'
          aria-pressed={option === value}
          onClick={() => onSelect(option)}
        >
          {label}
        </View>
      ))}
    </View>
  )
}

/** Several may apply; "都没有" and "不清楚" are the two answers that clear the others. */
function ConditionChips({ value, onChange }: { value: string[] | null; onChange: (next: string[] | null) => void }) {
  const toggle = (condition: string) => {
    const chosen = value ?? []
    onChange(chosen.includes(condition) ? chosen.filter(item => item !== condition) : [...chosen, condition])
  }
  return (
    <View className='lp-chips'>
      <View className={`lp-chip${value === null ? ' is-on' : ''}`} role='button' onClick={() => onChange(null)}>不清楚</View>
      <View className={`lp-chip${value?.length === 0 ? ' is-on' : ''}`} role='button' onClick={() => onChange([])}>都没有</View>
      {CONDITION_OPTIONS.map(([label, condition]) => (
        <View
          key={condition}
          className={`lp-chip${value?.includes(condition) ? ' is-on' : ''}`}
          role='button'
          aria-pressed={value?.includes(condition) ?? false}
          onClick={() => toggle(condition)}
        >
          {label}
        </View>
      ))}
    </View>
  )
}

interface PersonFormProps {
  draft: PersonDraft
  error: string
  onChange: (next: Partial<PersonDraft>) => void
}

/** Pick the level closest to a stored value, so old values still show a selected chip. */
const nearest = (levels: Level[], value: number): number =>
  levels.reduce((best, level) => (Math.abs(level[1] - value) < Math.abs(best - value) ? level[1] : best), levels[0][1])

export function PersonForm({ draft, error, onChange }: PersonFormProps) {
  const number = (label: string, field: 'age' | 'height' | 'weight', placeholder: string) => (
    <View className='lp-field'>
      <Text className='lp-field__label'>{label}</Text>
      <Input
        className='lp-input'
        type='digit'
        value={draft[field]}
        placeholder={placeholder}
        onInput={(e) => onChange({ [field]: e.detail.value })}
      />
    </View>
  )
  const levels = (label: string, field: 'pa_met_h' | 'sleep_h' | 'fruit_g' | 'fish_g' | 'energy_balance_kcal', options: Level[]) => (
    <View className='lp-form__group'>
      <Text className='lp-form__label'>{label}</Text>
      <Chips options={options} value={nearest(options, draft[field])} onSelect={(value) => onChange({ [field]: value })} />
    </View>
  )
  return (
    <View className='lp-form'>
      {draft.label !== SELF_LABEL && (
        <View className='lp-form__group'>
          <Text className='lp-form__label'>是谁</Text>
          <Chips options={RELATIONS.map(name => [name, name] as const)} value={draft.label} onSelect={(label) => onChange({ label })} />
        </View>
      )}
      <View className='lp-form__group'>
        <Text className='lp-form__label'>性别</Text>
        <Chips options={[['男', 'male'], ['女', 'female']] as const} value={draft.sex} onSelect={(sex) => onChange({ sex })} />
      </View>
      <View className='lp-fields'>
        {number('年龄', 'age', '18–100')}
        {number('身高 cm', 'height', '120–220')}
        {number('体重 kg', 'weight', '30–250')}
      </View>
      <View className='lp-form__group'>
        <Text className='lp-form__label'>吸烟</Text>
        <Chips options={SMOKING_ANSWERS.map(level => [SMOKING_LABELS[level], level] as const)} value={draft.smoking} onSelect={(smoking) => onChange({ smoking })} />
      </View>
      <View className='lp-form__group'>
        <Text className='lp-form__label'>饮酒</Text>
        <Chips options={ALCOHOL_ANSWERS.map(level => [ALCOHOL_LABELS[level], level] as const)} value={draft.alcohol} onSelect={(alcohol) => onChange({ alcohol })} />
      </View>
      {levels('平时活动（工作、通勤、运动都算）', 'pa_met_h', ACTIVITY_LEVELS)}
      {levels('睡眠', 'sleep_h', SLEEP_LEVELS)}
      {levels('水果', 'fruit_g', FRUIT_LEVELS)}
      <View className='lp-form__group'>
        <Text className='lp-form__label'>蔬菜（可选）</Text>
        <Chips options={VEGETABLE_LEVELS} value={draft.vegetables_g ?? null} onSelect={(vegetables_g) => onChange({ vegetables_g })} />
      </View>
      {levels('鱼和海产品', 'fish_g', FISH_LEVELS)}
      <View className='lp-form__group'>
        <Text className='lp-form__label'>口味咸淡（可选）</Text>
        <Chips options={SALT_LEVELS} value={draft.sodium_mg ?? null} onSelect={(sodium_mg) => onChange({ sodium_mg })} />
      </View>
      {levels('最近体重', 'energy_balance_kcal', WEIGHT_TREND_LEVELS)}
      <View className='lp-form__group'>
        <Text className='lp-form__label'>确诊过的病（可选，可多选）</Text>
        <ConditionChips value={draft.conditions} onChange={(conditions) => onChange({ conditions })} />
      </View>
      <View className='lp-form__group'>
        <Text className='lp-form__label'>收缩压 mmHg（可选，就是血压的高压）</Text>
        <Input className='lp-input' type='digit' value={draft.sbp} placeholder='不知道可以留空' onInput={(e) => onChange({ sbp: e.detail.value })} />
      </View>
      {error && <Text className='lp-error'>{error}</Text>}
    </View>
  )
}
