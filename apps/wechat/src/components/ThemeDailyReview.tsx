import { Canvas, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import * as React from 'react'
import type { BalancedThemeId } from '../utils/balanced-theme'
import { BALANCED_SCENES, loadBalancedScenes } from '../utils/balanced-theme-scenes'
import { waterFlowDays, WaterDailyFlow } from './WaterDailyFlow'
import easternLandscape from '../assets/balanced-themes/eastern-landscape.webp'
import { ThemeSceneImage } from './ThemeSceneImage'
import { useAppColorSchemeOptional } from './AppColorSchemeContext'
import './theme-reviews.scss'

type Props = {
  theme: BalancedThemeId
  endDate: string
  days?: { date: string; calories: number }[]
  water?: { date: string; total: number }[]
  guest?: boolean
  onRecord: () => void
}
type Day = ReturnType<typeof waterFlowDays>[number]
type ChartKind = 'columns' | 'rings' | 'river' | 'donut' | 'water'
// Canvas drawing and compact date buttons use the same CSS pixel domain.
const REVIEW_CHART_INSET = { left: 36, right: 12 }

/** A missing day has no plotted value; it must never become a zero or a connecting line. */
export function reviewSummary(days: Day[]) {
  const known = days.filter(day => day.calories !== null)
  return { count: known.length, average: known.length ? Math.round(known.reduce((sum, day) => sum + Number(day.calories), 0) / known.length) : null }
}

function ReviewChart({ days, kind, selected, dark = false, showDateLabels = true, theme }: { days: Day[]; kind: ChartKind; selected: string; dark?: boolean; showDateLabels?: boolean; theme?: BalancedThemeId }) {
  const signature = JSON.stringify(days)
  React.useEffect(() => {
    let cancelled = false
    const draw = () => Taro.createSelectorQuery().select('#theme-review-chart').fields({ node: true, size: true }).exec(result => {
      if (cancelled || !result?.[0]?.node) return
      const { node: canvas, width, height } = result[0]
      if (!width || !height) return
      const ratio = Taro.getSystemInfoSync().pixelRatio || 1
      canvas.width = width * ratio; canvas.height = height * ratio
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
      ctx.scale(ratio, ratio)
      const entries: Day[] = JSON.parse(signature)
      const max = Math.max(1, ...entries.map(day => day.calories || 0))
      const ink = theme === 'eastern-salon' ? '#e4cba0' : dark ? '#c4e0e8' : '#244d3b'
      const quiet = dark ? '#52656c' : '#c3c6b9'
      const colors = dark ? ['#ed8975', '#8aacfa', '#ecd077', '#dae6db', '#9ac0ad', '#d9b7a2', '#c2cfdf'] : ['#be3929', '#234caf', '#cc9b36', '#292e2b', '#658779', '#b69580', '#8a96a3']
      const centerX = width / 2, centerY = height / 2
      if (kind === 'rings' || kind === 'donut') {
        const radius = Math.min(width, height) * .43
        const total = entries.reduce((sum, day) => sum + (day.calories || 0), 0)
        let angle = -Math.PI / 2
        entries.forEach((day, i) => {
          const r = kind === 'rings' ? radius - i * radius / 11 : radius * .78
          const start = kind === 'rings' ? -Math.PI / 2 : angle
          const length = kind === 'rings' ? (day.calories || 0) / max * Math.PI * 2 : total ? (day.calories || 0) / total * Math.PI * 2 : 0
          ctx.lineWidth = kind === 'rings' ? radius / 15 : radius * .38
          if (kind === 'rings' || total === 0) {
            ctx.strokeStyle = quiet; ctx.globalAlpha = kind === 'rings' ? .16 : .35; ctx.beginPath(); ctx.arc(centerX, centerY, r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1
          }
          if (length > 0) {
            ctx.strokeStyle = kind === 'rings' ? (day.date === selected ? '#b08247' : ink) : colors[i]
            const gap = Math.min(.015, length / 4)
            ctx.beginPath(); ctx.arc(centerX, centerY, r, start + gap, start + length - gap); ctx.stroke()
          }
          if (kind === 'donut') angle += length
        })
      } else {
        const left = REVIEW_CHART_INSET.left, right = width - REVIEW_CHART_INSET.right, top = 22, bottom = height - (showDateLabels ? 28 : 12)
        const ceiling = Math.max(500, Math.ceil(max / 500) * 500)
        const step = (right - left) / 7
        const x = (i: number) => left + step * (i + .5)
        const y = (value: number) => bottom - value / ceiling * (bottom - top)
        ctx.font = `${showDateLabels ? 10 : 11}px sans-serif`
        ctx.fillStyle = showDateLabels ? quiet : dark ? '#c0d0c4' : '#657367'
        ctx.lineWidth = .5
        for (let i = 0; i <= 2; i++) {
          const py = y(ceiling * i / 2)
          ctx.strokeStyle = quiet; ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke(); ctx.globalAlpha = 1
          ctx.fillText(String(ceiling * i / 2), 1, py + 3)
        }
        if (kind === 'columns') entries.forEach((day, i) => {
          if (day.calories === null) return
          ctx.fillStyle = day.date === selected ? '#b99c48' : ink
          ctx.fillRect(x(i) - step * .29, y(day.calories), step * .58, bottom - y(day.calories))
        })
        else {
          ctx.strokeStyle = ink; ctx.lineWidth = kind === 'river' ? 5 : 2
          ctx.beginPath()
          let previous: { x: number; y: number } | undefined
          entries.forEach((day, i) => {
            if (day.calories === null) { previous = undefined; return }
            const point = { x: x(i), y: y(day.calories) }
            if (previous) ctx.bezierCurveTo((previous.x + point.x) / 2, previous.y, (previous.x + point.x) / 2, point.y, point.x, point.y)
            else ctx.moveTo(point.x, point.y)
            previous = point
          }); ctx.stroke()
          entries.forEach((day, i) => {
            if (day.calories === null) return
            ctx.fillStyle = day.date === selected ? '#b99157' : ink
            ctx.beginPath(); ctx.arc(x(i), y(day.calories), day.date === selected ? 5 : 3, 0, Math.PI * 2); ctx.fill()
          })
        }
        if (showDateLabels) {
          ctx.fillStyle = dark ? '#c5d6d9' : '#3c4942'
          entries.forEach((day, i) => { ctx.fillText(day.date.slice(8), x(i) - 6, height - 7) })
        }
      }
    })
    const timer = setTimeout(draw, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [signature, kind, selected, dark, showDateLabels, theme])
  const explanation = kind === 'rings' ? '年轮由外到内对应七日，弧长按七日最高摄入比较。' : kind === 'donut' ? '各色扇区对应日期，表示已记录摄入在七日总量中的占比。' : ''
  return <Canvas type='2d' id='theme-review-chart' className={`tr-chart tr-chart--${kind}`} aria-label={`最近七日已记录的饮食摄入，单位千卡；没有记录的日期留空。${explanation}具体数值可在日期按钮中查看。`} />
}

/** Each theme owns its composition, while calendar normalization and business actions stay shared. */
export function ThemeDailyReview({ theme, endDate, days, water, guest, onRecord }: Props) {
  const appearance = useAppColorSchemeOptional()
  const entries = waterFlowDays(endDate, guest ? [] : days, guest ? [] : water)
  const [selectedDate, setSelectedDate] = React.useState('')
  const [artReady, setArtReady] = React.useState(false)
  React.useEffect(() => {
    let active = true
    if (theme === 'miniature-world' || theme === 'picturebook-companion') {
      loadBalancedScenes().then(() => { if (active) setArtReady(true) }).catch(() => {})
    }
    return () => { active = false }
  }, [theme])
  const selected = entries.find(day => day.date === selectedDate) || entries[6]
  const summary = reviewSummary(entries)
  const number = (n: number | null) => n === null ? '—' : String(n)
  const range = `${entries[0].date.slice(5).replace('-', '.')} — ${entries[6].date.slice(5).replace('-', '.')}`
  const summaryBlock = summary.count > 0 ? <View className='tr-compact-summary' aria-label={`日均摄入按 ${summary.count} 天已记录饮食计算`}>
    <View><Text className='tr-compact-label'>已记录日均摄入</Text><View className='tr-compact-average'><Text>{number(summary.average)}</Text><Text>千卡</Text></View></View>
    <Text className='tr-compact-count'>{summary.count} 天饮食记录</Text>
  </View> : <View className='tr-compact-empty'><Text>暂无饮食记录</Text><Text>选一天查看饮水，记录饮食后会显示趋势。</Text></View>
  const dates = (film = false, alignChart = false) => <View className={`tr-dates tr-dates--compact${film ? ' tr-film' : ''}`} style={alignChart && summary.count > 0 ? { paddingLeft: `${REVIEW_CHART_INSET.left}px`, paddingRight: `${REVIEW_CHART_INSET.right}px` } : undefined}>{entries.map((day, i) => <View role='button' key={day.date} id={`theme-review-day-${i}`} aria-pressed={selected.date === day.date} aria-label={`${day.date}，${day.calories === null ? '暂无饮食记录' : `${day.calories} 千卡`}，${day.waterMl === null ? '暂无饮水记录' : `饮水 ${day.waterMl} ml`}，查看`}
    className={`tr-day${selected.date === day.date ? ' is-selected' : ''}`} onClick={() => setSelectedDate(day.date)}
  >
    {film && <View className='tr-film__frame'>{artReady && <Image src={BALANCED_SCENES.picturebookDay} mode='aspectFill' aria-hidden />}</View>}
    <Text>{day.date.slice(8)}</Text>
    <View className={`tr-date-dot${day.calories !== null || day.waterMl !== null ? ' is-recorded' : ''}`} aria-hidden />
  </View>)}</View>
  const detail = <View className='tr-compact-detail' aria-live='polite'>
    <View className='tr-compact-detail-header'><Text>{selected.date.slice(5).replace('-', ' / ')}</Text><Text>当天记录</Text></View>
    <View className='tr-compact-metrics'>
      <View><Text>饮食摄入</Text><Text>{selected.calories === null ? '暂无记录' : `${selected.calories} 千卡`}</Text></View>
      <View><Text>饮水</Text><Text>{selected.waterMl === null ? '暂无记录' : `${selected.waterMl} ml`}</Text></View>
    </View>
  </View>
  const chart = (kind: ChartKind, dark = false) => <ReviewChart days={entries} kind={kind} selected={selected.date} dark={dark} />
  const compactChart = (kind: ChartKind, dark = appearance?.scheme === 'dark') => summary.count > 0 && <ReviewChart days={entries} kind={kind} selected={selected.date} dark={dark} showDateLabels={false} theme={theme} />
  if (theme === 'way-of-water') return <View className='theme-review theme-review--way-of-water'><WaterDailyFlow endDate={endDate} days={days} water={water} guest={guest} onRecord={onRecord} />{chart('water', true)}<Text className='tr-caption'>饮食摄入 · 千卡 · 未记录的日期留空</Text></View>
  return <View id='theme-daily-review' className={`theme-review theme-review--${theme} theme-review--compact`}>
    <View className='tr-compact-header'><Text className='tr-compact-title'>近7天回顾</Text><Text className='tr-compact-range'>{range}</Text></View>
    {theme === 'clarity-order' && <>{summaryBlock}{compactChart('columns')}{dates(false, true)}</>}
    {theme === 'natural-symbiosis' && <><View className='tr-botanical'>{summaryBlock}{summary.count > 0 && <><View className='tr-rings'><ThemeSceneImage className='tr-rings__wood' src={BALANCED_SCENES.naturalRings} mode='aspectFit' />{compactChart('rings')}<View className='tr-rings__center'><Text>7日</Text><Text>摄入年轮</Text></View></View><Text className='tr-chart-note'>从外圈到内圈，按日期排列</Text></>}</View>{dates()}</>}
    {theme === 'eastern-salon' && <><View className='tr-landscape'><Image src={easternLandscape} mode='aspectFill' aria-hidden />{summaryBlock}{compactChart('river', true)}</View>{dates(false, true)}</>}
    {theme === 'modern-gallery' && <>{summary.count > 0 ? <View className='tr-exhibition'><View>{compactChart('donut')}<Text className='tr-chart-note'>七日摄入占比</Text></View><View>{summaryBlock}</View></View> : summaryBlock}{dates()}</>}
    {theme === 'miniature-world' && <><View className='tr-diorama'>{artReady && <Image className='tr-scene' src={BALANCED_SCENES.miniatureGarden} mode='aspectFill' aria-hidden />}<View className='tr-diorama__sign'>{summaryBlock}</View></View>{summary.count > 0 && <View className='tr-diorama__river'>{compactChart('river', true)}{dates(false, true)}</View>}{summary.count === 0 && dates()}</>}
    {theme === 'picturebook-companion' && <>{summaryBlock}{dates(true)}</>}
    {theme === 'clear-care' && <><View className='tr-care-panel'>{summaryBlock}{compactChart('columns')}{dates(false, true)}</View></>}
    {theme === 'picturebook-companion' ? <View className='tr-story'>{detail}</View> : detail}
    <View className='tr-record' role='button' onClick={onRecord}><Text>{guest ? '登录，开始记录' : '去记录今天'}</Text><Text className='iconfont icon-right' /></View>
  </View>
}
