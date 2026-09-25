import { Text, View } from '@tarojs/components'
import { emptyJourney } from '../utils/recap-story'
import { useEffect, useMemo, useRef, useState } from 'react'
import { communityGetFeed, getAccessToken, getUserProfile, getBodyMetricsSummary, getStatsSummary, getStatsCalendarMonth, normalizeCommunityFeedItem, type BodyMetricsSummary } from '../utils/api'
import { localDay, recapPeriod, summarizeRecap, type RecapDay, type RecapKind } from '../utils/health-recap'
import { JIANWEN_COMPANION_SRC } from '../utils/pet-companion-preference'
import { redirectToLogin } from '../utils/withAuth'
import { PetCompanionSprite } from './PetCompanionSprite'
import { RecapShare } from './RecapShare'
import { RecapMusic } from './RecapMusic'
import { RecapJournalScene } from './RecapJournalScene'
import { journalBody, journalFeedPhotos, journalHealth, journalSwipeTarget, type JournalPhotos } from '../utils/recap-journal'
import './HealthRecap.scss'

type Report = { updatedAt: string; recipient?: string; ownerId?: string; health?: ReturnType<typeof journalHealth> } & ReturnType<typeof summarizeRecap> & { start: string; end: string; body?: BodyMetricsSummary; bodyUnavailable: boolean }

