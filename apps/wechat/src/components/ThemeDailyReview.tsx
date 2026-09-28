import { Canvas, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import * as React from 'react'
import type { BalancedThemeId } from '../utils/balanced-theme'
import { BALANCED_SCENES, loadBalancedScenes } from '../utils/balanced-theme-scenes'
import { waterFlowDays, WaterDailyFlow } from './WaterDailyFlow'
import easternLandscape from '../assets/balanced-themes/eastern-landscape.webp'
import { ThemeSceneImage } from './ThemeSceneImage'
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

/** A missing day has no plotted value; it must never become a zero or a connecting line. */
export function reviewSummary(days: Day[]) {
  const known = days.filter(day => day.calories !== null)
  return { count: known.length, average: known.length ? Math.round(known.reduce((sum, day) => sum + Number(day.calories), 0) / known.length) : null }
}

function ReviewChart({ days, kind, selected, dark = false }: { days: Day[]; kind: ChartKind; selected: string; dark?: boolean }) {
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
      const ink = dark ? '#c4e0e8' : '#244d3b'
      const quiet = dark ? '#52656c' : '#c3c6b9'
      const colors = ['#be3929', '#234caf', '#cc9b36', '#292e2b', '#658779', '#b69580', '#8a96a3']
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
        const left = 36, right = width - 12, top = 22, bottom = height - 28
        const ceiling = Math.max(500, Math.ceil(max / 500) * 500)
        const step = (right - left) / 7
        const x = (i: number) => left + step * (i + .5)
        const y = (value: number) => bottom - value / ceiling * (bottom - top)
        ctx.font = '10px sans-serif'; ctx.fillStyle = quiet; ctx.lineWidth = .5
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
        ctx.fillStyle = dark ? '#c5d6d9' : '#3c4942'
        entries.forEach((day, i) => { ctx.fillText(day.date.slice(8), x(i) - 6, height - 7) })
      }
    })
    const timer = setTimeout(draw, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [signature, kind, selected, dark])
  return <Canvas type='2d' id='theme-review-chart' className={`tr-chart tr-chart--${kind}`} aria-label='最近七日已记录的饮食摄入，单位千卡；没有记录的日期留空。具体数值可在日期按钮中查看。' />
}

/** Each theme owns its composition, while calendar normalization and business actions stay shared. */
export function ThemeDailyReview({ theme, endDate, days, water, guest, onRecord }: Props) {
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
  const average = <View className='tr-average'><Text>已记录日平均摄入</Text><View><Text>{number(summary.average)}</Text><Text>千卡</Text></View><Text>{summary.count ? `根据 ${summary.count} 天饮食记录计算` : '记录一餐，开始了解自己的节奏'}</Text></View>
  const dates = (film = false) => <View className={film ? 'tr-film' : 'tr-dates'}>{entries.map((day, i) => <View role='button' key={day.date} id={`theme-review-day-${i}`} aria-pressed={selected.date === day.date} aria-label={`${day.date}，${day.calories === null ? '暂无饮食记录' : `${day.calories} 千卡`}，查看`}
    className={`tr-day${selected.date === day.date ? ' is-selected' : ''}`} onClick={() => setSelectedDate(day.date)}
  >
    {film && <View className='tr-film__frame'>{artReady && <Image src={BALANCED_SCENES.picturebookDay} mode='aspectFill' aria-hidden />}<Text>{day.calories === null ? '留白' : '已记'}</Text></View>}
    <Text>{day.date.slice(5).replace('-', '.')}</Text>{!film && <Text>{number(day.calories)}</Text>}
  </View>)}</View>
  const detail = <View className='tr-detail' aria-live='polite'><View><Text>{selected.date.slice(5).replace('-', ' / ')}</Text><Text>这一天的记录</Text></View><View><Text>饮食摄入</Text><Text>{selected.calories === null ? '暂无记录' : `${selected.calories} 千卡`}</Text></View><View><Text>饮水</Text><Text>{selected.waterMl === null ? '暂无记录' : `${selected.waterMl} ml`}</Text></View></View>
  const chart = (kind: ChartKind, dark = false) => <ReviewChart days={entries} kind={kind} selected={selected.date} dark={dark} />
  const caption = <Text className='tr-caption'>近七日 · {range} · 轻触日期查看详情</Text>
  if (theme === 'way-of-water') return <View className='theme-review theme-review--way-of-water'><WaterDailyFlow endDate={endDate} days={days} water={water} guest={guest} onRecord={onRecord} />{chart('water', true)}<Text className='tr-caption'>饮食摄入 · 千卡 · 未记录的日期留空</Text></View>
  return <View id='theme-daily-review' className={`theme-review theme-review--${theme}`}>
    {theme === 'clarity-order' && <><View className='tr-editorial-title'><Text>07 / DAILY</Text><Text>记录，让变化可见。</Text></View>{average}{chart('columns')}{caption}{dates()}{detail}</>}
    {theme === 'natural-symbiosis' && <>{caption}<View className='tr-botanical'><View className='tr-rings'><ThemeSceneImage className='tr-rings__wood' src={BALANCED_SCENES.naturalRings} mode='aspectFit' />{chart('rings')}<View className='tr-rings__center'><Text>{summary.count}</Text><Text>天已记录</Text></View></View><Text className='tr-botanical__note'>一日一圈{ '\n' }慢慢生长</Text></View><Text className='tr-caption'>由外到内对应七日，最长弧线为七日最高摄入；未记录处留白。</Text>{dates()}{detail}{average}</>}
    {theme === 'eastern-salon' && <><View className='tr-landscape'><Image src={easternLandscape} mode='aspectFill' aria-hidden /><View className='tr-landscape__title'><Text>以食为线 · 见山河</Text><Text>每日摄入 / 千卡</Text></View>{chart('river')}</View>{caption}{dates()}{detail}<Text className='tr-verse'>一餐一饮，自有节序。</Text></>}
    {theme === 'modern-gallery' && <><View className='tr-exhibition'><View>{chart('donut')}<Text className='tr-caption'>七日摄入分布 · 按日期</Text></View>{average}</View>{caption}{dates()}{detail}<Text className='tr-gallery-note'>日常，也是作品。</Text></>}
    {theme === 'miniature-world' && <><View className='tr-diorama'>{artReady && <Image className='tr-scene' src={BALANCED_SCENES.miniatureGarden} mode='aspectFill' aria-hidden />}<View className='tr-diorama__sign'>{average}</View><View className='tr-diorama__river'>{chart('river', true)}<Text>七日饮食河流 · 千卡</Text></View></View>{caption}{dates()}{detail}</>}
    {theme === 'picturebook-companion' && <>{caption}{dates(true)}<View className='tr-story'><Text className='tr-story__title'>日子，一帧一帧留下来。</Text>{detail}{average}<Text className='tr-caption'>背景为主题插画，记录来自你的真实数据。</Text></View></>}
    {theme === 'clear-care' && <><View className='tr-care-panel'>{average}{chart('columns')}</View>{caption}{dates()}{detail}<Text className='tr-care-tip'>选一天，看记录。没有记下的日子，以“—”表示。</Text></>}
    <View className='tr-record' role='button' onClick={onRecord}><Text>{guest ? '登录，开始记录' : '去记录今天'}</Text><Text className='iconfont icon-right' /></View>
  </View>
}
