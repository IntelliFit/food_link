import { Button, Slider, Text, View } from '@tarojs/components'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { type Exposures } from '../../engine/engine'
import { LifeCanvas } from '../../charts/LifeCanvas'
import { drawParallelLives, drawPlayCurve, type Palette } from '../../charts/draw'
import { HABIT_CHOICES, HABIT_SLIDERS, type HabitSlider } from '../../model/habits'
import type { Predictee } from '../../model/people'
import {
  adherenceOptions, applyLifeCards, atAge, axisEndAge, DEFAULT_PLAN, DISCLAIMER, isSameExposures, lateStart, lifeCardValues,
  parallelLives, percent, planOf, planPhrase, playOutcome, signedYears, years, type PlanChoice, type PredictorModel,
} from '../../model/predictor'
import { playPoster, type PosterContent, type ShareOptions } from '../../model/share'
import { Chips } from './PersonForm'

interface PlayTabProps {
  model: PredictorModel
  person: Predictee
  palette: Palette
  header: ReactNode
  /** What was tuned before switching tabs, so coming back does not lose it. */
  kept?: KeptTuning
  onKeep: (kept: KeptTuning) => void
  onSetUpPlan: () => void
  onShare: (build: (options: ShareOptions) => PosterContent) => void
}

interface Tuning {
  play: Exposures
  choice: PlanChoice
}

export interface KeptTuning {
  tuning: Tuning
  applied: string[]
}

const toneOf = (value: number): string => (value >= 0.05 ? 'is-up' : value <= -0.05 ? 'is-down' : '')

