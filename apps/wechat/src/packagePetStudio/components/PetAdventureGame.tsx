import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PetIdentityAvatar } from '../../components/PetIdentityAvatar'
import type { PetProfile } from '../../utils/api'
import {
  ADVENTURE_LEVELS, advanceAdventureGame, applyAdventureAction, createAdventureGame,
  type AdventureAction, type AdventureGameState, type AdventureResult,
} from '../../utils/pet-adventure-game'
import './PetAdventureGame.scss'

interface PetAdventureGameProps {
  active: boolean
  pet?: PetProfile | null
  accountId?: string
  startLevel?: number
  seed?: number
  board?: 'leafboard' | null
  scarf?: boolean
  settlementText?: string
  onExit: () => void
  onFinished?: (result: AdventureResult, roundId: string, sessionAccountId: string) => void | Promise<void>
  onRetrySettlement?: () => void | Promise<void>
}
type TouchPoint = { clientX: number; clientY: number }
type TouchLike = { touches?: TouchPoint[]; changedTouches?: TouchPoint[] }
type PropName = 'leaf' | 'star' | 'rock' | 'tree' | 'gap' | 'mint-board' | 'gold-board' | 'badge'
const PROP_CELLS: Record<PropName, [number, number]> = {
  leaf: [0, 0], star: [1, 0], rock: [2, 0], tree: [3, 0],
  gap: [3, 2], 'mint-board': [0, 2], 'gold-board': [1, 2], badge: [2, 2],
}
const BACKDROP = '/packagePetStudio/assets/adventure-lake-v1.jpg'
const ATLAS = '/packagePetStudio/assets/adventure-props-v1.png'
const SCARF = '/packagePetStudio/assets/explorer-scarf-v1.png'

function portraitPixels() {
  try { return Math.round((Taro.getWindowInfo().windowWidth || 375) * 168 / 750) } catch { return 84 }
}

function AdventurePortrait({ pet, scarf, size }: { pet: PetProfile; scarf: boolean; size: number }) {
  return <View className='pet-adventure__portrait'>
    <PetIdentityAvatar pet={pet} size={size} motion='static' />
    {scarf ? <Image className='pet-adventure__portrait-scarf' src={SCARF} mode='aspectFit' /> : null}
  </View>
}

function AdventureProp({ name, className = '' }: { name: PropName; className?: string }) {
  const [column, row] = PROP_CELLS[name]
  return <View className={`pet-adventure__prop ${className}`} style={{ backgroundImage: `url(${ATLAS})`, backgroundPosition: `${column * 100 / 3}% ${row * 50}%` }} />
}

function project(ahead: number, lane: number) {
  const depth = Math.max(0, Math.min(1, 1 - ahead / 45))
  const perspective = Math.pow(depth, 1.65)
  return {
    left: `${50 + lane * (4 + 28 * perspective)}%`, top: `${44 + 48 * perspective}%`,
    transform: `translate(-50%, -100%) scale(${.22 + perspective * 1.02})`,
    opacity: Math.min(1, depth * 4), zIndex: 2 + Math.round(perspective * 16),
  }
}

