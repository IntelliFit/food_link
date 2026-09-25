import { Canvas, Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { getStoredHomeExperienceConfig } from '../utils/home-experience'
import landscape from '../assets/ink-wellness/landscape.jpg'
import header from '../assets/ink-wellness/header.jpg'
import scoreArt from '../assets/ink-wellness/score.jpg'
import taiji from '../assets/ink-wellness/taiji.jpg'
import bookshelf from '../assets/ink-wellness/bookshelf.jpg'
import './InkWellness.scss'

export function useInkWellness() {
  const [active, setActive] = useState(() => getStoredHomeExperienceConfig().mode === 'wellness')
  useDidShow(() => setActive(getStoredHomeExperienceConfig().mode === 'wellness'))
  return active
}

export function InkMasthead({ title, subtitle, compact = false }: { title?: string; subtitle?: string; compact?: boolean }) {
  return <View className={`ink-masthead${compact ? ' ink-masthead--compact' : ''}`}>
    <Image className='ink-masthead__art' src={header} mode='aspectFill' aria-hidden />
    <View className='ink-brand'><Text className='ink-brand__name'>食探</Text><Text className='ink-brand__mode'>养生</Text><Image src={taiji} className='ink-brand__taiji' mode='aspectFit' aria-hidden /></View>
    {title && <Text className='ink-masthead__title'>{title}</Text>}
    {subtitle && <Text className='ink-masthead__subtitle'>{subtitle}</Text>}
  </View>
}

export function InkHomeHero({ current, target, date, onModeToggle, onTarget, reminder, onReminder }: {
  current?: number; target?: number; date?: string; onModeToggle: () => void; onTarget?: () => void; reminder?: string; onReminder?: () => void
}) {
  const known = Number.isFinite(current) && Number.isFinite(target)
  const remaining = known ? Number(target) - Number(current) : 0
  return <View className='ink-home-hero'>
    <Image className='ink-home-hero__art' src={landscape} mode='scaleToFill' aria-hidden />
    <View className='ink-brand'><Text className='ink-brand__name'>食探</Text><View id='home-mode-toggle' className='ink-mode-switch' role='button' aria-label='养生模式，点击切换均衡' onClick={onModeToggle}><Text>养生</Text><Image src={taiji} mode='aspectFit' /></View></View>
    <Text className='ink-home-hero__title'>一餐一饮，{ '\n' }皆有平衡</Text>
    <Text className='ink-home-hero__date'>{date?.replace(/-/g, ' · ')}</Text>
    <Text className='ink-home-hero__verse'>饮食有节，动静相宜</Text>
    <View className='ink-home-hero__intake'><Text className='ink-home-hero__number'>{known ? Math.round(Number(current)).toLocaleString() : '—'}</Text><Text>已摄入 · 千卡</Text></View>
    <View className='ink-home-hero__remaining' role='button' aria-label='查看和修改饮食目标' onClick={onTarget}><Text className='ink-home-hero__number'>{known ? Math.round(Math.abs(remaining)).toLocaleString() : '—'}</Text><Text>{remaining < 0 ? '超出目标' : '余量'} · 千卡</Text><Text className='ink-home-hero__target'>调整目标 ›</Text></View>
    {reminder && <View className='ink-home-hero__reminder' onClick={onReminder}><Text>{reminder}</Text><Text> ›</Text></View>}
  </View>
}

export function InkShelfEntry({ onOpen }: { onOpen: () => void }) {
  return <View className='ink-shelf-entry' role='button' aria-label='打开食探书架，查看周报月报年报' onClick={onOpen}>
    <Image className='ink-shelf-entry__art' src={bookshelf} mode='scaleToFill' aria-hidden />
    <View className='ink-shelf-entry__copy'><Text className='ink-shelf-entry__title'>食探书架</Text><Text>在一餐一食里，{ '\n' }看见更好的自己。</Text><Text className='ink-shelf-entry__link'>阶段回顾 →</Text></View>
    <Text className='ink-shelf-entry__book'>生活手记</Text>
  </View>
}

/** Native canvas keeps the chart crisp without a heavy chart bundle or image of fake data. */
function InkTrend({ days }: { days: { date: string; calories: number }[] }) {
  const signature = JSON.stringify(days)
  useEffect(() => {
    let cancelled = false
    const entries = JSON.parse(signature) as { date: string; calories: number }[]
    const ceiling = Math.max(1, ...entries.map(day => day.calories))
    const task = setTimeout(() => {
      Taro.createSelectorQuery().select('#ink-trend-canvas').fields({ node: true, size: true }).exec(result => {
        if (cancelled || !result?.[0]?.node) return
        const { node: canvas, width, height } = result[0]
        const ratio = Taro.getSystemInfoSync().pixelRatio || 1
        canvas.width = width * ratio
        canvas.height = height * ratio
        const ctx = canvas.getContext('2d')
        ctx.scale(ratio, ratio)
        const left = 8; const top = 18; const bottom = height - 10
        const x = (i: number) => entries.length < 2 ? width / 2 : left + i / (entries.length - 1) * (width - left * 2)
        const y = (value: number) => bottom - value / ceiling * (bottom - top)
        ctx.strokeStyle = '#d1d1cc'; ctx.lineWidth = 1
        for (const fraction of [0, .5, 1]) { ctx.beginPath(); ctx.moveTo(left, top + fraction * (bottom - top)); ctx.lineTo(width - left, top + fraction * (bottom - top)); ctx.stroke() }
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath()
        let connected = false
        entries.forEach((day, i) => { if (day.calories <= 0) { connected = false; return }; if (connected) ctx.lineTo(x(i), y(day.calories)); else ctx.moveTo(x(i), y(day.calories)); connected = true })
        ctx.stroke()
        entries.forEach((day, i) => { if (day.calories <= 0) return; ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x(i), y(day.calories), 3, 0, Math.PI * 2); ctx.fill() })
      })
    }, 120)
    return () => { cancelled = true; clearTimeout(task) }
  }, [signature])
  return <View className='ink-trend'>
    <View className='ink-section-heading'><Text>饮食节律</Text><Text className='ink-caption'>每日摄入 · 千卡</Text></View>
    {days.length ? <><Canvas type='2d' id='ink-trend-canvas' className='ink-trend__canvas' /><View className='ink-trend__labels'>{days.map(day => <View key={day.date}><Text>{day.date.slice(5)}</Text><Text>{day.calories > 0 ? Math.round(day.calories) : '—'}</Text></View>)}</View></> : <Text className='ink-caption'>记录一餐，留下今天的生活痕迹</Text>}
  </View>
}