export function HealthRecap({ active, selection, onShelf, onComplete }: { active: boolean; selection?: { kind: RecapKind; anchor: string }; onShelf?: () => void; onComplete?: () => void }) {
  const currentYear = new Date().getFullYear()
  const [kind, setKind] = useState<RecapKind>(selection?.kind ?? 'week')
  const [year, setYear] = useState(currentYear - 1)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storyPage, setStoryPage] = useState(0)
  const [transition, setTransition] = useState<{ from: number; to: number; serial: number } | null>(null)
  const transitionSerial = useRef(0)
  const [completed, setCompleted] = useState(false)
  const [photos, setPhotos] = useState<JournalPhotos | null>(null)
  const [photosBusy, setPhotosBusy] = useState(false)
  const [photosError, setPhotosError] = useState(false)
  const [photoRetry, setPhotoRetry] = useState(0)
  const [drag, setDrag] = useState(0)
  const lastDrag = useRef(0)
  const completeCallback = useRef(onComplete); completeCallback.current = onComplete
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const turning = useRef(false)
  const [journey, setJourney] = useState(emptyJourney)
  const request = useRef(0)
  const inFlight = useRef(false)
  const initialLoad = useRef(false)
  const owner = useRef(getAccessToken())
  const reports = useRef(new Map<string, Report>())
  const reportKey = (value: RecapKind, selectedYear: number) => `${value}:${selectedYear}:${localDay(new Date())}`

  useEffect(() => {
    // Keep navigation locked until both scenes and their shared wipe settle.
    const timer = setTimeout(() => { turning.current = false; setTransition(null) }, 950)
    return () => clearTimeout(timer)
  }, [storyPage, active])

  useEffect(() => () => { request.current += 1 }, [])
  useEffect(() => {
    if (owner.current !== getAccessToken()) {
      owner.current = getAccessToken(); reports.current.clear(); setReport(null); setError(''); setJourney(emptyJourney()); setCompleted(false)
      request.current += 1; inFlight.current = false; setBusy(false)
    }
    if (!active) { request.current += 1; inFlight.current = false; setBusy(false) }
  }, [active])

  const selectReport = (value: RecapKind, selectedYear: number) => {
    request.current += 1; inFlight.current = false; setError(''); setBusy(false); setStoryPage(0)
    if (owner.current !== getAccessToken()) { owner.current = getAccessToken(); reports.current.clear() }
    setReport(reports.current.get(reportKey(value, selectedYear)) ?? null)
    setKind(value); setYear(selectedYear); setJourney(emptyJourney()); setCompleted(false)
  }

  const load = async () => {
    if (inFlight.current) return
    if (!getAccessToken()) { redirectToLogin(); return }
    const token = getAccessToken()
    if (owner.current !== token) { owner.current = token; reports.current.clear(); setReport(null); setJourney(emptyJourney()); setCompleted(false) }
    inFlight.current = true
    const id = ++request.current
    setBusy(true); setError(''); setStoryPage(0)
    const period = recapPeriod(kind, year, selection ? new Date(`${selection.anchor}T12:00:00`) : new Date())
    try {
      const rows: RecapDay[] = []
      for (let i = 0; i < period.months.length; i += 3) {
        const pages = await Promise.all(period.months.slice(i, i + 3).map(getStatsCalendarMonth))
        if (request.current !== id || token !== getAccessToken()) return
        pages.forEach(page => rows.push(...page.days))
      }
      const returnedDates = new Set(rows.map(row => row.date))
      if (period.dates.some(date => !returnedDates.has(date))) throw new Error('Incomplete calendar')
      const [bodyResult, profileResult, healthResult] = await Promise.allSettled([
        Promise.all([...new Set([Number(period.start.slice(0, 4)), Number(period.end.slice(0, 4))])].map(value => getBodyMetricsSummary('year', value))).then(parts => ({ ...parts[0], start_date: parts[0].start_date, end_date: parts[parts.length - 1].end_date, water_daily: parts.flatMap(part => part.water_daily), weight_entries: parts.flatMap(part => part.weight_entries) })),
        getUserProfile(),
        kind === 'year' ? Promise.resolve(null) : getStatsSummary(kind),
      ])
      if (request.current === id && token === getAccessToken()) {
        const next: Report = {
          updatedAt: `${localDay(new Date())} ${new Date().toTimeString().slice(0, 5)}`,
          health: healthResult.status === 'fulfilled' ? journalHealth(healthResult.value, period.start, period.end) : null,
          recipient: profileResult.status === 'fulfilled' ? profileResult.value.nickname?.trim() : undefined,
          ownerId: profileResult.status === 'fulfilled' ? profileResult.value.id : undefined,
          ...summarizeRecap(rows, period.dates), start: period.start, end: period.end,
          body: bodyResult.status === 'fulfilled' ? bodyResult.value : undefined,
          bodyUnavailable: bodyResult.status === 'rejected',
        }
        const key = reportKey(kind, year)
        reports.current.delete(key); reports.current.set(key, next)
        if (reports.current.size > 3) reports.current.delete(reports.current.keys().next().value as string)
        setReport(next)
      }
    } catch {
      if (request.current === id) setError('本次更新未完成，请重试。已有报告保留上次结果，缺失数据不会算成零。')
    } finally {
      if (request.current === id) { inFlight.current = false; setBusy(false) }
    }
  }

  useEffect(() => {
    if (selection && active && !initialLoad.current) { initialLoad.current = true; void load() }
  })

  const body = useMemo(() => journalBody(report?.body, report?.start || '', report?.end || ''), [report])
  useEffect(() => {
    setPhotos(null); setPhotosError(false)
    if (!report || !active) { setPhotosBusy(false); return }
    let cancelled = false
    const token = getAccessToken()
    setPhotosBusy(true)
    void (async () => {
      if (!report.ownerId) throw new Error('missing recap owner')
      const response = await communityGetFeed(undefined, 0, 100, false, 0, { sort_by: 'latest', author_id: report.ownerId })
      if (cancelled || token !== getAccessToken()) return
      setPhotos(journalFeedPhotos((response.list || []).map(normalizeCommunityFeedItem), report.start, report.end, report.ownerId, 'personal'))
    })().catch(() => { if (!cancelled && token === getAccessToken()) setPhotosError(true) }).finally(() => { if (!cancelled) setPhotosBusy(false) })
    return () => { cancelled = true }
  }, [report, active, photoRetry])
  const pageCount = 6
  const go = (next: number) => {
    const visibleNext = next === 3 ? (storyPage > 3 ? 2 : 4) : next
    const target = Math.max(0, Math.min(pageCount - 1, visibleNext))
    if (turning.current || target === storyPage) return
    turning.current = true; setTransition({ from: storyPage, to: target, serial: ++transitionSerial.current }); setStoryPage(target)
  }
  const transitionMotifs = ['letter', 'steam', 'water', 'ink', 'leaves', 'ticket', 'light'] as const

  if (!report) return (
    <View className='health-recap health-recap--cover' id='health-recap'>
      <View className='health-recap__opening-orbit'><Text>✦</Text><Text>✦</Text><Text>✦</Text></View>
      <View className='health-recap__opening-copy'>
        <Text className='health-recap__eyebrow'>MY LITTLE ADVENTURE</Text>
        <Text className='health-recap__title'>健康回忆册</Text>
        <Text className='health-recap__intro'>把认真生活的小事，讲成一段只属于你的故事。</Text>
      </View>
      {!selection && <View className='health-recap__tabs'>
        {(['week', 'month', 'year'] as const).map(value => <View key={value} role='button' className={kind === value ? 'is-selected' : ''} onClick={() => selectReport(value, year)}>{value === 'week' ? '上周' : value === 'month' ? '上月' : '去年'}</View>)}
      </View>}
      <View className='health-recap__opening-pet'><PetCompanionSprite src={JIANWEN_COMPANION_SRC} name='鬼鬼' pose='wave' /></View>
      {busy ? <View className='health-recap__skeleton'><View /><View /><View /></View> : <View id='health-recap-generate' role='button' className='health-recap__button' onClick={load}>{error ? '重新打开' : '开始这段旅程'}</View>}
      {error && <Text className='health-recap__error'>{error}</Text>}
      <Text className='health-recap__note'>报告只使用当前账号已有记录；没有记录的日子会留白。</Text>
    </View>
  )

  return (
    <View className={`health-recap health-recap--story health-recap--${kind}`} id='health-recap'
      onTouchStart={event => { const touch = (event as unknown as { touches?: { clientX: number; clientY: number }[] }).touches?.[0]; gesture.current = touch ? { x: touch.clientX, y: touch.clientY } : null }}
      onTouchMove={event => { const start = gesture.current; const touch = (event as unknown as { touches?: { clientX: number; clientY: number }[] }).touches?.[0]; if (completed && start && touch && !turning.current && Date.now() - lastDrag.current > 32) { lastDrag.current = Date.now(); const dx = touch.clientX - start.x, dy = touch.clientY - start.y; if (Math.abs(dx) > Math.abs(dy) * 1.3) setDrag(Math.max(-36, Math.min(36, dx * .2))) } }}
      onTouchCancel={() => { gesture.current = null; setDrag(0) }}
      onTouchEnd={event => { const start = gesture.current; gesture.current = null; setDrag(0); const end = (event as unknown as { changedTouches?: { clientX: number; clientY: number }[] }).changedTouches?.[0]; if (completed && start && end) go(journalSwipeTarget(storyPage, end.clientX - start.x, end.clientY - start.y, pageCount)) }}
    >
      {kind === 'week' && <RecapMusic active={active} />}
      {error && <Text className='health-recap__story-error'>{error}</Text>}
      {transition && <View key={transition.serial} className={`journal-turn-motif journal-turn-motif--${transitionMotifs[Math.min(transition.from, transitionMotifs.length - 1)]}`}><View /></View>}
      <View className={`health-recap__track journal-track${transition ? ' is-transitioning' : ''}${transition && transition.to < transition.from ? ' is-reversing' : ''}`} style={{ transform: `translateX(${drag}px)` }}>
        {Array.from({ length: pageCount }, (_, chapter) => chapter).filter(chapter => chapter !== 3).map(chapter => <View className={`health-recap__scene${chapter === storyPage ? ' is-visible' : ''}${transition?.from === chapter ? ' is-leaving' : ''}${transition?.to === chapter ? ' is-entering' : ''}`} key={`${kind}:${report.start}:${chapter}`} aria-hidden={chapter !== storyPage}>
          <RecapJournalScene onBound={() => { if (!completed) { setCompleted(true); completeCallback.current?.() } }} recipient={report.recipient} chapter={chapter} kind={kind} days={report.days} recorded={report.recorded} next={() => go(chapter + 1)} body={body} health={report.health} photos={photos} photosBusy={photosBusy} photosError={photosError} retryPhotos={() => setPhotoRetry(value => value + 1)} journey={journey} onJourney={change => setJourney(previous => ({ ...previous, ...change }))} active={active && storyPage === chapter} />
          {chapter === 5 && storyPage === 5 && completed && <RecapShare inline kind={kind} recipient={report.recipient} start={report.start} end={report.end} recorded={report.recorded} longest={report.longest} journey={journey} title={report.title} cups={body.cups} photos={photos} onClose={() => go(5)} onShelf={onShelf} />}
        </View>)}
      </View>
    </View>
  )
}
