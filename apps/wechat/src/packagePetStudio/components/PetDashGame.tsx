import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidHide } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PetActor } from '../../components/PetActor'
import type { PetProfile } from '../../utils/api'
import { ADVENTURE_COLLECTIBLES, adventureLevel } from '../../utils/pet-adventure-game'
import { advanceDashGame, createDashGame, dashAction, DASH_DURATION_MS, type DashResult } from '../../utils/pet-dash-game'
import './PetDashGame.scss'

interface Props {
  active: boolean; pet: PetProfile; accountId: string; startLevel?: number; quickStart?: boolean; bestScore?: number; board?: 'leafboard' | null
  onExit: () => void; onFinished: (result: DashResult, roundId: string, session: string) => void | Promise<void>
  settlementText?: string; onRetrySettlement?: () => void | Promise<void>
}
const ATLAS = '/packagePetStudio/assets/adventure-props-v1.png'
function Prop({ type, className = '' }: { type: 'rock' | 'tree' | 'leaf' | 'badge' | 'board'; className?: string }) {
  const cell = { rock: [2, 0], tree: [3, 0], leaf: [0, 0], badge: [2, 2], board: [0, 2] }[type]
  return <View className={`pet-dash__prop ${className}`} style={{ backgroundImage: `url(${ATLAS})`, backgroundPosition: `${cell[0] * 100 / 3}% ${cell[1] * 50}%` }} />
}
function actorPixels() { try { return (Taro.getWindowInfo().windowWidth || 375) * 144 / 750 } catch { return 72 } }
export function PetDashGame({ active, pet, accountId, startLevel = 1, quickStart = false, bestScore = 0, board = null, onExit, onFinished, settlementText, onRetrySettlement }: Props) {
  const [state, setState] = useState(() => createDashGame(startLevel))
  const [settling, setSettling] = useState(false)
  const [failed, setFailed] = useState(false)
  const [size] = useState(actorPixels)
  const scope = `${accountId}:${pet.id}`
  const refs = useRef({ active, scope, alive: true, callback: onFinished })
  refs.current.active = active; refs.current.scope = scope; refs.current.callback = onFinished
  const session = useRef<{ id: string; scope: string; account: string; callback: Props['onFinished'] } | null>(null)
  const notified = useRef(''); const serial = useRef(0); const lastTick = useRef(0); const automatic = useRef('')
  const blocked = settling || failed || Boolean(onRetrySettlement)
  const blockedRef = useRef(blocked); blockedRef.current = blocked
  const dispatch = useCallback((action: Parameters<typeof dashAction>[1]) => {
    if ((!refs.current.active && action !== 'pause') || blockedRef.current) return
    setState(previous => dashAction(previous, action))
  }, [])
  const start = useCallback(() => {
    if (!refs.current.active || blockedRef.current || !accountId) return
    session.current = { id: `dash:${Date.now()}:${++serial.current}:${Math.random().toString(36).slice(2, 8)}`, scope, account: accountId, callback: refs.current.callback }
    notified.current = ''; setFailed(false); setState(dashAction(createDashGame(startLevel), 'start'))
  }, [scope, accountId, startLevel])
  useEffect(() => {
    session.current = null; notified.current = ''; setSettling(false); setFailed(false); setState(createDashGame(startLevel))
    blockedRef.current = false
  }, [scope, startLevel])
  useEffect(() => {
    const key = `${scope}:${startLevel}`
    if (quickStart && active && accountId && !blocked && state.status === 'ready' && state.levelId === startLevel && automatic.current !== key) { automatic.current = key; start() }
  }, [quickStart, active, accountId, blocked, scope, startLevel, state.status, state.levelId, start])
  useDidHide(() => dispatch('pause'))
  useEffect(() => { if (!active) dispatch('pause') }, [active, dispatch])
  useEffect(() => { refs.current.alive = true; return () => { refs.current.alive = false; refs.current.active = false; session.current = null } }, [])
  useEffect(() => {
    if (!active || state.status !== 'running') return undefined
    lastTick.current = Date.now()
    const timer = setInterval(() => {
      const now = Date.now(); const delta = Math.max(0, now - lastTick.current); lastTick.current = now
      if (refs.current.active) setState(previous => advanceDashGame(previous, delta))
    }, 40)
    return () => clearInterval(timer)
  }, [active, state.status])
  useEffect(() => {
    const round = session.current; const result = state.result
    if (!result || !round || !active || round.scope !== scope || notified.current === round.id) return
    notified.current = round.id; blockedRef.current = true; setSettling(true)
    Promise.resolve().then(() => {
      if (!refs.current.alive || session.current !== round || refs.current.scope !== round.scope) return
      if (!refs.current.active) { notified.current = ''; return }
      return round.callback(result, round.id, round.account)
    }).then(() => {
      if (refs.current.alive && session.current === round && refs.current.scope === round.scope) setSettling(false)
    }).catch(() => {
      if (refs.current.alive && session.current === round && refs.current.scope === round.scope) { setSettling(false); setFailed(true) }
    })
  }, [state.result, active, scope])
  const retrySave = () => {
    const round = session.current; const result = state.result
    if (!round || !result || settling || !active) return
    setSettling(true)
    Promise.resolve().then(() => {
      if (!refs.current.alive || !refs.current.active || session.current !== round || refs.current.scope !== round.scope) throw new Error('本局已切换')
      return onRetrySettlement ? onRetrySettlement() : round.callback(result, round.id, round.account)
    }).then(() => {
      if (refs.current.alive && session.current === round && refs.current.scope === round.scope) { setSettling(false); setFailed(false) }
    }).catch(() => { if (refs.current.alive && session.current === round && refs.current.scope === round.scope) { setSettling(false); setFailed(true) } })
  }
  const level = adventureLevel(state.levelId)
  const result = state.result
  const names = ADVENTURE_COLLECTIBLES
  const playing = state.status === 'running' && active
  return <View className='pet-dash'>
    <View className='pet-dash__header'><Button id='adventure-exit' className='pet-dash__back' disabled={blocked} onClick={() => { dispatch('pause'); session.current = null; onExit() }}>返回</Button><View><Text>追风快跑</Text><Text>第 {level.id} 关 · {level.name}</Text></View><Button id='adventure-back' className='pet-dash__back' disabled={!playing} onClick={() => dispatch('pause')}>暂停</Button></View>
    <View className='pet-dash__hud'><View><Text>{state.score}</Text><Text>本局得分</Text></View><View><Text>{Math.ceil((DASH_DURATION_MS - state.elapsedMs) / 1000)}s</Text><Text>到家倒计时</Text></View><View><Text>{state.hearts}/3</Text><Text>容错机会</Text></View></View>
    <View id='adventure-world' className={`pet-dash__world${state.feverRemainingMs > 0 ? ' is-fever' : ''}${state.status === 'paused' ? ' is-paused' : ''}`} data-state={state.status} data-distance={state.distance} data-score={state.score} data-hearts={state.hearts} data-jump={state.jumpRemainingMs} data-successful-jumps={state.successfulJumps} data-remaining={DASH_DURATION_MS - state.elapsedMs} catchMove={playing} onClick={() => { if (playing) dispatch('jump') }}>
      <View className='pet-dash__scene' style={{ backgroundImage: 'url(/packagePetStudio/assets/dash-stage-v1.jpg)', backgroundPosition: `${state.distance / 3}% center` }} />
      <View className='pet-dash__jump-mark'><Text>到线起跳</Text></View>
      <View className='pet-dash__world-top'><Text>{state.feverRemainingMs > 0 ? '双倍时刻 ×2' : `跳准蓄力 ${state.feverCharge}/3`}</Text><Text>{state.combo > 1 ? `${state.combo} 连击` : '点屏幕也能跳'}</Text></View>
      {state.obstacles.filter(item => item.distance - state.distance > -10 && item.distance - state.distance < 60).map(item => <View className={`pet-dash__obstacle${item.cleared ? ' is-cleared' : ''}`} key={item.id} data-distance={item.distance} style={{ left: `${22 + (item.distance - state.distance) * 1.55}%` }}><Prop type={item.type} />{item.collectible && !item.resolved && <Prop type='badge' className='pet-dash__prize' />}</View>)}
      <View className='pet-dash__rider' style={{ transform: `translate(-50%, -100%) translateY(-${state.jumpHeight * 118}rpx)` }}>{board && <Prop type='board' className='pet-dash__board' />}<PetActor pet={pet} size={size} action={result ? 'celebrate' : state.jumpRemainingMs > 0 ? 'jump' : playing ? 'walk' : 'idle'} active={active && state.status !== 'paused'} followLoadout /></View>
      <View key={state.feedback.sequence} className={`pet-dash__feedback is-${state.feedback.kind}`} role='status'><Text>{state.feedback.text}</Text></View>
      {state.status === 'ready' && <View className='pet-dash__overlay'><Text>点一下，就能跳过去</Text><Text>30 秒 · 三次跳准触发双倍</Text><Button id='adventure-start' className='pet-dash__primary' disabled={!active} onClick={start}>开始快跑</Button></View>}
      {state.status === 'paused' && <View className='pet-dash__overlay'><Text>伙伴在这里等你</Text><Button id='adventure-resume' className='pet-dash__primary' disabled={!active} onClick={() => dispatch('resume')}>继续跑</Button></View>}
    </View>
    <View className='pet-dash__progress'><View style={{ width: `${state.distance / 3}%` }} /></View>
    {!result ? <><Button id='adventure-jump' className='pet-dash__primary pet-dash__jump' disabled={!playing} onClick={() => dispatch('jump')}>点一下 · 起跳</Button><Text className='pet-dash__hint'>障碍到金线，点一下。连续三次跳准得双倍，连点不会重复起跳。</Text><View className='pet-dash__goal'><Prop type='badge' /><View><Text>这一程可以带回</Text><Text>{level.scenes.map(item => names[item.collectibleId]).join(' · ')}</Text></View></View></> : <View id='adventure-result' className='pet-dash__result'>
      <Text className='pet-dash__result-title'>{result.completed ? '漂亮！这一程到了' : result.successfulJumps > 0 ? '下次，再多连一跳' : '再来一局，找准起跳时机'}</Text><Text className='pet-dash__result-score'>{result.score}<Text> 分</Text></Text><Text>{result.bestCombo} 次最好连击 · {result.perfects} 次跳准{result.score > bestScore && result.successfulJumps > 0 ? ' · 超过此前最好成绩' : ''}</Text>
      {result.collectibleIds!.length > 0 && <View className='pet-dash__loot'><Prop type='badge' /><View><Text>亲手赢回的纪念</Text><Text>{result.collectibleIds!.map(id => names[id] || '本关旅行页').join(' · ')}</Text></View></View>}
      {settling && <View className='pet-dash__spinner' aria-label='正在保存本局' />}{settlementText && <Text className='pet-dash__save-note'>{settlementText}</Text>}
      {(failed || onRetrySettlement) && <Button id='adventure-retry-save' className='pet-dash__primary' disabled={settling || !active} onClick={retrySave}>重试保存本局</Button>}
      <View className='pet-dash__result-actions'><Button id='adventure-replay' className='pet-dash__primary' disabled={blocked || !active} onClick={start}>再跑一次</Button><Button id='adventure-home' className='pet-dash__back' disabled={blocked || !active} onClick={onExit}>带回小屋</Button></View>
    </View>}
  </View>
}