export function InkStatsOverview({ score, label, preview, factors, days, advice, meals, onPlan, onStructure, onFactor }: {
  score?: number; label: string; preview: boolean
  factors: { key: string; title: string; score: number }[]
  days: { date: string; calories: number }[]
  advice: string
  meals: { label: string; value: number }[]
  onPlan: () => void; onStructure: () => void; onFactor: (key: string) => void
}) {
  const total = meals.reduce((sum, meal) => sum + meal.value, 0)
  return <View className='ink-stats-overview'>
    <View className='ink-score-scene'>
      <Image className='ink-score-scene__art' src={scoreArt} mode='scaleToFill' aria-hidden />
      <View className='ink-score-scene__score'><Text>健康指数</Text><Text className='ink-score-scene__number'>{score == null ? '—' : Math.round(score)}</Text><Text>{label}</Text>{preview && <Text className='ink-example'>示例数据</Text>}</View>
      <View className='ink-score-scene__factors'>{factors.slice(0, 3).map(factor => <View key={factor.key} className='ink-factor' role='button' onClick={() => onFactor(factor.key)}><Text>{factor.title}</Text><View className='ink-factor__row'><Text>{Math.round(factor.score)}</Text><View className='ink-factor__track'><View className='ink-factor__fill' style={{ width: `${Math.min(100, Math.max(0, factor.score))}%` }} /></View></View></View>)}</View>
    </View>
    <InkTrend days={days} />
    <View className='ink-plan' role='button' onClick={onPlan}><Text className='ink-plan__label'>AI方案{preview ? ' · 示例' : ''}</Text><Text className='ink-plan__title'>先从一件小事开始</Text><Text className='ink-plan__advice'>{advice || '根据你的记录，寻找适合自己的日常节奏。'}</Text><Text className='ink-plan__link'>查看方案 →</Text></View>
    <View className='ink-meal-distribution' role='button' onClick={onStructure}><View className='ink-section-heading'><Text>热量分布</Text><Text className='ink-caption'>查看详情 ›</Text></View><View className='ink-meal-distribution__row'>{meals.map(meal => <View className='ink-meal-distribution__item' key={meal.label}><Text>{meal.label}</Text><Text className='ink-meal-distribution__value'>{total > 0 ? `${Math.round(meal.value / total * 100)}%` : '—'}</Text><View className='ink-meal-distribution__track'><View style={{ width: `${total > 0 ? meal.value / total * 100 : 0}%` }} /></View></View>)}</View></View>
  </View>
}