export function PetAdventureGame({ active, pet, accountId, startLevel = 1, seed, board = null, scarf = false, settlementText, onExit, onFinished, onRetrySettlement }: PetAdventureGameProps) {
  const [state, setState] = useState<AdventureGameState>(() => createAdventureGame(startLevel, seed))
  const [settling, setSettling] = useState(false)
  const [settlementError, setSettlementError] = useState(false)
  const [tutorial, setTutorial] = useState(false)
  const [guideVisible, setGuideVisible] = useState(false)
  const [portraitSize] = useState(portraitPixels)
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const accountRef = useRef(accountId)
  const mountedRef = useRef(true)
  const callbackRef = useRef(onFinished)
  const roundId = useRef('')
  const roundSession = useRef<{ id: string; accountId: string; callback: PetAdventureGameProps['onFinished'] } | null>(null)
  const roundCounter = useRef(0)
  const lastTick = useRef(0)
  const touchStart = useRef<TouchPoint | null>(null)
  const notifiedResult = useRef<AdventureResult | null>(null)
  stateRef.current = state
  activeRef.current = active
  callbackRef.current = onFinished
  const level = ADVENTURE_LEVELS.find(item => item.id === state.levelId) || ADVENTURE_LEVELS[0]
  const playing = state.status === 'running'
  const inRound = state.status === 'running' || state.status === 'paused'
  const progress = Math.min(100, state.elapsedMs / level.durationMs * 100)

  const dispatch = useCallback((action: AdventureAction) => {
    if (!activeRef.current && action.type !== 'pause') return
    setState(previous => applyAdventureAction(previous, action))
  }, [])
  useEffect(() => {
    accountRef.current = accountId
    notifiedResult.current = stateRef.current.result
    roundId.current = ''
    roundSession.current = null
    touchStart.current = null
    setState(createAdventureGame(startLevel, seed))
    setSettling(false)
    setSettlementError(false)
    setTutorial(false)
    setGuideVisible(false)
  }, [accountId, startLevel, seed])
  useEffect(() => {
    if (!active) { dispatch({ type: 'pause' }); touchStart.current = null }
  }, [active, dispatch])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; activeRef.current = false; roundId.current = ''; roundSession.current = null }
  }, [])
  useEffect(() => {
    if (!active || !playing) return undefined
    lastTick.current = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      const delta = Math.max(0, now - lastTick.current)
      lastTick.current = now
      setState(previous => advanceAdventureGame(previous, delta))
    }, 40)
    return () => clearInterval(timer)
  }, [active, playing])
  useEffect(() => {
    const result = state.result
    const currentRound = roundId.current
    const session = roundSession.current
    if (!activeRef.current || !result || notifiedResult.current === result || !currentRound || !session || session.id !== currentRound || session.accountId !== accountId || accountRef.current !== accountId) return
    notifiedResult.current = result
    if (!session.callback) return
    setSettling(true)
    setSettlementError(false)
    Promise.resolve().then(() => {
      if (!mountedRef.current || roundId.current !== currentRound || accountRef.current !== accountId) return
      if (!activeRef.current) { notifiedResult.current = null; return }
      return session.callback?.(result, currentRound, session.accountId)
    }).then(() => {
      if (mountedRef.current && roundId.current === currentRound && accountRef.current === accountId) setSettling(false)
    }).catch(() => {
      if (mountedRef.current && roundId.current === currentRound && accountRef.current === accountId) { setSettling(false); setSettlementError(true) }
    })
  }, [accountId, active, state.result])

  const start = () => {
    if (!activeRef.current || !accountId) return
    roundCounter.current += 1
    roundId.current = `adventure:${Date.now()}:${roundCounter.current}:${Math.random().toString(36).slice(2, 8)}`
    roundSession.current = { id: roundId.current, accountId, callback: callbackRef.current }
    notifiedResult.current = null
    touchStart.current = null
    setSettling(false)
    setSettlementError(false)
    setTutorial(false)
    setGuideVisible(false)
    setState(applyAdventureAction(createAdventureGame(startLevel, seed), { type: 'start' }))
  }
  const reset = () => {
    roundId.current = ''
    roundSession.current = null
    notifiedResult.current = stateRef.current.result
    setState(createAdventureGame(startLevel, seed))
    setSettling(false)
    setSettlementError(false)
  }
  const beginSwipe = (event: unknown) => {
    const point = (event as TouchLike).touches?.[0]
    touchStart.current = playing && activeRef.current && point ? { clientX: point.clientX, clientY: point.clientY } : null
  }
  const finishSwipe = (event: unknown) => {
    const first = touchStart.current
    const last = (event as TouchLike).changedTouches?.[0]
    touchStart.current = null
    if (!first || !last || !activeRef.current || stateRef.current.status !== 'running') return
    const x = last.clientX - first.clientX
    const y = last.clientY - first.clientY
    if (Math.max(Math.abs(x), Math.abs(y)) < 24) return
    if (Math.abs(x) > Math.abs(y)) dispatch({ type: x < 0 ? 'move-left' : 'move-right' })
    else if (y < 0) dispatch({ type: 'jump' })
  }
  const retrySettlement = () => {
    const session = roundSession.current
    if (!activeRef.current || !onRetrySettlement || !session || session.id !== roundId.current || session.accountId !== accountRef.current) return
    setSettling(true)
    setSettlementError(false)
    Promise.resolve().then(onRetrySettlement).then(() => {
      if (mountedRef.current && roundId.current === session.id && accountRef.current === session.accountId) setSettling(false)
    }).catch(() => {
      if (mountedRef.current && roundId.current === session.id && accountRef.current === session.accountId) { setSettling(false); setSettlementError(true) }
    })
  }

  return <View className={`pet-adventure ${inRound ? 'is-round' : ''}`}>
    <View className='pet-adventure__header'>
      <Button id='adventure-back' className='pet-adventure__button pet-adventure__back' aria-label={inRound ? '暂停并查看离开选项' : '返回成长小屋'} onClick={() => inRound ? dispatch({ type: 'pause' }) : onExit()}>‹</Button>
      <View className='pet-adventure__heading'><Text className='pet-adventure__chapter'>{level.chapterName}</Text><Text className='pet-adventure__title'>{level.name}</Text></View>
      {playing ? <Button id='adventure-pause' className='pet-adventure__button pet-adventure__pause' onClick={() => dispatch({ type: 'pause' })}>暂停</Button> : <AdventureProp name='badge' className='pet-adventure__header-badge' />}
    </View>

    {state.status === 'finished' && state.result ? <View id='adventure-result' data-score={state.result.score} data-stars={state.result.stars} data-completed={state.result.completed} className='pet-adventure__result'>
      <AdventureProp name='badge' className='pet-adventure__result-badge' />
      <Text className='pet-adventure__result-title'>{state.result.completed ? '又一起走远了一点' : '休息一下，再出发'}</Text>
      <Text className='pet-adventure__result-stars'>{'★'.repeat(state.result.stars)}{'☆'.repeat(3 - state.result.stars)}</Text>
      <Text className='pet-adventure__result-score'>{state.result.score}<Text className='pet-adventure__score-unit'>分</Text></Text>
      <View className='pet-adventure__result-grid'><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{Math.floor(state.result.distance)}m</Text><Text className='pet-adventure__metric-label'>本次旅途</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.bestCombo}</Text><Text className='pet-adventure__metric-label'>最高连击</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.result.leaves}</Text><Text className='pet-adventure__metric-label'>收集叶片</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.result.collectedStars}</Text><Text className='pet-adventure__metric-label'>收集星光</Text></View></View>
      <View className='pet-adventure__result-companion'>{pet ? <AdventurePortrait pet={pet} scarf={scarf} size={portraitSize} /> : null}<Text className='pet-adventure__speech'>{state.result.completed ? `${pet?.name || '伙伴'}：你的每一小步，我都记得。` : `${pet?.name || '伙伴'}：我们已经更熟练了，下次换条路线试试。`}</Text></View>
      {settling ? <View className='pet-adventure__settlement-spinner' aria-label='正在保存本局成长' /> : settlementError ? <Text className='pet-adventure__settlement'>这次成长暂未保存，请回小屋查看。</Text> : settlementText ? <Text className='pet-adventure__settlement'>{settlementText}</Text> : null}
      {onRetrySettlement ? <Button id='adventure-retry-settlement' className='pet-adventure__button pet-adventure__secondary' disabled={settling} onClick={retrySettlement}>重新保存这段成长</Button> : null}
      <Button id='adventure-retry' className='pet-adventure__button pet-adventure__primary' disabled={settling || Boolean(onRetrySettlement)} onClick={start}>再去探险</Button><Button id='adventure-result-exit' className='pet-adventure__button pet-adventure__secondary' disabled={settling || Boolean(onRetrySettlement)} onClick={onExit}>回到成长小屋</Button>
      <Text className='pet-adventure__footnote'>游戏冒险不计入真实运动记录</Text>
    </View> : <>
      {inRound ? <View className='pet-adventure__hud'>
        <View className='pet-adventure__hud-score'><Text className='pet-adventure__hud-value'>{state.score}</Text><Text className='pet-adventure__hud-label'>得分</Text></View>
        <View className='pet-adventure__hearts' aria-label={`剩余${state.hearts}颗爱心`}>{[0, 1, 2].map(index => <Text key={index} className={`pet-adventure__heart ${index < state.hearts ? 'is-full' : ''}`}>♥</Text>)}</View>
        <View className='pet-adventure__hud-charge'><Text className='pet-adventure__hud-label'>冲刺 {Math.floor(state.dashCharge)}%</Text><View className='pet-adventure__charge-track'><View className='pet-adventure__charge-fill' style={{ width: `${state.dashCharge}%` }} /></View></View>
        <Text className='pet-adventure__hud-time'>{Math.ceil(state.remainingMs / 1000)}秒</Text>
      </View> : <View className='pet-adventure__intro'><Text className='pet-adventure__intro-title'>和熟悉的伙伴，去收集新的故事</Text><Text className='pet-adventure__intro-caption'>{level.description}</Text></View>}

      <View id='adventure-world' data-lane={state.lane} data-distance={state.distance} data-state={state.status} data-score={state.score} data-charge={Math.floor(state.dashCharge)} data-remaining={state.remainingMs} data-hearts={state.hearts} data-jump={state.jumpRemainingMs} data-dash={state.dashRemainingMs} className={`pet-adventure__world ${state.dashRemainingMs > 0 ? 'is-dashing' : ''}`} style={{ backgroundImage: `url(${BACKDROP})` }} catchMove={playing} onTouchStart={beginSwipe} onTouchEnd={finishSwipe} onTouchCancel={() => { touchStart.current = null }}>
        <View className='pet-adventure__world-vignette' />
        <View className='pet-adventure__lane-guide is-left' /><View className='pet-adventure__lane-guide is-right' />
        {inRound ? <View className='pet-adventure__world-top'><Text className='pet-adventure__distance'>{Math.floor(state.distance)}m</Text>{state.combo > 1 ? <Text className='pet-adventure__combo'>{state.combo}连击 ×{(1 + Math.min(10, state.combo) * .05).toFixed(2)}</Text> : null}</View> : null}
        {inRound ? <View className='pet-adventure__journey-track'><View className='pet-adventure__journey-fill' style={{ width: `${progress}%` }} /></View> : null}
        {state.obstacles.filter(obstacle => !obstacle.resolved && obstacle.distance - state.distance >= 0 && obstacle.distance - state.distance <= 45).map(obstacle => <View key={obstacle.id} data-lane={obstacle.lane} data-distance={obstacle.distance} data-type={obstacle.type} className={`pet-adventure__object pet-adventure__obstacle is-${obstacle.type}`} style={project(obstacle.distance - state.distance, obstacle.lane)}><AdventureProp name={obstacle.type} className='pet-adventure__world-prop' /></View>)}
        {state.pickups.filter(pickup => !pickup.resolved && !pickup.collected && pickup.distance - state.distance >= 0 && pickup.distance - state.distance <= 45).map(pickup => <View key={pickup.id} data-lane={pickup.lane} data-distance={pickup.distance} data-type={pickup.type} className={`pet-adventure__object pet-adventure__pickup is-${pickup.type}`} style={project(pickup.distance - state.distance, pickup.lane)}><AdventureProp name={pickup.type} className='pet-adventure__world-prop' /></View>)}
        {playing && state.feedback.kind === 'success' ? <View key={`collect-${state.feedback.sequence}`} className='pet-adventure__collection-flash' style={{ left: `${60 + state.lane * 28}%` }}><AdventureProp name='star' className='pet-adventure__collection-prop' /></View> : null}
        <View className={`pet-adventure__rider ${state.invulnerableMs > 0 ? 'is-hit' : ''} ${state.dashRemainingMs > 0 ? 'is-dashing' : ''}`} style={{ left: `${50 + state.lane * 28}%`, transform: `translate(-50%, -100%) translateY(-${state.jumpHeight * 115}rpx)` }}>
          <View className='pet-adventure__rider-shadow' />
          <View className='pet-adventure__dash-trail' />
          <View className='pet-adventure__rider-pet'>{pet ? <AdventurePortrait pet={pet} scarf={scarf} size={portraitSize} /> : <View className='pet-adventure__pet-spinner' aria-label='正在读取当前伙伴' />}</View>
          <AdventureProp name={board === 'leafboard' ? 'mint-board' : 'gold-board'} className='pet-adventure__board' />
        </View>
        {playing && state.remainingMs <= 10000 ? <Text className='pet-adventure__finish-notice'>终点就在前方，稳稳走完这一程</Text> : null}
        {!inRound ? <View className='pet-adventure__world-caption'><Text className='pet-adventure__world-caption-title'>{pet?.name || '你的伙伴'}，准备出发</Text><Text className='pet-adventure__world-caption-subtitle'>左右换道 · 跳过岩石 · 收集叶片与星光</Text></View> : null}
      </View>

      {inRound ? <>
        <View key={state.feedback.sequence} className={`pet-adventure__feedback is-${state.feedback.kind}`}><Text>{state.feedback.message}</Text></View>
        <View className='pet-adventure__controls'><Button id='adventure-left' className='pet-adventure__button pet-adventure__direction' disabled={!playing || state.lane === -1} onClick={() => dispatch({ type: 'move-left' })}><Text className='pet-adventure__control-icon'>‹</Text><Text>左移</Text></Button><Button id='adventure-jump' className='pet-adventure__button pet-adventure__jump' disabled={!playing || state.jumpRemainingMs > 0} onClick={() => dispatch({ type: 'jump' })}><Text className='pet-adventure__control-icon'>↑</Text><Text>跳跃</Text></Button><Button id='adventure-right' className='pet-adventure__button pet-adventure__direction' disabled={!playing || state.lane === 1} onClick={() => dispatch({ type: 'move-right' })}><Text className='pet-adventure__control-icon'>›</Text><Text>右移</Text></Button><Button id='adventure-dash' className={`pet-adventure__button pet-adventure__dash ${state.dashCharge >= 100 ? 'is-ready' : ''}`} disabled={!playing || state.dashCharge < 100 || state.dashRemainingMs > 0} onClick={() => dispatch({ type: 'dash' })}><Text className='pet-adventure__control-icon'>»</Text><Text>冲刺</Text></Button></View>
      </> : <>
        <View className='pet-adventure__ready-meta'><Text>{Math.round(level.durationMs / 1000)}秒一程</Text><Text>三颗爱心</Text><Text>外观不影响实力</Text></View>
        {board || scarf ? <Text className='pet-adventure__outfit'>{board ? '已装备叶叶滑板' : '公共滑板'}{scarf ? ' · 暖暖围巾已穿戴' : ''}</Text> : null}
        <Button id='adventure-start' className='pet-adventure__button pet-adventure__primary' disabled={!active || !pet || !accountId} onClick={start}>和{pet?.name || '伙伴'}出发</Button>
        <Button id='adventure-tutorial' className='pet-adventure__button pet-adventure__help' onClick={() => setTutorial(true)}>第一次探险？看看怎么玩</Button>
      </>}
    </>}

    {state.status === 'paused' && !guideVisible ? <View className='pet-adventure__mask'><View className='pet-adventure__dialog'><Text className='pet-adventure__dialog-title'>在湖边歇一会儿</Text><Text className='pet-adventure__dialog-caption'>旅途已暂停，回来后从这里继续。</Text><Button id='adventure-resume' className='pet-adventure__button pet-adventure__primary' disabled={!active} onClick={() => dispatch({ type: 'resume' })}>继续探险</Button><Button className='pet-adventure__button pet-adventure__secondary' onClick={reset}>重新准备</Button><Button id='adventure-help' className='pet-adventure__button pet-adventure__help' onClick={() => setGuideVisible(true)}>看看怎么玩</Button><Button id='adventure-exit' className='pet-adventure__button pet-adventure__help' onClick={onExit}>回到成长小屋</Button></View></View> : null}
    {tutorial || guideVisible ? <View className='pet-adventure__mask'><View className='pet-adventure__dialog'><Text className='pet-adventure__dialog-title'>轻快出发，慢慢长大</Text><View className='pet-adventure__tutorial-row'><AdventureProp name='leaf' className='pet-adventure__tutorial-prop' /><Text>左右滑动或点按钮换道，收集叶片补充冲刺。</Text></View><View className='pet-adventure__tutorial-row'><AdventureProp name='rock' className='pet-adventure__tutorial-prop' /><Text>上滑或点跳跃越过岩石、水洼。树桩只能换道。</Text></View><View className='pet-adventure__tutorial-row'><AdventureProp name='star' className='pet-adventure__tutorial-prop' /><Text>连着收集更高分。冲刺能撞开岩石，不能穿过树桩。</Text></View><Text className='pet-adventure__dialog-caption'>滑板带着伙伴整体跳跃，保留角色原本的模样。</Text><Button id='adventure-tutorial-done' className='pet-adventure__button pet-adventure__primary' onClick={() => { setTutorial(false); setGuideVisible(false) }}>{guideVisible ? '明白了' : '准备好了'}</Button></View></View> : null}
  </View>
}
