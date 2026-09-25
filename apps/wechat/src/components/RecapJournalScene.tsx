import { Canvas, Image, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { RecapDay, RecapKind } from '../utils/health-recap'
import type { RecapJourney } from '../utils/recap-story'
import { journalAdvice, type JournalPhotos, type journalBody } from '../utils/recap-journal'
import './RecapJournal.scss'
import { RecapStairs } from './RecapStairs'

type Body = ReturnType<typeof journalBody>
type Props = {
  onBound?: () => void
  health?: { stars: number; label: string } | null
  chapter: number
  kind: RecapKind
  days: RecapDay[]
  recorded: number
  recipient?: string
  next: () => void
  journey: RecapJourney
  onJourney: (change: Partial<RecapJourney>) => void
  active: boolean
  body: Body
  photos: JournalPhotos | null
  photosBusy: boolean
  photosError: boolean
  retryPhotos: () => void
}

function QuietCurve({ points, active }: { points: Body['points']; active: boolean }) {
  useEffect(() => {
    if (!active || points.length < 2) return
    const timer = setTimeout(() => {
      Taro.createSelectorQuery().select('#journal-weight-curve').fields({ node: true, size: true }).exec(result => {
        const item = result?.[0]
        if (!item?.node || !item.width || !item.height) return
        const canvas = item.node as HTMLCanvasElement, w = item.width, h = item.height
        canvas.width = w * 2; canvas.height = h * 2
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.scale(2, 2); ctx.clearRect(0, 0, w, h)
        const coords = points.map(p => ({ x: 20 + p.x * (w - 40), y: 18 + p.y * (h - 36) }))
        ctx.beginPath(); ctx.moveTo(coords[0].x, coords[0].y)
        coords.slice(1).forEach((p, i) => { const prior = coords[i], mid = (prior.x + p.x) / 2; ctx.bezierCurveTo(mid, prior.y, mid, p.y, p.x, p.y) })
        ctx.strokeStyle = '#9a7455'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke()
        ctx.lineTo(coords[coords.length - 1].x, h); ctx.lineTo(coords[0].x, h); ctx.closePath()
        const wash = ctx.createLinearGradient(0, 0, 0, h); wash.addColorStop(0, '#f7d79480'); wash.addColorStop(1, '#f5f0e600'); ctx.fillStyle = wash; ctx.fill()
        coords.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#e77c66'; ctx.fill() })
      })
    }, 280)
    return () => clearTimeout(timer)
  }, [points, active])
  return <Canvas type='2d' id='journal-weight-curve' className='journal-v5__curve' aria-label='本期体重变化曲线，不展示体重数字' />
}

const FLASHBACK_MEAL_LABELS: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', meal: '饮食片段' }
const weeklyStonePositions = [[49, 81], [62, 71], [44, 62], [61, 52], [45, 43], [59, 34], [48, 25]]
const annualStonePositions = [[44, 82], [60, 76], [46, 69], [61, 63], [45, 56], [59, 50], [44, 44], [60, 38], [45, 32], [59, 27], [46, 22], [58, 17]]
const waterStageNames = ['idle', 'lifting', 'revealed'] as const

export function RecapJournalScene({ onBound, chapter, kind, days, recipient, next, journey, onJourney, active, body, health, photos, photosBusy, photosError, retryPhotos }: Props) {
  const [letterOpen, setLetterOpen] = useState(journey.opened)
  const [envelopeOpening, setEnvelopeOpening] = useState(false)
  const [letterLeaving, setLetterLeaving] = useState(false)
  const [waterStage, setWaterStage] = useState(0)
  const [selected, setSelected] = useState(0)
  const [flashbackIndex, setFlashbackIndex] = useState(0)
  const [flashbackComplete, setFlashbackComplete] = useState(false)
  const [weightAwake, setWeightAwake] = useState(false)
  const [pathRunning, setPathRunning] = useState(false)
  const [pathArrived, setPathArrived] = useState(false)
  const [ticketAccepted, setTicketAccepted] = useState(false)
  const [bound, setBound] = useState(false)
  const boundCallback = useRef(onBound); boundCallback.current = onBound
  useEffect(() => {
    if (!active || !ticketAccepted || bound) return
    const timer = setTimeout(() => { setBound(true); boundCallback.current?.() }, 6400)
    return () => clearTimeout(timer)
  }, [active, ticketAccepted, bound])
  const [writing, setWriting] = useState(false)
  const advancing = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const nextRef = useRef(next)
  nextRef.current = next

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => { if (active) advancing.current = false }, [active])
  useEffect(() => {
    if (!active || chapter !== 1 || photosBusy) return
    const count = Math.min(10, photos?.images.length || 0)
    setFlashbackIndex(0)
    setFlashbackComplete(count === 0)
    if (count === 0) return
    const sequenceTimers: ReturnType<typeof setTimeout>[] = []
    for (let index = 1; index < count; index += 1) {
      sequenceTimers.push(setTimeout(() => setFlashbackIndex(index), index * 1250))
    }
    sequenceTimers.push(setTimeout(() => setFlashbackComplete(true), count * 1250 + 500))
    timers.current.push(...sequenceTimers)
    return () => sequenceTimers.forEach(clearTimeout)
  }, [active, chapter, photos, photosBusy])

  const scheduleNext = (delay: number) => {
    if (!active || advancing.current) return
    advancing.current = true
    timers.current.push(setTimeout(() => nextRef.current(), delay))
  }
  const annual = kind === 'year', label = annual ? '年报' : kind === 'month' ? '月报' : '周报'
  const waterPeriod = kind === 'year' ? '这一年' : kind === 'month' ? '这个月' : '这一周'
  const groups = annual
    ? Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, rows: days.filter(d => Number(d.date.slice(5, 7)) === i + 1) }))
    : kind === 'month'
      ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => ({ label: `第${i + 1}周`, rows: days.slice(i * 7, i * 7 + 7) }))
      : days.map((day, i) => ({ label: String(i + 1), rows: [day] }))
  const current = groups[selected] || groups[0]
  const image = chapter === 0
    ? annual ? 'annual-cover' : 'weekly-cover'
    : chapter === 1 ? 'weekly-meals'
      : chapter === 2 ? 'water-background-clean'
        : chapter === 3 ? 'gentle-hills'
          : chapter === 4 ? annual ? 'annual-journey' : 'weekly-path'
            : 'finale-ticket'
  const title = chapter === 0
    ? annual ? '你的年度生活电影' : kind === 'month' ? '这一月，认真生活的你' : '这一周，认真生活的你'
    : ['', '每一餐，都是小日子', `${waterPeriod}，喝进多少清泉`, '把起伏，画成温柔山丘', '原来，你一直在前进', '颁给认真生活的你', '把故事，装订成册', '留住这一段生活'][chapter]
  const preview = (src: string) => { void Taro.previewImage({ current: src, urls: photos?.images.map(photo => photo.src) || [src] }) }
  const positions = annual ? annualStonePositions : weeklyStonePositions

  const openLetter = () => {
    if (letterOpen || envelopeOpening) return
    setEnvelopeOpening(true)
    timers.current.push(setTimeout(() => {
      setLetterOpen(true)
      onJourney({ opened: true })
    }, 860))
  }
  const keepLetter = () => {
    if (letterLeaving) return
    setLetterLeaving(true)
    scheduleNext(720)
  }
  const liftWaterGlass = () => {
    if (waterStage !== 0) return
    setWaterStage(1)
    timers.current.push(setTimeout(() => {
      setWaterStage(2)
    }, 1450))
  }
  const wakeCurve = () => {
    if (weightAwake) return
    setWeightAwake(true)
    scheduleNext(3000)
  }
  const ridePath = () => {
    if (pathRunning || advancing.current) return
    setPathRunning(true)
    setPathArrived(false)
    setSelected(0)
    advancing.current = true
    const stepDuration = annual ? 480 : 720
    groups.forEach((group, index) => timers.current.push(setTimeout(() => {
      setSelected(index)
      onJourney({ memory: group.label })
    }, index * stepDuration)))
    const arrivalTime = Math.max(1, groups.length - 1) * stepDuration + 850
    timers.current.push(setTimeout(() => setPathArrived(true), arrivalTime))
    timers.current.push(setTimeout(() => nextRef.current(), arrivalTime + 1650))
  }
  const acceptTicket = () => {
    if (ticketAccepted) return
    setTicketAccepted(true)

  }
  const flashbackPhotos = photos?.images.slice(0, 10) || []
  const flashbackPhoto = flashbackPhotos[flashbackIndex]
  const flashbackDate = flashbackPhoto?.date
    ? `${Number(flashbackPhoto.date.slice(5, 7))}月${Number(flashbackPhoto.date.slice(8))}日`
    : ''
  const waterAmount = body.cups === null ? null : body.cups

  return <View className={`recap-stage journal-v5 journal-v5--${chapter} journal-v5--${kind}${active ? ' is-current' : ''}${letterOpen ? ' has-open-letter' : ''}${ticketAccepted ? ' is-binding' : ''}${bound ? ' is-bound' : ''}`}>
    <Image className='journal-v5__art' src={chapter === 4 && kind === 'week' ? '/packageRecap/assets/recap-v5/weekly-stair-garden.jpg' : `/packageRecap/assets/recap-v5/${image}.jpg`} mode={chapter === 4 && kind === 'week' ? 'scaleToFill' : 'aspectFill'} />
    <View className='journal-v5__masthead'>
      <Text className='journal-v5__eyebrow'>{annual ? `${days[0]?.date.slice(0, 4)} · 四季生活旅程` : `${label} · 把生活讲成故事`}</Text>
      <Text className='journal-v5__title'>{title}</Text>
      {chapter === 0 && <Text className='journal-v5__subtitle'>{annual ? '四季流转，那些认真生活的片段' : '平凡的日子，也闪着光'}</Text>}
    </View>

    {chapter === 0 && <>
      <View className={`journal-v5__cover-action${envelopeOpening ? ' is-opening' : ''}${letterOpen ? ' is-open' : ''}`}>
        {!letterOpen && <View role='button' aria-label={`点击轻轻拆开我的${label}`} className='journal-v5__envelope-trigger' onClick={openLetter}>
          <Image className='journal-v5__cover-envelope journal-v5__cover-envelope--closed' src='/packageRecap/assets/recap-v5/cover-envelope.webp' mode='aspectFit' />
          <Image className='journal-v5__cover-envelope journal-v5__cover-envelope--open' src='/packageRecap/assets/recap-v5/cover-envelope-open.webp' mode='aspectFit' />
        </View>}
      </View>
      {letterOpen && <View className={`journal-v5__cover-letter${letterLeaving ? ' is-leaving' : ''}`}>
        <View className='journal-v5__letter-paper'>
          <Text className='journal-v5__salutation'>{recipient?.trim() ? `尊敬的${recipient.trim()}：` : '亲爱的朋友：'}</Text>
          <Text className='journal-v5__letter-copy'>愿你三餐有暖，心中有光。{annual ? '走过四季的你，已经把平凡写成了故事。' : '这一段日子里，每一个认真生活的瞬间，都没有被辜负。'}{kind === 'month' ? '新的一个月' : annual ? '新的一年' : '新的一周'}，慢慢来，也很好。</Text>
          <Text className='journal-v5__signature'>食探</Text><View className='journal-v5__seal'><Text>食探</Text></View>
        </View>
        <View role='button' aria-label='收下这封信，继续回忆' className='journal-v5__scene-action journal-v5__scene-action--letter' onClick={keepLetter}>收下这封信，继续回忆 <Text>→</Text></View>
      </View>}
    </>}

    {chapter === 1 && <View className={`journal-v5__flashback${flashbackComplete ? ' is-complete' : ' is-playing'}${photos?.source === 'community' ? ' is-community' : ''}`}>
      {photosBusy && <View className='journal-v5__flashback-loading'><View /><View /><View /></View>}
      {!photosBusy && flashbackPhoto && <>
        <View className='journal-v5__flashback-stack' role='button' aria-label={`查看${flashbackDate}的饮食照片`} onLongPress={() => preview(flashbackPhoto.src)}>
          <Image key={`${flashbackPhoto.src}:${flashbackIndex}`} className='journal-v5__flashback-photo' src={flashbackPhoto.src} mode='aspectFill' />
          <View key={`flash-${flashbackIndex}`} className='journal-v5__flashback-flare' />
          <View className='journal-v5__flashback-caption'>
            <Text>{photos?.source === 'community' ? `本周灵感 · ${flashbackPhoto.author || '圈子分享'}` : '你的圈子记忆'}</Text>
            <Text>{flashbackDate} · {FLASHBACK_MEAL_LABELS[flashbackPhoto.meal] || '饮食片段'}</Text>
          </View>
          <Text className='journal-v5__flashback-count'>{flashbackIndex + 1}/{flashbackPhotos.length}</Text>
        </View>
        <Text className='journal-v5__hint'>{flashbackComplete ? '长按照片，可以查看原图' : '光影正在一张张回来'}</Text>
      </>}
      {!photosBusy && !flashbackPhoto && !photosError && <View className='journal-v5__flashback-empty'><Text>这一周的光影</Text><Text>还在路上</Text></View>}
      {photosError && <View className='journal-v5__retry' role='button' onClick={retryPhotos}>照片还没取齐，轻点再试</View>}
      {!photosBusy && flashbackComplete && <View role='button' aria-label='收好这些光影' className='journal-v5__scene-action' onClick={next}>收好这些光影 <Text>→</Text></View>}
    </View>}

    {chapter === 2 && <View className={`journal-v5__water is-${waterStageNames[waterStage]}`}>
      <View className='journal-v5__water-copy'>
        {waterStage === 0 && <><Text>举起这一杯清泉</Text><Text>看看这段日子，积攒了多少水分</Text></>}
        {waterStage === 1 && <><Text>这一杯，敬认真生活的你</Text><Text>一周的水分记忆正在汇聚</Text></>}
      </View>

      <Image className='journal-v5__water-hand-glass' src='/packageRecap/assets/recap-v5/water-hand-glass.webp' mode='aspectFit' aria-label='手拿水杯' />

      {waterStage === 2 && <View className='journal-v5__water-amount-pop'>
        <Text>{waterPeriod}记录的饮水量</Text>
        {waterAmount === null
          ? <><Text>等待记录</Text><Text>从下一杯开始，留下属于你的水分印记</Text></>
          : <><Text>相当于 <Text className='journal-v5__water-number'>{waterAmount}</Text> 杯水</Text><Text>按每杯 250 mL 折算</Text></>}
        <View role='button' aria-label='看完饮水回顾并继续' className='journal-v5__water-confirm' onClick={next}>收下这份水分记忆 <Text>→</Text></View>
      </View>}

      {waterStage !== 2 && <View role='button' aria-label={waterStage === 0 ? '举起水杯查看本期饮水量' : '正在举起水杯'} className={`journal-v5__scene-action${waterStage === 1 ? ' is-progressing' : ''}`} onClick={liftWaterGlass}>
          {waterStage === 0 ? '举杯，看看这一周' : '正在回想这一周…'}
          {waterStage === 0 && <Text>→</Text>}
        </View>}
    </View>}

    {chapter === 3 && <View className={`journal-v5__weight${weightAwake ? ' is-awake' : ''}`}>
      <View className='journal-v5__curve-card'>{body.points.length >= 2 ? <QuietCurve points={body.points} active={active && weightAwake} /> : <Text className='journal-v5__empty'>{body.points.length ? '一枚痕迹，等下一次相遇' : '这一页，留给未来的痕迹'}</Text>}</View>
      <Text className='journal-v5__weight-copy'>无论起伏，都是你认真生活的痕迹。</Text>
      <View role='button' aria-label='唤醒温柔曲线' className='journal-v5__scene-action' onClick={wakeCurve}>{weightAwake ? '山丘已经苏醒' : '唤醒温柔曲线'} <Text>→</Text></View>
    </View>}

    {chapter === 4 && kind === 'week' && <RecapStairs days={days} active={active} next={next} sample={typeof __ENABLE_DEV_DEBUG_UI__ !== 'undefined' && __ENABLE_DEV_DEBUG_UI__} />}
    {chapter === 4 && kind !== 'week' && <View className={`journal-v5__path${pathRunning ? ' is-riding' : ''}${pathArrived ? ' has-arrived' : ''}`}>
      {groups.map((group, index) => { const [x, y] = positions[index] || positions[positions.length - 1]; return <View key={index} role='button' aria-label={`查看${group.label}足迹`} className={`journal-v5__stone${group.rows.some(day => day.has_record) ? ' has-record' : ''}${pathRunning && index < selected ? ' is-passed' : ''}${selected === index ? ' is-selected' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => { if (!pathRunning) { setSelected(index); onJourney({ memory: group.label }) } }}><Text>{group.label}</Text></View> })}
      <Image className='journal-v5__cyclist' src='/packageRecap/assets/recap/journal-cyclist.webp' mode='aspectFit' style={{ left: `${(positions[selected]?.[0] || 49) - 20}%`, top: `${(positions[selected]?.[1] || 81) - 9}%` }} />
      <View className='journal-v5__bike-trail'><Text>·</Text><Text>✦</Text><Text>·</Text></View>
      <View className='journal-v5__path-note'><Text>{pathArrived ? '抵达 · 这一段生活已被认真走过' : pathRunning ? `第 ${selected + 1} 站 · ${current?.label}` : current?.rows.some(day => day.has_record) ? '这段生活，被你轻轻点亮' : '这里留白，下一次再慢慢写'}</Text>{pathRunning && !pathArrived && <Text>{current?.rows.filter(day => day.has_record).length ? `${current.rows.filter(day => day.has_record).length} 天留下了生活足迹` : '这一站安静留白，也是一段生活'}</Text>}</View>
      <View role='button' aria-label='骑过这段旅程' className='journal-v5__scene-action' onClick={ridePath}>{pathArrived ? '已经抵达，准备翻页' : pathRunning ? `正在骑向第 ${Math.min(selected + 2, groups.length)} 站` : '骑过这段旅程'} <Text>→</Text></View>
    </View>}

    {chapter === 5 && !bound && <View className={`journal-v5__award${ticketAccepted ? ' is-accepted' : ''}`}>
      {health && <View className='journal-v5__stars' aria-label={`点亮${health.stars}颗小星星`}><Text>{'★'.repeat(health.stars)}{'☆'.repeat(5 - health.stars)}</Text><Text>本期状态 · {health.label}</Text></View>}
      <Text className='journal-v5__award-title'>生活探索家</Text>
      <Text className='journal-v5__advice'>{journalAdvice(days, body.waterDays, body.points.length > 0)}</Text>
      <Text className='journal-v5__closing'>保持对生活的好奇，下一页，继续出发。</Text>
      {writing ? <Textarea className='journal-v5__note-input' value={journey.letter} maxlength={100} placeholder='写给未来的自己…' onTouchStart={event => event.stopPropagation()} onInput={event => onJourney({ letter: event.detail.value })} /> : <View role='button' className='journal-v5__note-toggle' onClick={() => setWriting(true)}>＋ 写一句话给未来的我</View>}
      <View role='button' aria-label='收下纪念票，装订故事' className='journal-v5__scene-action journal-v5__scene-action--ticket' onClick={acceptTicket}>{ticketAccepted ? '纪念票已收好' : writing ? '写好了，装订故事' : '收下纪念票，装订故事'} <Text>→</Text></View>
    </View>}

    {chapter === 5 && ticketAccepted && <View className={`journal-album${bound ? ' is-bound' : ''}`} aria-label={bound ? '生活纪念册已装订完成' : '正在将回忆逐页装订'}>
      <View className='journal-album__pages' />
      {['weekly-cover.jpg', 'weekly-meals.jpg', 'water-background-clean.jpg', 'weekly-stair-garden.jpg'].map((asset, index) => <View key={asset} className={`journal-album__memory journal-album__memory--${index}`}>
        <Image src={index === 1 && photos?.images[0]?.src ? photos.images[0].src : `/packageRecap/assets/recap-v5/${asset}`} mode='aspectFill' />
        <Text>{['一封来信', '三餐光影', '慢慢滋养', '一路足迹'][index]}</Text>
      </View>)}
      {kind === 'week' && <View className='garden-bookmark garden-bookmark--album'><View className='garden-bookmark__thread' /><View className='garden-guide-leaf garden-guide-leaf--pressed'><View className='garden-guide-leaf__vein' /></View></View>}
      <View className='journal-album__cover'><View className='journal-album__spine' /><View className='journal-album__label'><Text>食探 · 生活手记</Text><Text>{recipient?.trim() || '亲爱的朋友'}</Text><Text>{days[0]?.date} — {days[days.length - 1]?.date}</Text><Text>把平凡的日子，轻轻珍藏</Text></View><View className='journal-album__ribbon' /><Text className='journal-album__seal'>食探</Text></View>
      {bound && <Text className='journal-album__caption'>这一段生活，已为你珍藏</Text>}
    </View>}
  </View>
}
