import { Image, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { claimWeeklyCheckInReward, getLoginCheckInWeek } from '../utils/api'
import type { RecapDay } from '../utils/health-recap'

const STAIR_TOPS = [75, 67.7, 61.1, 55.8, 51.4, 47.5, 44.1]
// Fixed, varied gusts keep replays calm and predictable without repeating a zigzag.
const LEAF_FLIGHTS = [1500, 1750, 1600, 1850, 1550, 1700, 1800]
const LEAF_LANDINGS = [47, 52, 49, 54, 48, 51, 50]
const LEAF_RESTS = [650, 850, 700, 950, 700, 800, 900]

export function RecapStairs({ days, active, next, sample = false }: { days: RecapDay[]; active: boolean; next: () => void; sample?: boolean }) {
  const [records, setRecords] = useState<Array<{ date: string; checked: boolean }> | null>(null)
  const [error, setError] = useState<'unavailable' | 'network' | null>(null)
  const [retry, setRetry] = useState(0)
  const [step, setStep] = useState(-1)
  const [moving, setMoving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(exitTimer.current), [])
  useEffect(() => { if (!active) { clearTimeout(exitTimer.current); setLeaving(false) } }, [active])
  const enterGarden = () => {
    if (leaving || !active) return
    setLeaving(true)
    exitTimer.current = setTimeout(next, 2200)
  }
  const [scenario, setScenario] = useState<'full' | 'gap'>('full')
  const [reward, setReward] = useState<'idle' | 'pending' | 'claimed' | 'already' | 'error' | 'unavailable'>('idle')
  const rewardLock = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const start = days[0]?.date
  const periodKey = days.slice(0, 7).map(day => day.date).join(',')
  useEffect(() => {
    clearTimeout(timer.current)
    setMoving(false)
    setStep(-1)
    setReward('idle')
  }, [periodKey, sample, scenario])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!active || !start) return
    let cancelled = false
    setError(null)
    setRecords(null)
    if (sample) {
      setRecords(periodKey.split(',').map((date, index) => ({ date, checked: scenario === 'full' || index !== 2 })))
      return
    }
    getLoginCheckInWeek(start).then(rows => {
      if (rows.length !== 7 || rows.some((row, i) => row.date !== periodKey.split(',')[i])) throw new Error('period mismatch')
      if (!cancelled) setRecords(rows)
    }).catch((failure: unknown) => {
      const status = (failure as { statusCode?: number })?.statusCode
      if (!cancelled) setError(status === 404 || status === 501 ? 'unavailable' : 'network')
    })
    return () => { cancelled = true }
  }, [active, start, retry, periodKey, sample, scenario])
  // One cancellable sequence: arrive, settle, then continue. Missing days stay dim.
  useEffect(() => {
    if (!active || !records) return
    let cancelled = false
    let index = 0
    setStep(-1)
    setMoving(false)
    const advance = () => {
      if (cancelled) return
      setStep(index)
      setMoving(true)
      timer.current = setTimeout(() => {
        if (cancelled) return
        setMoving(false)
        const pause = records[index].checked ? LEAF_RESTS[index] : 2100
        index += 1
        if (index < records.length) timer.current = setTimeout(advance, pause)
      }, LEAF_FLIGHTS[index])
    }
    timer.current = setTimeout(advance, 1000)
    return () => { cancelled = true; clearTimeout(timer.current) }
  }, [active, records])
  const finished = step === 6 && !moving
  const missed = records?.some(day => !day.checked)
  const claim = async () => {
    if (sample || !records || !finished || missed || !start || rewardLock.current || reward === 'claimed' || reward === 'already' || reward === 'unavailable') return
    rewardLock.current = true
    setReward('pending')
    try {
      const result = await claimWeeklyCheckInReward(start)
      setReward(result.applied ? 'claimed' : 'already')
    } catch (failure) {
      const status = (failure as { statusCode?: number })?.statusCode
      setReward(status === 404 || status === 501 ? 'unavailable' : 'error')
    }
    finally { rewardLock.current = false }
  }
  return <View className={`recap-stairs${sample ? ' is-sample' : ''}${finished ? ' has-arrived' : ''}${leaving ? ' is-entering-garden' : ''}`}>
    <View className='recap-stairs__sketch' aria-hidden>
      {days.slice(0, 7).map((day, index) => {
        const y = STAIR_TOPS[index]
        const width = 45 - index * 3
        const mask = `radial-gradient(ellipse ${width}% 6% at 48% ${y}%, #000 20%, #000b 48%, transparent 100%), radial-gradient(ellipse 20% 4% at 72% ${y - 1}%, #000a, transparent 100%)`
        return <Image key={day.date} className={`recap-stairs__sketch-band${(index < step || (index === step && !moving)) && records?.[index]?.checked ? ' is-painted' : ''}`} src='/packageRecap/assets/recap-v5/weekly-stair-garden.jpg' mode='scaleToFill' style={{ maskImage: mask, WebkitMaskImage: mask }} />
      })}
    </View>
    <View className='recap-gate' aria-hidden>
      <View className='recap-gate__beyond' />
      <Image className='recap-gate__leaf is-left' src='/packageRecap/assets/recap-v5/weekly-stair-garden.jpg' mode='scaleToFill' />
      <Image className='recap-gate__leaf is-right' src='/packageRecap/assets/recap-v5/weekly-stair-garden.jpg' mode='scaleToFill' />
    </View>
    {finished && <View className='garden-bookmark' aria-label='花园里的压花书签'><View className='garden-bookmark__thread' /><View className='garden-guide-leaf garden-guide-leaf--pressed'><View className='garden-guide-leaf__vein' /></View></View>}
    <View className='recap-gate__passage' />
    {sample && <View className='recap-stairs__sample'><Text>体验样本 · </Text><View role='button' className={scenario === 'full' ? 'is-selected' : ''} onClick={() => setScenario('full')}>七天全勤</View><Text> / </Text><View role='button' className={scenario === 'gap' ? 'is-selected' : ''} onClick={() => setScenario('gap')}>漏签一天</View></View>}
    {records && !finished && <View className={`recap-stairs__guide${moving ? ' is-floating' : ' is-resting'}${step % 2 === 0 ? ' drifts-left' : ' drifts-right'}`} aria-label='引路的叶子沿水彩石阶轻轻飘落' style={{ top: `${step < 0 ? 81 : STAIR_TOPS[step] - 1.4}%`, left: `${step < 0 ? 46 : LEAF_LANDINGS[step]}%`, transform: `translateX(-50%) scale(${1 - Math.max(0, step) * .06})`, transitionDuration: `${LEAF_FLIGHTS[Math.max(0, step)]}ms` }}><View key={step} className='garden-guide-leaf' style={{ animationDuration: `${LEAF_FLIGHTS[Math.max(0, step)]}ms` }}><View className='garden-guide-leaf__vein' /></View><View key={`shadow-${step}`} className='recap-stairs__leaf-shadow' style={{ animationDuration: `${LEAF_FLIGHTS[Math.max(0, step)]}ms` }} /></View>}
    {days.slice(0, 7).map((day, index) => <View key={day.date} aria-label={(index < step || (index === step && !moving)) && records?.[index]?.checked ? '已走过的亮起石阶' : '尚未点亮的石阶'} className={`recap-stairs__step${(index < step || (index === step && !moving)) && records?.[index]?.checked ? ' is-visited' : ''}${(index < step || (index === step && !moving)) && records?.[index]?.checked === false ? ' is-skipped' : ''}`} style={{ left: `${17 + index * 3}%`, top: `${STAIR_TOPS[index]}%`, width: `${66 - index * 6}%` }}><View className='recap-stairs__wash'><View /><View /><View /></View></View>)}
    <View className='recap-stairs__note'>
      {error === 'unavailable' ? <><Text>这周的签到回顾暂未开放</Text><Text>先继续读故事，签到结果稍后再来看</Text></> : error ? <View role='button' onClick={() => setRetry(value => value + 1)}>签到记录暂未取回，轻点重试</View> : !records ? <View className='recap-stairs__spinner' /> : finished ? <><Text>{missed ? '很遗憾，这周有几天没能相遇' : '七天的坚持，让你又向上了一程'}</Text><Text>{missed ? '希望下周继续相伴，再接再厉，每一步都算数。' : sample ? '签到 7 / 7 天 · 愿下周的你，依然从容向前。' : '七天全勤，为这份坚持领取 7 枚代币。'}</Text></> : null}
    </View>
    {finished && sample && !missed && <View className='recap-stairs__reward'><Text>全勤奖励 +7 · 样本演示</Text></View>}
    {finished && !sample && records && !missed && <View className='recap-stairs__reward' role='button' onClick={claim} aria-disabled={reward === 'pending' || reward === 'claimed' || reward === 'already' || reward === 'unavailable'}>
      {reward === 'pending' ? <View className='recap-stairs__spinner' /> : <Text>{reward === 'claimed' ? '代币 +7 · 已到账' : reward === 'already' ? '本周 7 枚代币已领取' : reward === 'unavailable' ? '全勤奖励暂未开放，稍后再来领取' : reward === 'error' ? '奖励暂未领取，轻点重试' : '领取全勤奖励 · 代币 +7'}</Text>}
    </View>}
    {finished && <View role='button' className='journal-v5__scene-action' onClick={enterGarden}>收起书签，走进花园 →</View>}
    {error && <View role='button' className='journal-v5__scene-action' onClick={next}>先收好这一页 →</View>}
  </View>
}
