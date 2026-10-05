import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getBodyMetricsSummary, getExerciseLogs, type PetProfile } from '../../utils/api'
import { PetActor, type PetAction } from '../../components/PetActor'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../utils/home-events'
import { HOME_COMPANION_CHANGED_EVENT } from '../../utils/pet-companion-preference'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../utils/pet-events'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { growthDay } from '../../utils/pet-growth-storage'
import { GROWTH_GAMES, growthLevel, type GrowthSave, type GrowthUpdate, type PlayableGrowthGame } from '../../utils/pet-growth'
import { PET_CARE_ACTIONS, PET_CARE_INTERACTIONS, PET_CARE_MILESTONES, cancelPetCareSession, claimPetCare, claimPetCareMilestone, exerciseCareEvidence, savePetCareSession, consumePetCareItem, waterCareEvidence, type PetCareEvidence } from '../../utils/pet-care'
import { newPetCareProgress, PET_CARE_DURATIONS, type PetCareKind, type PetCareSession, type PetCareTimerKind } from '../../utils/pet-care-schema'
import './PetGrowthGarden.scss'

type EvidenceState = { loading: boolean; error: boolean; evidence: PetCareEvidence | null }
const blankEvidence = (): EvidenceState => ({ loading: true, error: false, evidence: null })
const timeLabel = (milliseconds: number) => { const seconds = Math.ceil(Math.max(0, milliseconds) / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
export function PetGrowthGarden({ pet, sprite, appearance, account, active, save, resumeSession, canMutate, onMutate, onCheckpoint, onPlay, onCollection }: {
  pet: PetProfile; sprite?: string; appearance: string; account: string; active: boolean; save: GrowthSave
  resumeSession?: PetCareSession; canMutate: () => boolean; onMutate: (mutate: (latest: GrowthSave) => GrowthUpdate) => boolean
  onCheckpoint: (session: PetCareSession) => boolean; onPlay: (game: PlayableGrowthGame) => void; onCollection: () => void
}) {
  const [day, setDay] = useState(growthDay); const journey = save.pets[pet.id]; const progress = journey?.care || newPetCareProgress()
  const level = growthLevel(journey?.xp || 0)
  const claimed = save.care?.day === day ? save.care.claimed : {}
  const done = PET_CARE_ACTIONS.filter(item => claimed[item.id]).length
  const interactions = save.care?.interactionDay === day ? save.care.interactions : 0
  const [water, setWater] = useState<EvidenceState>(blankEvidence)
  const [exercise, setExercise] = useState<EvidenceState>(blankEvidence)
  const [selectedTimer, setSelectedTimer] = useState<PetCareTimerKind>('work')
  const [minutes, setMinutes] = useState(5)
  const [timer, setTimer] = useState<PetCareSession | null>(() => {
    const stored = resumeSession || save.care?.sessions[pet.id]
    return stored && stored.petId === pet.id && stored.appearance === appearance ? { ...stored, status: 'paused' } : null
  })
  const [showTimer, setShowTimer] = useState(Boolean(timer))
  const [busy, setBusy] = useState<PetCareKind | null>(null)
  const [response, setResponse] = useState('你认真照顾自己的每一步，伙伴都会记住。')
  const [pose, setPose] = useState<PetAction>('idle')
  const [interactionFeedback, setInteractionFeedback] = useState('')
  const timerRef = useRef(timer); const sequence = useRef(0); const mounted = useRef(true); const busyRef = useRef(false)
  const identity = `${account}:${pet.id}:${appearance}`; const owner = useRef(identity)
  const callbacks = useRef({ canMutate, onMutate, onCheckpoint, identity }); callbacks.current = { canMutate, onMutate, onCheckpoint, identity }
  const canAct = () => mounted.current && owner.current === callbacks.current.identity && callbacks.current.canMutate()
  useEffect(() => {
    if (!active) return
    setDay(growthDay())
    const interval = setInterval(() => setDay(growthDay()), 60000)
    return () => clearInterval(interval)
  }, [active])
  const putTimer = (value: PetCareSession | null) => { timerRef.current = value; if (mounted.current) setTimer(value) }
  const pause = () => {
    const current = timerRef.current
    if (!current) return
    const paused = { ...current, status: 'paused' as const }; putTimer(paused)
    if (!callbacks.current.onCheckpoint(paused) && mounted.current) setResponse('这段计时暂未保存，请留在成长页重试。')
  }
  const refreshEvidence = async () => {
    const serial = ++sequence.current; const date = growthDay()
    setWater(blankEvidence()); setExercise(blankEvidence())
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => getBodyMetricsSummary('month')), Promise.resolve().then(() => getExerciseLogs({ date }))])
    if (!mounted.current || serial !== sequence.current || date !== growthDay() || !canAct()) return
    const [waterResult, exerciseResult] = outcomes
    setWater(waterResult.status === 'fulfilled' ? { loading: false, error: false, evidence: waterCareEvidence(waterResult.value, date) } : { loading: false, error: true, evidence: null })
    setExercise(exerciseResult.status === 'fulfilled' ? { loading: false, error: false, evidence: exerciseCareEvidence(exerciseResult.value.logs || [], date) } : { loading: false, error: true, evidence: null })
  }
  useEffect(() => {
    if (owner.current !== identity) { sequence.current += 1; putTimer(null); return }
    if (timerRef.current && timerRef.current.day !== day) pause()
    if (active) void refreshEvidence()
    else { sequence.current += 1; pause() }
  // Callback refs prevent each ledger update from restarting requests or timers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, account, pet.id, appearance, day])
  useEffect(() => {
    const refresh = () => { if (active && canAct()) void refreshEvidence() }
    const identityChanged = () => { sequence.current += 1; pause() }
    Taro.eventCenter.on(HOME_DASHBOARD_REFRESH_EVENT, refresh)
    Taro.eventCenter.on(HOME_COMPANION_CHANGED_EVENT, identityChanged)
    Taro.eventCenter.on(HOME_PET_PROFILE_CHANGED_EVENT, identityChanged)
    return () => { Taro.eventCenter.off(HOME_DASHBOARD_REFRESH_EVENT, refresh); Taro.eventCenter.off(HOME_COMPANION_CHANGED_EVENT, identityChanged); Taro.eventCenter.off(HOME_PET_PROFILE_CHANGED_EVENT, identityChanged) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, account, pet.id, appearance])
  useEffect(() => () => { mounted.current = false; sequence.current += 1; pause() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const finishTimer = (completed: PetCareSession) => {
    if (!canAct()) { putTimer({ ...completed, status: 'paused' }); return }
    const ok = callbacks.current.onMutate(latest => claimPetCare(latest, pet.id, completed.kind, completed.day, undefined, completed))
    if (ok) { putTimer(null); setShowTimer(false); setPose(completed.kind === 'work' ? 'celebrate' : 'blink'); setResponse(completed.kind === 'work' ? '这一小段专注完成了，伙伴也跟着你长大了一点。' : '休息好了，慢慢来，我们还有很多好时光。') }
    else { const paused = { ...completed, status: 'paused' as const }; putTimer(paused); callbacks.current.onCheckpoint(paused); setResponse('计时已完成，成长还没保存。请点“重试领取”。') }
  }
  useEffect(() => {
    if (!active || timer?.status !== 'running') return
    let previous = Date.now()
    const interval = setInterval(() => {
      const current = timerRef.current
      if (!current || current.status !== 'running') return
      if (!canAct() || current.day !== growthDay()) { pause(); return }
      const now = Date.now(); const delta = Math.max(0, Math.min(1250, now - previous)); previous = now
      const next = { ...current, elapsedMs: Math.min(current.targetMs, current.elapsedMs + delta) }
      putTimer(next)
      if (next.elapsedMs >= next.targetMs) finishTimer(next)
    }, 250)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, timer?.status])
  const verifyAndClaim = async (kind: 'water' | 'exercise') => {
    if (busyRef.current || !active || !canAct()) return
    busyRef.current = true; setBusy(kind); const serial = ++sequence.current; const date = growthDay()
    try {
      const evidence = kind === 'water' ? waterCareEvidence(await getBodyMetricsSummary('month'), date) : exerciseCareEvidence((await getExerciseLogs({ date })).logs || [], date)
      if (!mounted.current || serial !== sequence.current || date !== growthDay() || !canAct()) return
      const state = { loading: false, error: false, evidence }; if (kind === 'water') setWater(state); else setExercise(state)
      if (!evidence) { setResponse('还没有找到今天已保存的记录，先去记录，再回来领取。'); return }
      if (callbacks.current.onMutate(latest => claimPetCare(latest, pet.id, kind, date, evidence))) { setPose(kind === 'water' ? 'wave' : 'jump'); setResponse(PET_CARE_ACTIONS.find(item => item.id === kind)!.response) }
    } catch { if (mounted.current && serial === sequence.current) { setResponse('记录暂时无法确认，请重试。没有领取或扣除星光币。'); const state = { loading: false, error: true, evidence: null }; if (kind === 'water') setWater(state); else setExercise(state) } }
    finally { busyRef.current = false; if (mounted.current) setBusy(null) }
  }
  const chooseTimer = (kind: PetCareTimerKind) => { pause(); if (timerRef.current && timerRef.current.kind !== kind) setResponse('先结束已有计时，再开始另一种陪伴；已完成的计时可以先领取。'); setSelectedTimer(kind); setMinutes(PET_CARE_DURATIONS[kind][0]); setShowTimer(true) }
  const startTimer = () => {
    const date = growthDay()
    setDay(date)
    if (!active || !canAct() || (save.care?.day === date && save.care.claimed[selectedTimer])) return
    const current: PetCareSession = { id: `timer:${Date.now()}:${selectedTimer}`, petId: pet.id, appearance, kind: selectedTimer, day: date, targetMs: minutes * 60000, elapsedMs: 0, status: 'running' }
    if (callbacks.current.onMutate(latest => savePetCareSession(latest, current))) { putTimer(current); setPose(selectedTimer === 'work' ? 'observe' : 'blink'); setResponse(selectedTimer === 'work' ? '你忙你的，我在这里陪着你。' : '把步子放慢一点，和伙伴一起歇一会儿。') }
  }
  const careButton = (kind: PetCareKind) => {
    if (save.care?.day === growthDay() && save.care.claimed[kind]) return
    if (kind === 'work' || kind === 'rest') { chooseTimer(kind); return }
    const state = kind === 'water' ? water : exercise
    if (state.error) { void refreshEvidence(); return }
    if (state.evidence) { void verifyAndClaim(kind); return }
    pause(); void Taro.navigateTo({ url: `${extraPkgUrl(kind === 'water' ? '/pages/water-record/index' : '/pages/exercise-record/index')}?date=${day}` })
  }
  const visibleTimer = timer && timer.petId === pet.id && timer.appearance === appearance && owner.current === identity ? timer : null
  const interact = (id: string) => {
    if (!active || !canAct() || busyRef.current) return
    busyRef.current = true
    const item = PET_CARE_INTERACTIONS.find(entry => entry.id === id)!
    const receipt = `care-use:${Date.now()}:${id}`
    if (callbacks.current.onMutate(latest => consumePetCareItem(latest, pet.id, id, receipt, growthDay()))) { setPose(item.pose); setResponse(item.response); setInteractionFeedback(`${item.name}已兑换 · 成长 +2 · 亲密 +2`) }
    else setInteractionFeedback('这次互动没有保存，原来的星光币仍在，请重试。')
    busyRef.current = false
  }
  return <View className='pet-growth-garden' id='pet-growth-garden'>
    <View className='pet-growth-garden__hero'><Image src='/packagePetStudio/assets/growth-room-v1.jpg' mode='aspectFill' /><View className='pet-growth-garden__identity'><Text>{pet.name}的成长日记</Text><Text>Lv.{level.level} · 一起把生活过好</Text></View><View className='pet-growth-garden__actor'><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} action={pose} size={100} active={active} followLoadout /></View><Text className='pet-growth-garden__speech'>{response}</Text></View>
    <View className='pet-growth-garden__level'><View><Text>成长 Lv.{level.level}</Text><Text>亲密 {journey?.affinity || 0} · {(save.care?.activeDays || []).length} 天有陪伴</Text></View><View className='journey-progress'><View style={{ width: `${level.next ? Math.min(100, level.current / level.next * 100) : 100}%` }} /></View><Text>{level.next ? `再成长 ${level.next - level.current} 点，打开下一份纪念` : '首期成长纪念全部可解锁，陪伴继续记录'}</Text></View>
    <View className='pet-growth-garden__section'><Text>今天，和伙伴一起</Text><Text>{done}/4 项已完成</Text></View>
    <View className='pet-growth-garden__actions'>{PET_CARE_ACTIONS.map(item => {
      const state = item.id === 'water' ? water : item.id === 'exercise' ? exercise : null
      const loading = state?.loading || busy === item.id
      const complete = Boolean(claimed[item.id])
      return <View key={item.id} className={`pet-growth-garden__care is-${item.id}${complete ? ' is-complete' : ''}`}><View className='pet-growth-garden__care-top'><Text>{item.mark}</Text><Text>{complete ? '✓ 已领取' : '+2 星光币'}</Text></View><Text className='pet-growth-garden__care-name'>{item.name}</Text><Text className='pet-growth-garden__care-description'>{state ? state.error ? '记录暂未确认，点一下重试' : state.evidence ? '今天已有保存的记录' : '先记录，再让伙伴一起成长' : item.id === 'work' ? '陪伴专注 · 前台计时' : '放松片刻 · 前台计时'}</Text><Text className='pet-growth-garden__care-reward'>成长 +5 · 亲密 +1</Text><Button id={`care-action-${item.id}`} className='journey-button pet-growth-garden__care-button' disabled={!active || complete || Boolean(loading)} onClick={() => careButton(item.id)}>{loading ? <View className='pet-growth-garden__spinner' aria-label='正在确认今天的记录' /> : complete ? '今天已完成' : state ? state.error ? '重新确认' : state.evidence ? '领取成长' : '去记录' : '开始陪伴'}{!loading && !complete && <Text> ›</Text>}</Button></View>
    })}</View>
    {showTimer && <View className='pet-growth-garden__timer' id='care-timer' data-state={visibleTimer?.status || 'ready'} data-elapsed={visibleTimer?.elapsedMs || 0}><View className='pet-growth-garden__section'><Text>{visibleTimer ? visibleTimer.kind === 'work' ? '伙伴陪你专注' : '和伙伴一起放松' : selectedTimer === 'work' ? '选一小段专注时间' : '给自己留一点休息'}</Text><Button className='journey-button journey-text' onClick={() => { pause(); setShowTimer(false) }}>收起</Button></View>
      {visibleTimer ? <><Text className='pet-growth-garden__clock'>{timeLabel(visibleTimer.targetMs - visibleTimer.elapsedMs)}</Text><Text className='pet-growth-garden__timer-note'>{visibleTimer.elapsedMs >= visibleTimer.targetMs ? '这段陪伴已完成，保存后才能领取' : visibleTimer.day !== day ? '日期已变化，结束这次后可开始今天的陪伴' : visibleTimer.status === 'paused' ? '已暂停，准备好再继续' : '只计前台时间，离开页面自动暂停'}</Text><View className='pet-growth-garden__timer-buttons'>{visibleTimer.elapsedMs >= visibleTimer.targetMs ? <Button id='care-timer-claim' className='journey-button journey-primary' disabled={!active} onClick={() => finishTimer(visibleTimer)}>重试领取</Button> : visibleTimer.status === 'running' ? <Button id='care-timer-pause' className='journey-button journey-primary' onClick={pause}>暂停一下</Button> : <Button id='care-timer-resume' className='journey-button journey-primary' disabled={!active || visibleTimer.day !== day} onClick={() => { if (canAct() && visibleTimer.day === day) putTimer({ ...visibleTimer, status: 'running' }) }}>继续陪伴</Button>}<Button id='care-timer-cancel' className='journey-button journey-secondary' disabled={!active} onClick={() => { if (callbacks.current.onMutate(latest => cancelPetCareSession(latest, pet.id, visibleTimer.id))) { putTimer(null); setPose('idle') } }}>结束这次</Button></View></> : <><View className='pet-growth-garden__durations'>{PET_CARE_DURATIONS[selectedTimer].map(value => <Button id={`care-duration-${value}`} className={`journey-button${minutes === value ? ' is-selected' : ''}`} key={value} onClick={() => setMinutes(value)}>{value} 分钟</Button>)}</View><Button id='care-timer-start' className='journey-button journey-primary' disabled={!active || Boolean(claimed[selectedTimer])} onClick={startTimer}>开始{selectedTimer === 'work' ? '专注' : '放松'} · 免费</Button></>}
    </View>}
    <View className='pet-growth-garden__loop'><Text>行动</Text><Text>→</Text><Text>星光币</Text><Text>→</Text><Text>互动与布置</Text><Text>→</Text><Text>伙伴成长</Text></View>
    <View className='pet-growth-garden__section'><Text>把星光，变成陪伴</Text><Text>✦ {save.stars} 星光币</Text></View><Text className='pet-growth-garden__interaction-note'>今日互动 {interactions}/3 · {interactions >= 3 ? '今天的陪伴礼物已收齐，明天再来' : '点一下兑换并互动，余额不足时先完成行动'}</Text><View className='pet-growth-garden__items'>{PET_CARE_INTERACTIONS.map(item => <Button id={`care-use-${item.id}`} key={item.id} className='journey-button pet-growth-garden__item' disabled={!active || save.stars < item.cost || (save.care?.interactionDay === day && save.care.interactions >= 3)} onClick={() => interact(item.id)}><Text>{item.mark}</Text><Text>{item.name}</Text><Text>兑换并互动 · {item.cost} 币</Text><Text>成长 +2 · 亲密 +2</Text></Button>)}</View>{interactionFeedback && <View className='pet-growth-garden__interaction-note' role='status'><Text>{interactionFeedback}</Text></View>}<Button id='care-decorate' className='journey-button journey-text' onClick={onCollection}>去星光小铺布置小屋 ›</Button>
    <View className='pet-growth-garden__traits'>{PET_CARE_ACTIONS.map(item => <View key={item.id}><Text>{item.trait}</Text><Text>{progress[item.id]} 次陪伴</Text></View>)}</View>
    <View className='pet-growth-garden__section'><Text>下一份成长纪念</Text><Text>达到等级后免费领取</Text></View><View className='pet-growth-garden__milestones'>{PET_CARE_MILESTONES.map(item => { const owned = progress.milestones.includes(item.level); const unlocked = level.level >= item.level; return <View key={item.id} className={`pet-growth-garden__milestone${owned ? ' is-owned' : ''}`}><Text>Lv.{item.level}</Text><View><Text>{item.name}</Text><Text>{item.description}</Text></View><Button id={`care-milestone-${item.level}`} className='journey-button' disabled={!active || !unlocked} onClick={() => { if (owned) onCollection(); else if (callbacks.current.onMutate(latest => claimPetCareMilestone(latest, pet.id, item.level))) { setPose('celebrate'); setResponse(`你们一起赢回了${item.name}，去收藏里摆放吧。`) } }}>{owned ? '去摆放' : unlocked ? '领取' : '未解锁'}</Button></View> })}</View>
    <View className='pet-growth-garden__section'><Text>想玩一局，也可以</Text><Text>游戏继续带回星光</Text></View><View className='journey-game-grid'>{GROWTH_GAMES.map(entry => <Button id={`journey-start-${entry.id}`} key={entry.id} className={`journey-button journey-game-card is-${entry.id}`} onClick={() => { pause(); onPlay(entry.id) }}><View className='journey-game-card__top'><Text>{entry.icon}</Text><Text>{journey?.cleared[entry.id].length || 0}/6</Text></View><Text className='journey-game-card__name'>{entry.name}</Text><Text>{entry.description}</Text><Text className='journey-game-card__go'>去玩一局 ›</Text></Button>)}</View>
    <Text className='pet-growth-garden__footnote'>四项每日各领一次，同一账号切换伙伴也不重复领币。饮水依据已保存饮水量，运动依据已保存记录；专注与放松是本机陪伴计时。基础行动免费，道具互动每日最多三次，星光币不兑换现金或 AI 积分。</Text>
  </View>
}