export function PlayTab({ model, person, palette, header, kept, onKeep, onSetUpPlan, onShare }: PlayTabProps) {
  const options = useMemo(() => adherenceOptions(person.sex), [person.sex])
  // While a slider is dragged only the headline follows; cards, bars and dots wait for the release.
  const [live, setLive] = useState<Tuning>(kept?.tuning ?? { play: model.base, choice: DEFAULT_PLAN })
  const [settled, setSettled] = useState<Tuning>(live)
  const [applied, setApplied] = useState<string[]>(kept?.applied ?? [])

  useEffect(() => { onKeep({ tuning: settled, applied }) }, [settled, applied]) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = (next: Partial<Tuning>) => setLive(prev => ({ ...prev, ...next }))
  const commit = (next: Partial<Tuning>) => {
    const merged = { ...live, ...next }
    setLive(merged)
    setSettled(merged)
  }
  const setHabit = (patch: Partial<Exposures>, release: boolean) => {
    const play = { ...live.play, ...patch }
    if (applied.length) setApplied([])
    if (release) commit({ play })
    else drag({ play })
  }
  const toggleCard = (id: string) => {
    const next = applied.includes(id) ? applied.filter(item => item !== id) : [...applied, id]
    setApplied(next)
    commit({ play: applyLifeCards(model, next) })
  }
  const setStart = (age: number, release: boolean) => {
    const choice = { ...live.choice, start: age <= person.age ? null : age }
    if (release) commit({ choice })
    else drag({ choice })
  }

  const today = model.branches[0]
  const livePlan = planOf(live.choice, options)
  const outcome = useMemo(() => playOutcome(model, live.play, livePlan), [model, live.play, livePlan])
  const settledPlan = planOf(settled.choice, options)
  const settledOutcome = useMemo(() => playOutcome(model, settled.play, settledPlan), [model, settled.play, settledPlan])
  const cards = useMemo(() => lifeCardValues(model, settledPlan), [model, settledPlan])
  const late = useMemo(() => lateStart(model, settled.play, settled.choice, options), [model, settled.play, settled.choice, options])
  const lives = useMemo(() => parallelLives(person, today, settledOutcome.curves), [person, today, settledOutcome])

  const gained = outcome.delta >= -0.05
  const noteAge = Math.min(axisEndAge(person), person.age + 20)
  const startAge = live.choice.start ?? person.age
  const maxStart = Math.max(person.age + 1, Math.min(100, axisEndAge(person) - 5))
  const warningOf = (field: string) => outcome.warnings.find(warning => warning.field === field)

  const shareSummary = (): string => {
    const when = livePlan ? `（${planPhrase(live.choice, options).replace(' · ', '，')}）` : ''
    const names = cards.filter(card => applied.includes(card.id)).map(card => card.name)
    if (names.length) return names.join('、') + when
    const changed = HABIT_SLIDERS.filter(slider => Math.abs(live.play[slider.key] - model.base[slider.key]) > 1e-9)
      .map(slider => `${slider.label}调到 ${slider.format(live.play[slider.key])}`)
    const choices = HABIT_CHOICES.filter(choice => live.play[choice.key] !== model.base[choice.key])
      .map(choice => `${choice.label}改成${choice.names[live.play[choice.key] as never]}`)
    return ([...changed, ...choices].join('、') || '什么都没改') + when
  }

  const renderSlider = (slider: HabitSlider) => {
    const value = live.play[slider.key]
    const warning = warningOf(slider.key)
    return (
      <View key={slider.key} className='lp-control'>
        <View className='lp-control__top'>
          <Text className='lp-control__label'>{slider.label}</Text>
          <Text className={`lp-control__value${Math.abs(value - model.base[slider.key]) > 1e-9 ? ' is-changed' : ''}`}>{slider.format(value)}</Text>
        </View>
        <Slider
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={Math.min(slider.max, Math.max(slider.min, value))}
          activeColor='#00bc7d'
          blockSize={22}
          onChanging={(e) => setHabit({ [slider.key]: e.detail.value }, false)}
          onChange={(e) => setHabit({ [slider.key]: e.detail.value }, true)}
        />
        <View className='lp-control__hint'>
          <Text>{slider.hint(value)}</Text>
          <Text>现在：{slider.format(model.base[slider.key])}</Text>
        </View>
        {warning && <Text className='lp-warn'>外推：{warning.message}</Text>}
      </View>
    )
  }

  return (
    <View>
      <View className='lp-hero'>
        {header}
        <Text className='lp-hero__eyebrow'>调完以后，平均活到</Text>
        <View className='lp-big'>
          <Text className='lp-big__num'>{years(outcome.curves.le.mean)}</Text>
          <Text className='lp-hero__dim'>岁</Text>
          <Text className={`lp-big__delta ${toneOf(outcome.delta)}`}>{signedYears(outcome.delta)} 年</Text>
        </View>
        <Text className='lp-hero__dim'>{planPhrase(live.choice, options)}{livePlan ? '' : ' · 下面可以改成晚几年开始、只坚持一部分'}</Text>
        <LifeCanvas
          id='lpPlay'
          className='lp-canvas lp-canvas--play'
          deps={[model, outcome]}
          draw={(ctx, w, h) => drawPlayCurve(ctx, w, h, person, today, outcome.curves, gained)}
        />
        <View className='lp-pair'>
          <View className='lp-pair__item'>
            <Text className='lp-hero__dim'>活到 85 岁的概率</Text>
            <Text className='lp-pair__value'>{today.p85 === null || outcome.curves.p85 === null ? '—' : `${percent(today.p85)} → ${percent(outcome.curves.p85)}`}</Text>
          </View>
          <View className='lp-pair__item'>
            <Text className='lp-hero__dim'>{noteAge} 岁时体重</Text>
            <Text className='lp-pair__value'>{atAge(person, today, noteAge).weight.toFixed(0)} → {atAge(person, outcome.curves, noteAge).weight.toFixed(0)} kg</Text>
          </View>
        </View>
        <Text className='lp-hero__hint'>{DISCLAIMER} · 结果默认改完以后长期坚持，下面可以改</Text>
      </View>

      <View className='lp-card'>
        <View className='lp-row'>
          <Text className='lp-card__title lp-grow'>一键试试</Text>
          <Text className='lp-fine'>每张卡单独算，点一下加上</Text>
        </View>
        <View className='lp-cards'>
          {cards.map(card => (
            <View key={card.id} className={`lp-life${applied.includes(card.id) ? ' is-on' : ''}`} role='button' aria-pressed={applied.includes(card.id)} onClick={() => toggleCard(card.id)}>
              <Text className='lp-life__name'>{card.name}</Text>
              <Text className={`lp-life__gain ${toneOf(card.gain)}`}>{signedYears(card.gain)} 年</Text>
              <Text className='lp-fine'>{applied.includes(card.id) ? '已加上 · ' : ''}{card.detail}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='lp-card'>
        <View className='lp-row'>
          <Text className='lp-card__title lp-grow'>细调每一项</Text>
          <Button className='lp-btn lp-btn--small lp-btn--line' onClick={() => { setApplied([]); commit({ play: model.base, choice: DEFAULT_PLAN }) }}>回到现在</Button>
        </View>
        {HABIT_SLIDERS.map(renderSlider)}
        {HABIT_CHOICES.map(choice => (
          <View key={choice.key} className='lp-control'>
            <View className='lp-control__top'>
              <Text className='lp-control__label'>{choice.label}</Text>
              <Text className={`lp-control__value${live.play[choice.key] !== model.base[choice.key] ? ' is-changed' : ''}`}>{choice.names[live.play[choice.key] as never]}</Text>
            </View>
            <Chips
              options={choice.options.map(option => [choice.names[option as never], option] as const)}
              value={live.play[choice.key] as string}
              onSelect={(value) => setHabit({ [choice.key]: value } as Partial<Exposures>, true)}
            />
            <View className='lp-control__hint'><Text>现在：{choice.names[model.base[choice.key] as never]}</Text></View>
          </View>
        ))}
      </View>

      <View className='lp-card'>
        <Text className='lp-card__title'>什么时候开始、能坚持多少</Text>
        <View className='lp-control'>
          <View className='lp-control__top'>
            <Text className='lp-control__label'>从几岁开始改</Text>
            <Text className={`lp-control__value${live.choice.start !== null ? ' is-changed' : ''}`}>{live.choice.start === null ? '现在就开始' : `${live.choice.start} 岁`}</Text>
          </View>
          <Slider
            min={person.age}
            max={maxStart}
            step={1}
            value={startAge}
            activeColor='#00bc7d'
            blockSize={22}
            onChanging={(e) => setStart(e.detail.value, false)}
            onChange={(e) => setStart(e.detail.value, true)}
          />
          <View className='lp-control__hint'><Text>开始之前按现在的习惯过</Text><Text>现在 {person.age} 岁</Text></View>
        </View>
        <View className='lp-control'>
          <View className='lp-control__top'>
            <Text className='lp-control__label'>能坚持多少</Text>
            <Text className={`lp-control__value${live.choice.adherence !== 0 ? ' is-changed' : ''}`}>{options[live.choice.adherence].label}</Text>
          </View>
          <Chips
            options={options.map((option, index) => [option.label, index] as const)}
            value={live.choice.adherence}
            onSelect={(adherence) => commit({ choice: { ...live.choice, adherence } })}
          />
          <View className='lp-control__hint'><Text>“前两年好、之后松懈”：从九成慢慢降到五成</Text></View>
        </View>
        <View className='lp-late__head'><Text>{late.title}</Text><Text>比照现在平均多活</Text></View>
        {late.rows.map(row => (
          <View key={row.age} className={`lp-late${row.selected ? ' is-on' : ''}`} role='button' onClick={() => setStart(row.age, true)}>
            <Text className='lp-late__label'>{row.label}</Text>
            <View className='lp-late__bar'><View className={`lp-late__fill${row.gain < -0.05 ? ' is-down' : ''}`} style={{ width: `${row.width}%` }} /></View>
            <Text className='lp-late__gain'>{signedYears(row.gain)} 年</Text>
          </View>
        ))}
        <Text className='lp-reading'>{late.reading}</Text>
        <Text className='lp-fine'>开始之前按现在的习惯过；开始以后效果要一两年才慢慢显现。“坚持一半”按改变量的一半计算，这是模型假设，参数表里标为估计。</Text>
      </View>

      <View className='lp-card'>
        <Text className='lp-card__title'>100 个平行的你</Text>
        <Text className='lp-fine'>每个点是一条随机人生，上排照现在，下排调完以后。两排用的是同一组骰子。</Text>
        <LifeCanvas
          id='lpDots'
          className='lp-canvas lp-canvas--dots'
          deps={[lives, palette, settledOutcome.delta]}
          draw={(ctx, w, h) => drawParallelLives(ctx, w, h, person, lives, settledOutcome.delta >= -0.05, palette)}
        />
        <Text className='lp-reading'>100 个平行的你里，照现在有 {lives.over85Today} 个活过 85 岁，调完以后有 {lives.over85Tuned} 个。同一颗骰子下，每个人多活或少活的年数都不一样。</Text>
      </View>

      <View className='lp-row lp-actions'>
        <Button className='lp-btn lp-btn--line lp-grow' onClick={onSetUpPlan}>去设置饮食方案</Button>
        <Button
          className='lp-btn lp-grow'
          disabled={isSameExposures(live.play, model.base) && !livePlan}
          onClick={() => onShare(shareOptions => playPoster({
            person, label: person.label, summary: shareSummary(), today, tuned: outcome.curves, delta: outcome.delta,
          }, shareOptions))}
        >
          做成分享卡片
        </Button>
      </View>
      <Text className='lp-foot'>{person.label}的信息只在这台手机上计算 · {DISCLAIMER}</Text>
    </View>
  )
}
