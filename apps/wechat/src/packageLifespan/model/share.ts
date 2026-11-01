// What a share card says. Weight and age are left out unless the user turns them on.
import type { Curves, Person } from '../engine/engine'
import { atAge, axisEndAge, deathAge, DISCLAIMER, years, type PredictorModel } from './predictor'

/** Body shape stays neutral unless the user chooses to show weight. */
const NEUTRAL_BMI = 22

export interface ShareOptions {
  showWeight: boolean
  showAge: boolean
}

export type PosterTone = 'a' | 'b' | 'c'

export interface PosterColumn {
  tone: PosterTone
  bmi: number
  value: string
  name: string
  caption: string | null
  note: string | null
}

export interface PosterContent {
  title: string
  subtitle: string
  highlight: { before: string; value: string; after: string; tone: PosterTone } | null
  columns: PosterColumn[]
  footer: string[]
}

const whoOf = (label: string): string => label || '我'

export function threeYouPoster(label: string, model: PredictorModel, lifeIndex: number, options: ShareOptions): PosterContent {
  const { person, branches } = model
  const noteAge = Math.min(axisEndAge(person), Math.max(55, person.age + 20))
  const tones: PosterTone[] = ['a', 'b', 'c']
  return {
    title: `同一个${whoOf(label)}，三种吃法`,
    subtitle: `${options.showAge ? `从 ${person.age} 岁开始分岔 · ` : ''}掷同一颗骰子，这一次——`,
    highlight: null,
    columns: branches.map((branch, index) => {
      const at = atAge(person, branch, noteAge)
      return {
        tone: tones[index],
        bmi: options.showWeight ? at.bmi : NEUTRAL_BMI,
        value: String(Math.floor(deathAge(person, branch, lifeIndex))),
        name: branch.name,
        caption: '这次模拟',
        note: options.showWeight ? `${noteAge} 岁 ${at.weight.toFixed(0)} kg` : null,
      }
    }),
    footer: ['一次随机模拟的人生，不是你的命运。', DISCLAIMER],
  }
}

export interface PlayShare {
  person: Person
  label: string
  summary: string
  today: Curves
  tuned: Curves
  delta: number
}

export function playPoster(share: PlayShare, options: ShareOptions): PosterContent {
  const { person, label, summary, today, tuned, delta } = share
  const gained = delta >= 0
  const noteAge = Math.min(axisEndAge(person), person.age + 20)
  const tone: PosterTone = gained ? 'b' : 'c'
  const note = (curves: Curves): string | null => {
    if (!options.showWeight) return null
    return `${options.showAge ? `${noteAge} 岁 ` : ''}${atAge(person, curves, noteAge).weight.toFixed(0)} kg`
  }
  return {
    title: `${whoOf(label)}试了：${summary}`,
    subtitle: '',
    highlight: { before: `在这个模型里，平均${gained ? '多活' : '少活'}`, value: Math.abs(delta).toFixed(1), after: '年', tone },
    columns: [
      { tone: 'a', bmi: options.showWeight ? atAge(person, today, noteAge).bmi : NEUTRAL_BMI, value: years(today.le.mean), name: '照现在', caption: '平均寿命', note: note(today) },
      { tone, bmi: options.showWeight ? atAge(person, tuned, noteAge).bmi : NEUTRAL_BMI, value: years(tuned.le.mean), name: '调完以后', caption: '平均寿命', note: note(tuned) },
    ],
    footer: [`${options.showAge ? `从 ${person.age} 岁起 · ` : ''}平均寿命，假设长期坚持。`, DISCLAIMER],
  }
}
