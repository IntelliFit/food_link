import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { PetActor } from '../../components/PetActor'
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
const BACKDROP = '/packagePetStudio/assets/chapter-map-v1.jpg'
const ATLAS = '/packagePetStudio/assets/adventure-props-v1.png'

function portraitPixels() {
  try { return Math.round((Taro.getWindowInfo().windowWidth || 375) * 168 / 750) } catch { return 84 }
}

const AdventurePortrait = memo(function AdventurePortrait({ pet, scarf, size, action = 'idle', active = true }: { pet: PetProfile; scarf: boolean; size: number; action?: 'idle' | 'walk' | 'jump' | 'wave' | 'celebrate' | 'observe'; active?: boolean }) {
  return <View className='pet-adventure__portrait'><PetActor pet={pet} size={size} action={action} active={active} scarf={scarf ? 'explorer-scarf' : undefined} /></View>
})

function AdventureProp({ name, className = '' }: { name: PropName; className?: string }) {
  const [column, row] = PROP_CELLS[name]
  return <View className={`pet-adventure__prop ${className}`} style={{ backgroundImage: `url(${ATLAS})`, backgroundPosition: `${column * 100 / 3}% ${row * 50}%` }} />
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
  const scene = level.scenes[state.sceneIndex]
  const mechanism = state.mechanism
  const progress = Math.min(100, state.distance / 300 * 100)
  const collectibleOwned = state.collectedLandmarks.includes(scene.collectibleId)
  const isMechanism = state.phase === 'mechanism'
  const safeBypass = state.route === 'safe' && scene.safeBypass
  const manualEnabled = playing && isMechanism
  const actionText = mechanism.type === 'box' ? mechanism.gateOpen ? '木门已开' : '推轻箱' : mechanism.type === 'wind' ? mechanism.windCalm ? '风已停' : '等风停' : mechanism.type === 'platform' ? '等落点' : '观察'
  const hint = state.phase === 'fork' ? '路口会等你选择：收藏奖品已写在支路上。'
    : state.phase === 'rest' ? '这是游戏内的休息站。准备好就继续下一段。'
      : isMechanism ? safeBypass ? '宽桥 / 平路更稳妥，点前进沿路标走过这一段。' : mechanism.type === 'wind' ? state.route === 'safe' ? '下层不受风影响；靠近跳点起跳，再点前进。' : '旗子垂下才过桥。等风停、起跳，再连续点前进。'
        : mechanism.type === 'box' ? mechanism.gateOpen ? '门已打开；支路邮袋在身后，折返取走再跳过箱沿。' : '靠近箱子推一次，向前跟上，再推到踏板。'
          : mechanism.type === 'platform' ? '圆环是下一落点。踏板靠近圆环后，跳跃再点前进落地。'
            : mechanism.type === 'slope' ? '第一坡可短冲刺；第二处岩石必须起跳。' : '先靠近树根，起跳后点前进跨过去。'
      : '普通路段自动前进，路口与机关会停下等你。'

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
    if (Math.abs(x) > Math.abs(y)) dispatch({ type: x < 0 ? 'move-backward' : 'move-forward' })
    else if (y < 0) dispatch({ type: 'jump' })
  }
  const retrySettlement = () => {
    const session = roundSession.current
    if (!activeRef.current || !session || session.id !== roundId.current || session.accountId !== accountRef.current || (!onRetrySettlement && (!session.callback || !stateRef.current.result))) return
    setSettling(true)
    setSettlementError(false)
    Promise.resolve().then(() => onRetrySettlement ? onRetrySettlement() : session.callback?.(stateRef.current.result!, session.id, session.accountId)).then(() => {
      if (mountedRef.current && roundId.current === session.id && accountRef.current === session.accountId) { setSettling(false); setSettlementError(false) }
    }).catch(() => {
      if (mountedRef.current && roundId.current === session.id && accountRef.current === session.accountId) { setSettling(false); setSettlementError(true) }
    })
  }

  return <View className={`pet-adventure ${inRound ? 'is-round' : ''}`}>
    <View className='pet-adventure__header'>
      <Button id='adventure-back' disabled={settling || Boolean(onRetrySettlement) || settlementError} className='pet-adventure__button pet-adventure__back' aria-label={inRound ? '暂停并查看离开选项' : '返回成长小屋'} onClick={() => inRound ? dispatch({ type: 'pause' }) : onExit()}>‹</Button>
      <View className='pet-adventure__heading'><Text className='pet-adventure__chapter'>{level.chapterName}</Text><Text className='pet-adventure__title'>{level.name}</Text></View>
      {playing ? <Button id='adventure-pause' className='pet-adventure__button pet-adventure__pause' onClick={() => dispatch({ type: 'pause' })}>暂停</Button> : <AdventureProp name='badge' className='pet-adventure__header-badge' />}
    </View>

    {state.status === 'finished' && state.result ? <View id='adventure-result' data-score={state.result.score} data-stars={state.result.stars} data-completed={state.result.completed} className='pet-adventure__result'>
      <AdventureProp name='badge' className='pet-adventure__result-badge' />
      <Text className='pet-adventure__result-title'>{state.result.completed ? '又一起走远了一点' : '休息一下，再出发'}</Text>
      <Text className='pet-adventure__result-stars'>{'★'.repeat(state.result.stars)}{'☆'.repeat(3 - state.result.stars)}</Text>
      <Text className='pet-adventure__result-score'>{state.result.score}<Text className='pet-adventure__score-unit'>分</Text></Text>
      <View className='pet-adventure__result-grid'><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{Math.floor(state.result.distance)}m</Text><Text className='pet-adventure__metric-label'>本次旅途</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.bestCombo}</Text><Text className='pet-adventure__metric-label'>最高连击</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.result.leaves}</Text><Text className='pet-adventure__metric-label'>收集叶片</Text></View><View className='pet-adventure__result-metric'><Text className='pet-adventure__metric-value'>{state.result.collectedStars}</Text><Text className='pet-adventure__metric-label'>收集星光</Text></View></View>
      <View className='pet-adventure__result-companion'>{pet ? <AdventurePortrait pet={pet} scarf={scarf} size={portraitSize} active={active} action={state.result?.completed ? 'celebrate' : 'idle'} /> : null}<Text className='pet-adventure__speech'>{state.result.completed ? `${pet?.name || '伙伴'}：你的每一小步，我都记得。` : `${pet?.name || '伙伴'}：我们已经更熟练了，下次换条路线试试。`}</Text></View>
      {settling ? <View className='pet-adventure__settlement-spinner' aria-label='正在保存本局成长' /> : settlementError ? <Text className='pet-adventure__settlement'>这次成长暂未保存，请回小屋查看。</Text> : settlementText ? <Text className='pet-adventure__settlement'>{settlementText}</Text> : null}
      {onRetrySettlement || settlementError ? <Button id='adventure-retry-settlement' className='pet-adventure__button pet-adventure__secondary' disabled={settling} onClick={retrySettlement}>重新保存这段成长</Button> : null}
      <Button id='adventure-retry' className='pet-adventure__button pet-adventure__primary' disabled={settling || Boolean(onRetrySettlement) || settlementError} onClick={start}>再去探险</Button><Button id='adventure-result-exit' className='pet-adventure__button pet-adventure__secondary' disabled={settling || Boolean(onRetrySettlement) || settlementError} onClick={onExit}>回到成长小屋</Button>
      <Text className='pet-adventure__settlement'>{state.result.completedScenes || 0}/3场景 · 恢复{state.result.recoveries || 0}次 · 纪念品{state.result.collectibleIds?.length || 0}件{state.result.assisted ? ' · 辅助故事成绩' : ''}</Text><Text className='pet-adventure__footnote'>游戏冒险不计入真实运动记录</Text>
    </View> : <>
      {inRound ? <View className='pet-adventure__hud'>
        <View className='pet-adventure__hud-score'><Text className='pet-adventure__hud-value'>{state.score}</Text><Text className='pet-adventure__hud-label'>游戏得分</Text></View>
        <View className='pet-adventure__hud-scene'><Text className='pet-adventure__hud-value'>路标 {state.completedScenes}/3</Text><Text className='pet-adventure__hud-label'>{state.recoveries ? `恢复 ${state.recoveries}次 · 收藏保留` : '失误回路标'}</Text></View>
        <Text className='pet-adventure__hud-time'>{Math.ceil(state.remainingMs / 1000)}秒</Text>
      </View> : <View className='pet-adventure__intro'><Text className='pet-adventure__intro-title'>到下一处看看，带回一段故事</Text><Text className='pet-adventure__intro-caption'>{level.description}</Text></View>}

      <View id='adventure-world' data-lane={state.lane} data-distance={state.distance} data-x={state.x} data-phase={state.phase} data-scene={state.sceneIndex} data-route={state.route || ''} data-state={state.status} data-score={state.score} data-charge={Math.floor(state.dashCharge)} data-remaining={state.remainingMs} data-hearts={state.hearts} data-jump={state.jumpRemainingMs} data-dash={state.dashRemainingMs} data-wind={mechanism.windCalm} data-platform={mechanism.platformX} data-platform-target={mechanism.platformTarget} data-gate={mechanism.gateOpen} data-box={mechanism.boxX} className={`pet-adventure__world is-${scene.mechanism} ${state.phase === 'fork' ? 'is-fork' : ''} ${state.dashRemainingMs > 0 ? 'is-dashing' : ''}`} style={{ backgroundImage: `url(${BACKDROP})` }} catchMove={playing} onTouchStart={beginSwipe} onTouchEnd={finishSwipe} onTouchCancel={() => { touchStart.current = null }}>
        <View className='pet-adventure__world-top'><Text className='pet-adventure__scene-name'>0{state.sceneIndex + 1} · {scene.name}</Text>{state.combo > 1 ? <Text className='pet-adventure__combo'>{state.combo}连击 ×{(1 + Math.min(6, state.combo) * .05).toFixed(2)}</Text> : null}</View>
        <View className='pet-adventure__journey-track'><View className='pet-adventure__journey-fill' style={{ width: `${progress}%` }} /></View>
        <View className='pet-adventure__ground'><Text className='pet-adventure__path-label'>{state.route === 'collectible' ? '收藏支路' : state.route === 'safe' ? '稳妥主路' : '门前小径'}</Text></View>
        <View className='pet-adventure__checkpoint' style={{ left: `${10 + state.checkpointX * .78}%` }}><Text>路标</Text></View>
        {scene.mechanism === 'wind' ? <View className={`pet-adventure__wind ${mechanism.windCalm ? 'is-calm' : ''}`}><View className='pet-adventure__wind-pole' /><View className='pet-adventure__wind-flag' /><Text>{mechanism.windCalm ? '旗子垂下 · 可以过桥' : '风旗横摆 · 等一等'}</Text></View> : null}
        {inRound && !safeBypass && (scene.mechanism === 'root' || scene.mechanism === 'home' || scene.mechanism === 'slope' || scene.mechanism === 'wind') ? <>
          <View className='pet-adventure__hazard' style={{ left: `${10 + 60 * .78}%` }}><AdventureProp name={scene.mechanism === 'wind' ? 'gap' : 'tree'} className='pet-adventure__hazard-prop' /><Text>{scene.mechanism === 'slope' ? '短坡' : scene.mechanism === 'wind' ? '桥心跳点' : '矮树根'}</Text></View>
          {scene.mechanism === 'slope' ? <View className='pet-adventure__hazard is-rock' style={{ left: `${10 + 70 * .78}%` }}><AdventureProp name='rock' className='pet-adventure__hazard-prop' /><Text>岩石 · 只能跳过</Text></View> : null}
        </> : null}
        {inRound && scene.mechanism === 'box' ? <><View className='pet-adventure__light-box' style={{ left: `${10 + mechanism.boxX * .78}%` }}><Text>轻箱</Text></View><View className={`pet-adventure__gate ${mechanism.gateOpen ? 'is-open' : ''}`}><Text>{mechanism.gateOpen ? '门开了' : '木门'}</Text></View>{state.route === 'collectible' && !collectibleOwned ? <View className='pet-adventure__mail' style={{ left: `${10 + 48 * .78}%` }}><AdventureProp name='badge' className='pet-adventure__mail-prop' /><Text>折返取邮袋</Text></View> : null}</> : null}
        {inRound && scene.mechanism === 'platform' ? <><View className='pet-adventure__landing-target' style={{ left: `${10 + mechanism.platformTarget * .78}%` }}><Text>落点 {mechanism.platformSteps + 1}/{mechanism.platformTotal}</Text></View><View className='pet-adventure__moving-platform' style={{ left: `${10 + mechanism.platformX * .78}%` }} /><Text className='pet-adventure__platform-status'>{Math.abs(mechanism.platformX - mechanism.platformTarget) <= (state.assisted ? 5 : 2) ? '踏板到位 · 起跳后点前进' : '观察踏板，等它靠近圆环'}</Text></> : null}
        {state.pickups.filter(pickup => !pickup.collected && !pickup.resolved && Math.floor(pickup.distance / 100) === state.sceneIndex).map(pickup => <View key={pickup.id} data-distance={pickup.distance} data-type={pickup.type} className='pet-adventure__pickup' style={{ left: `${10 + pickup.distance % 100 * .78}%` }}><AdventureProp name={pickup.type} className='pet-adventure__pickup-prop' /></View>)}
        {state.route === 'collectible' && !collectibleOwned && scene.mechanism !== 'box' ? <View className='pet-adventure__landmark'><AdventureProp name='badge' className='pet-adventure__landmark-prop' /><Text>{scene.collectibleName}</Text></View> : null}
        <View className={`pet-adventure__rider ${state.dashRemainingMs > 0 ? 'is-dashing' : ''}`} style={{ left: `${10 + state.x * .78}%`, transform: `translate(-50%, -100%) translateY(-${state.jumpHeight * 100}rpx)` }}>
          <View className='pet-adventure__rider-shadow' />
          <View className='pet-adventure__rider-pet'>{pet ? <AdventurePortrait pet={pet} scarf={scarf} size={portraitSize} active={active && playing} action={!playing ? 'idle' : state.jumpHeight > 0 ? 'jump' : state.phase === 'travel' ? 'walk' : state.phase === 'rest' ? 'wave' : 'observe'} /> : <View className='pet-adventure__pet-spinner' aria-label='正在读取当前伙伴' />}</View>
        </View>
        {state.phase === 'fork' && inRound ? <View className='pet-adventure__fork-options'><Text>这次，想走哪条路？</Text><Button id='adventure-route-safe' className='pet-adventure__button pet-adventure__route' disabled={!playing} onClick={() => dispatch({ type: 'choose-route', route: 'safe' })}><Text>稳妥主路 →</Text><Text>{scene.safeBypass ? '宽桥 / 平路' : scene.mechanism === 'wind' ? '下层避风路线' : scene.mechanism === 'platform' ? '五次短跳' : '按路标稳稳走'}</Text></Button><Button id='adventure-route-collectible' className='pet-adventure__button pet-adventure__route is-collectible' disabled={!playing} onClick={() => dispatch({ type: 'choose-route', route: 'collectible' })}><Text>收藏支路 →</Text><Text>可带回 {scene.collectibleName}</Text></Button></View> : null}
        {state.phase === 'rest' && inRound ? <View className='pet-adventure__rest'><Text>这一段走完了</Text><Text>{collectibleOwned ? `背包里多了：${scene.collectibleName}` : '下次也可以回来探索收藏支路'}</Text><Button id='adventure-continue' className='pet-adventure__button pet-adventure__primary' disabled={!playing} onClick={() => dispatch({ type: 'continue' })}>去下一处看看 →</Button></View> : null}
        {!inRound ? <View className='pet-adventure__world-caption'><Text>{pet?.name || '你的伙伴'}，准备出发</Text><Text>选路 · 看机关 · 收集 · 回到路标继续</Text></View> : null}
      </View>

      {inRound ? <>
        <View key={state.feedback.sequence} className={`pet-adventure__feedback is-${state.feedback.kind}`}><Text>{state.feedback.message}</Text></View>
        <Text className='pet-adventure__mechanism-hint'>{hint}</Text>
        <View className='pet-adventure__controls'><Button id='adventure-left' className='pet-adventure__button pet-adventure__direction' disabled={!manualEnabled || state.x <= state.checkpointX} onClick={() => dispatch({ type: 'move-backward' })}>←<Text>后退</Text></Button><Button id='adventure-right' className='pet-adventure__button pet-adventure__direction' disabled={!manualEnabled} onClick={() => dispatch({ type: 'move-forward' })}>→<Text>前进</Text></Button><Button id='adventure-jump' className='pet-adventure__button pet-adventure__jump' disabled={!playing || state.jumpRemainingMs > 0 || state.phase === 'fork' || state.phase === 'rest'} onClick={() => dispatch({ type: 'jump' })}>跳跃</Button><Button id='adventure-interact' className='pet-adventure__button pet-adventure__interact' disabled={!manualEnabled || scene.mechanism !== 'box' || mechanism.gateOpen} onClick={() => dispatch({ type: 'interact' })}>{actionText}</Button></View>
        <View className='pet-adventure__sub-controls'><Button id='adventure-dash' className='pet-adventure__button pet-adventure__dash' disabled={!playing || state.dashCooldownMs > 0 || state.phase === 'fork' || state.phase === 'rest'} onClick={() => dispatch({ type: 'dash' })}>{state.dashCooldownMs > 0 ? `冲刺冷却 ${Math.ceil(state.dashCooldownMs / 1000)}秒` : '短冲刺 · 4秒冷却'}</Button>{state.recoveries >= 3 && !state.assisted ? <Button id='adventure-assist' className='pet-adventure__button pet-adventure__assist' disabled={!playing} onClick={() => dispatch({ type: 'assist' })}>开启慢速提示</Button> : <Text>{state.assisted ? '慢速提示 · 保留首通故事' : `背包 ${state.collectedLandmarks.length}件 · 不因失误丢失`}</Text>}</View>
      </> : <>
        <View className='pet-adventure__scene-preview'>{level.scenes.map((item, index) => <View key={item.id}><Text>0{index + 1} · {item.name}</Text><Text>{item.collectibleName}</Text></View>)}</View>
        <View className='pet-adventure__ready-meta'><Text>约90秒 · 三个短场景</Text><Text>服饰不改变能力</Text></View>
        {board || scarf ? <Text className='pet-adventure__outfit'>{board ? '叶纹滑板收藏已装备' : ''}{scarf ? ' · 探险围巾随伙伴穿戴' : ''}</Text> : null}
        <Button id='adventure-start' className='pet-adventure__button pet-adventure__primary' disabled={!active || !pet || !accountId} onClick={start}>和{pet?.name || '伙伴'}出发</Button>
        <Button id='adventure-tutorial' className='pet-adventure__button pet-adventure__help' onClick={() => setTutorial(true)}>第一次探险？看看怎么玩</Button>
      </>}
    </>}

    {state.status === 'paused' && !guideVisible ? <View className='pet-adventure__mask'><View className='pet-adventure__dialog'><Text className='pet-adventure__dialog-title'>在湖边歇一会儿</Text><Text className='pet-adventure__dialog-caption'>旅途已暂停，回来后从这里继续。</Text><Button id='adventure-resume' className='pet-adventure__button pet-adventure__primary' disabled={!active} onClick={() => dispatch({ type: 'resume' })}>继续探险</Button><Button className='pet-adventure__button pet-adventure__secondary' disabled={!active} onClick={reset}>重新准备</Button><Button id='adventure-help' className='pet-adventure__button pet-adventure__help' onClick={() => setGuideVisible(true)}>看看怎么玩</Button><Button id='adventure-exit' className='pet-adventure__button pet-adventure__help' disabled={!active} onClick={onExit}>回到成长小屋</Button></View></View> : null}
    {tutorial || guideVisible ? <View className='pet-adventure__mask'><View className='pet-adventure__dialog'><Text className='pet-adventure__dialog-title'>到下一处看看</Text><Text className='pet-adventure__dialog-caption'>普通段自动前进，到路口先选路线。机关处用前后按钮移动，靠近跳点再起跳；风旗、轻箱、落点各有自己的判断。</Text><Text className='pet-adventure__dialog-caption'>短冲刺四秒冷却，不能穿过岩石。失误回最近路标、扣两秒与连击，收藏会保留；三次失误后可开启慢速提示继续故事。</Text><Text className='pet-adventure__dialog-caption'>角色只播放这套形象已有的动作；跳跃位置和碰撞由游戏规则判断。</Text><Button id='adventure-tutorial-done' className='pet-adventure__button pet-adventure__primary' onClick={() => { setTutorial(false); setGuideVisible(false) }}>{guideVisible ? '明白了' : '准备好了'}</Button></View></View> : null}
  </View>
}
