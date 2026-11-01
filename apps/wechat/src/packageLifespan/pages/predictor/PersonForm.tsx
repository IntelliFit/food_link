import { Input, Text, View } from '@tarojs/components'
import { ALCOHOL, SMOKING } from '../../engine/engine'
import {
  ACTIVITY_LEVELS, ALCOHOL_LABELS, FISH_LEVELS, FRUIT_LEVELS, SLEEP_LEVELS, SMOKING_LABELS, WEIGHT_TREND_LEVELS, type Level,
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
        <Chips options={SMOKING.map(level => [SMOKING_LABELS[level], level] as const)} value={draft.smoking} onSelect={(smoking) => onChange({ smoking })} />
      </View>
      <View className='lp-form__group'>
        <Text className='lp-form__label'>饮酒</Text>
        <Chips options={ALCOHOL.map(level => [ALCOHOL_LABELS[level], level] as const)} value={draft.alcohol} onSelect={(alcohol) => onChange({ alcohol })} />
      </View>
      {levels('平时活动（工作、通勤、运动都算）', 'pa_met_h', ACTIVITY_LEVELS)}
      {levels('睡眠', 'sleep_h', SLEEP_LEVELS)}
      {levels('水果', 'fruit_g', FRUIT_LEVELS)}
      {levels('鱼和海产品', 'fish_g', FISH_LEVELS)}
      {levels('最近体重', 'energy_balance_kcal', WEIGHT_TREND_LEVELS)}
      {error && <Text className='lp-error'>{error}</Text>}
    </View>
  )
}
