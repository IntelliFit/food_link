import { Button, Image, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { PetActor } from '../../components/PetActor'
import type { PetProfile } from '../../utils/api'
import {
  KITCHEN_INGREDIENTS, KITCHEN_LEVELS, KITCHEN_RECIPES,
  advanceKitchenGame, applyKitchenAction, createKitchenGame,
  type KitchenAction, type KitchenGameState, type KitchenResult,
} from '../../utils/pet-kitchen-game'
import './PetKitchenGame.scss'

interface PetKitchenGameProps {
  active: boolean
  pet?: PetProfile | null
  accountId?: string
  onExit: () => void
  onFinished?: (result: KitchenResult, roundId: string, sessionAccountId: string) => void | Promise<void>
  settlementText?: string
  onRetrySettlement?: () => void | Promise<void>
}
type LocalBest = Record<string, { score: number; stars: number; served: number }>
const BEST_PREFIX = 'pet_kitchen_best_v1:'
const recipeById = (id: string) => KITCHEN_RECIPES.find(recipe => recipe.id === id)
const ingredientById = (id: string) => KITCHEN_INGREDIENTS.find(ingredient => ingredient.id === id)
const KitchenActor = memo(PetActor)

function readBest(accountId?: string, strict = false): LocalBest {
  if (!accountId) return {}
  try {
    const stored = Taro.getStorageSync(`${BEST_PREFIX}${accountId}`)
    if (stored?.version !== 1 || !stored.levels || typeof stored.levels !== 'object') {
      if (strict && stored !== undefined && stored !== null && stored !== '') throw new Error('无法读取原游戏成绩')
      return {}
    }
    return Object.fromEntries(Object.entries(stored.levels).filter(([key, value]) => {
      const best = value as LocalBest[string]
      return KITCHEN_LEVELS.some(level => String(level.id) === key) && Number.isFinite(best?.score)
        && best.score >= 0 && Number.isInteger(best.stars) && best.stars >= 0 && best.stars <= 3 && Number.isFinite(best.served) && best.served >= 0
    })) as LocalBest
  } catch (cause) { if (strict) throw cause; return {} }
}

/** V1 scores belong to the account, not an identifiable pet. Keep that source read-only. */
function readAccountHistory(scope?: string): LocalBest {
  if (!scope) return {}
  try {
    const account = String(Taro.getStorageSync('user_id') || '').trim()
    return account && scope.startsWith(`${account}:`) ? readBest(account) : {}
  } catch { return {} }
}

function kitchenActorSize() {
  try { return Math.round((Taro.getWindowInfo().windowWidth || 375) * 180 / 750) } catch { return 90 }
}
export function PetKitchenGame({ active, pet, accountId, onExit, onFinished, settlementText, onRetrySettlement }: PetKitchenGameProps) {
  const [state, setState] = useState<KitchenGameState>(() => createKitchenGame(1, 'tap'))
  const [levelId, setLevelId] = useState(1)
  const [bests, setBests] = useState<LocalBest>(() => readBest(accountId))
  const [accountHistory, setAccountHistory] = useState<LocalBest>(() => readAccountHistory(accountId))
  const [tutorial, setTutorial] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<number | null>(null)
  const [recipeBook, setRecipeBook] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const [menuSelection, setMenuSelection] = useState<string[]>(['egg-rice', 'veggie-rice', 'mushroom-egg'])
  const [settling, setSettling] = useState(false)
  const [settlementError, setSettlementError] = useState(false)
  const [actorSize] = useState(kitchenActorSize)
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const roundRef = useRef(0)
  const lastTick = useRef(0)
  const recordedResult = useRef<KitchenGameState['result']>(null)
  const finishedNotified = useRef<KitchenResult | null>(null)
  const mountedRef = useRef(true)
  const accountRef = useRef(accountId)
  const callbackRef = useRef(onFinished)
  const sessionRef = useRef<{ id: string; scope: string; callback: PetKitchenGameProps['onFinished'] } | null>(null)
  stateRef.current = state
  activeRef.current = active
  accountRef.current = accountId
  callbackRef.current = onFinished
  const level = KITCHEN_LEVELS.find(item => item.id === levelId) || KITCHEN_LEVELS[0]
  const liveOrders = state.orders.filter(order => order.status === 'waiting')
  const playing = state.status === 'running'
  const levelRecipes = KITCHEN_RECIPES.filter(recipe => state.menuIds.includes(recipe.id))
  const dispatch = useCallback((action: KitchenAction) => {
    if (!activeRef.current && action.type !== 'pause') return
    setState(previous => applyKitchenAction(previous, action))
  }, [])

  useEffect(() => {
    roundRef.current += 1
    recordedResult.current = stateRef.current.result
    setBests(readBest(accountId))
    setAccountHistory(readAccountHistory(accountId))
    setLevelId(1)
    setState(createKitchenGame(1, 'tap'))
    setTutorial(false)
    setTutorialStep(null)
    setRecipeBook(false)
    sessionRef.current = null
    finishedNotified.current = null
    setSettling(false)
    setSettlementError(false)
  }, [accountId])
  useEffect(() => {
    if (!active) {
      dispatch({ type: 'pause' })
    }
  }, [active, dispatch])
  useEffect(() => {
    mountedRef.current = true
    return () => { activeRef.current = false; mountedRef.current = false; roundRef.current += 1; sessionRef.current = null }
  }, [])
  useEffect(() => {
    if (!active || state.status !== 'running') return undefined
    lastTick.current = Date.now()
    const round = roundRef.current
    const timer = setInterval(() => {
      if (!activeRef.current || roundRef.current !== round) return
      const now = Date.now()
      const delta = Math.max(0, now - lastTick.current)
      lastTick.current = now
      setState(previous => advanceKitchenGame(previous, delta))
    }, 100)
    return () => clearInterval(timer)
  }, [active, state.status])
  useEffect(() => {
    if (!state.result || recordedResult.current === state.result || !accountId) return
    recordedResult.current = state.result
    const result = state.result
    try {
      // A temporary read error is not an empty record; never overwrite an unreadable best.
      const old = readBest(accountId, true)
      const best = old[String(levelId)]
      const next = { ...old, [String(levelId)]: { score: Math.max(best?.score || 0, result.score), stars: Math.max(best?.stars || 0, result.stars), served: Math.max(best?.served || 0, result.served) } }
      Taro.setStorageSync(`${BEST_PREFIX}${accountId}`, { version: 1, levels: next })
      setBests(next)
    } catch { /* A full local cache does not interrupt the completed game. */ }
  }, [accountId, levelId, state.result])
  useEffect(() => {
    const result = state.result
    const session = sessionRef.current
    if (!active || !result || finishedNotified.current === result || !session || session.scope !== accountId) return
    finishedNotified.current = result
    if (!session.callback) return
    setSettling(true)
    setSettlementError(false)
    Promise.resolve().then(() => {
      if (!mountedRef.current || sessionRef.current !== session || accountRef.current !== session.scope) return
      if (!activeRef.current) { finishedNotified.current = null; return }
      return session.callback?.(result, session.id, session.scope)
    }).then(() => {
      if (mountedRef.current && sessionRef.current === session) { setSettling(false); setSettlementError(false) }
    }).catch(() => {
      if (mountedRef.current && sessionRef.current === session) { setSettling(false); setSettlementError(true) }
    })
  }, [active, accountId, state.result])

  const start = (id: number, guided = false) => {
    if (!active) return
    if (id === 6 && menuSelection.length !== 3) return
    roundRef.current += 1
    setLevelId(id)
    setTutorial(guided)
    setShowGuide(true)
    setRecipeBook(false)
    setTutorialStep(null)
    recordedResult.current = null
    finishedNotified.current = null
    setSettling(false)
    setSettlementError(false)
    sessionRef.current = accountId ? { id: `kitchen:${Date.now()}:${roundRef.current}:${Math.random().toString(36).slice(2, 8)}`, scope: accountId, callback: callbackRef.current } : null
    let next = createKitchenGame(id, 'tap')
    if (id === 6) next = applyKitchenAction(next, { type: 'set-menu', recipeIds: menuSelection })
    setState(applyKitchenAction(next, { type: 'start' }))
  }
  const chooseLevel = (id: number) => {
    roundRef.current += 1; setLevelId(id); setTutorial(false)
    let next = createKitchenGame(id, 'tap')
    if (id === 6 && menuSelection.length === 3) next = applyKitchenAction(next, { type: 'set-menu', recipeIds: menuSelection })
    setState(next)
  }
  const backToMenu = () => { roundRef.current += 1; setState(createKitchenGame(levelId, 'tap')); setTutorial(false); setTutorialStep(null); setRecipeBook(false) }
  const selectMenu = (recipeId: string) => {
    const next = menuSelection.includes(recipeId) ? menuSelection.filter(id => id !== recipeId) : [...menuSelection, recipeId]
    if (next.length > 3 || new Set(next.flatMap(id => recipeById(id)?.ingredients || [])).size > 6) return
    setMenuSelection(next)
    if (next.length === 3) setState(previous => applyKitchenAction(previous, { type: 'set-menu', recipeIds: next }))
  }
  const retrySettlement = () => {
    const session = sessionRef.current
    if (!activeRef.current || !session || session.scope !== accountRef.current || (!onRetrySettlement && (!session.callback || !stateRef.current.result))) return
    setSettling(true)
    setSettlementError(false)
    Promise.resolve().then(() => onRetrySettlement ? onRetrySettlement() : session.callback?.(stateRef.current.result!, session.id, session.scope)).then(() => {
      if (mountedRef.current && sessionRef.current === session) { setSettling(false); setSettlementError(false) }
    }).catch(() => {
      if (mountedRef.current && sessionRef.current === session) { setSettling(false); setSettlementError(true) }
    })
  }
  const cook = state.stations.cook.job
  const cookingRecipe = cook ? recipeById(cook.recipeId) : undefined
  const prepBusy = state.stations.prep.job?.stage === 'working'
  const prepCount = state.bufferedPrep.length + (state.stations.prep.job ? 1 : 0)
  const canLift = playing && cook && cook.stage !== 'burnt' && cook.progress >= .65 && !state.stations.plate.job
  const guideText = cook?.stage === 'burnt' ? '点“清锅重做”，两秒后就能重新开做。'
    : cook ? '亮区起锅最稳；同时可以点下一张订单，让伙伴提前配菜。'
      : prepCount ? '伙伴配菜后会自动入锅，留意这里的火候条。' : '点一张订单开做，其他工序由伙伴帮忙。'

  const inRound = state.status === 'running' || state.status === 'paused'
  return <View className={`pet-kitchen ${playing ? 'is-playing' : ''} ${inRound ? 'is-round' : ''}`}>
    <View className='pet-kitchen__header'>
      <Button id='kitchen-back' disabled={settling || Boolean(onRetrySettlement) || settlementError} className='pet-kitchen__button pet-kitchen__back' onClick={() => playing || state.status === 'paused' ? dispatch({ type: 'pause' }) : onExit()} aria-label={playing || state.status === 'paused' ? '暂停并查看离开选项' : '返回宠物时光'}>‹</Button>
      <View className='pet-kitchen__header-copy'><Text className='pet-kitchen__eyebrow'>湖畔小厨房</Text><Text className='pet-kitchen__title'>宠物餐车</Text></View>
      {state.status === 'running' ? <Button id='kitchen-pause' className='pet-kitchen__button pet-kitchen__utility' onClick={() => dispatch({ type: 'pause' })}>暂停</Button> : null}
    </View>

    {state.status === 'ready' ? <>
      <View className='pet-kitchen__scene is-welcome'><Image className='pet-kitchen__scene-art' src='/packagePetStudio/assets/kitchen-scene-v1.jpg' mode='aspectFill' /><View className='pet-kitchen__scene-actor'>{pet ? <KitchenActor pet={pet} size={actorSize} action='wave' active={active} /> : null}</View><View className='pet-kitchen__scene-caption'><Text>把一餐做好，把快乐递过去</Text><Text>90秒 · 点单开做 · 看准火候起锅</Text></View></View>
      <View className='pet-kitchen__section-heading'><Text>今日餐车地图</Text><Button className='pet-kitchen__button' id='kitchen-tutorial' onClick={() => setTutorialStep(0)}>新手教学 ›</Button></View>
      <View className='pet-kitchen__levels'>{KITCHEN_LEVELS.map(item => <Button id={`kitchen-level-${item.id}`} key={item.id} className={`pet-kitchen__button pet-kitchen__level ${item.id === levelId ? 'is-selected' : ''}`} onClick={() => chooseLevel(item.id)}><View className='pet-kitchen__level-top'><Text className='pet-kitchen__level-number'>0{item.id}</Text><Text className='pet-kitchen__stars'>{bests[String(item.id)] ? '★'.repeat(bests[String(item.id)].stars) + '☆'.repeat(3 - bests[String(item.id)].stars) : '☆☆☆'}</Text></View><Text className='pet-kitchen__level-name'>{item.name}</Text><Text className='pet-kitchen__level-description'>{item.description}</Text><Text className='pet-kitchen__level-record'>{bests[String(item.id)] ? `最佳 ${bests[String(item.id)].score}分` : `${item.targetServed}份餐食 · ${item.targetScore}分目标`}</Text></Button>)}</View>
      {accountHistory[String(levelId)] && <View id='kitchen-account-history' className='pet-kitchen__story'><Text>账号历史最好（参考） · {Math.max(accountHistory[String(levelId)].score, bests[String(levelId)]?.score || 0)}分</Text><Text>旧成绩属于账号，不计作当前伙伴的新纪录、成长或奖励。</Text></View>}
      <View className='pet-kitchen__menu'><View className='pet-kitchen__section-heading'><Text>本关菜单 · {levelRecipes.length}份配方</Text><Button className='pet-kitchen__button' id='kitchen-recipe-book' onClick={() => setRecipeBook(true)}>全部配方 ›</Button></View><View className='pet-kitchen__menu-items'>{levelRecipes.map(recipe => <View key={recipe.id}><Text>{recipe.ingredients.map(id => ingredientById(id)?.emoji || '').join('')}</Text><Text>{recipe.name}</Text></View>)}</View></View>
      <View className='pet-kitchen__story'><Text>{level.story}</Text><Text>本关纪念：{level.collectibleName}</Text></View>
      {level.mechanic === 'banquet' ? <View className='pet-kitchen__banquet'><Text>为宴会选三道菜 · 共用六种以内食材</Text><View className='pet-kitchen__banquet-options'>{KITCHEN_RECIPES.map(recipe => {
        const selected = menuSelection.includes(recipe.id)
        const incompatible = !selected && (menuSelection.length >= 3 || new Set([...menuSelection, recipe.id].flatMap(id => recipeById(id)?.ingredients || [])).size > 6)
        return <Button id={`kitchen-menu-${recipe.id}`} key={recipe.id} className={`pet-kitchen__button pet-kitchen__menu-option ${selected ? 'is-selected' : ''}`} disabled={incompatible} onClick={() => selectMenu(recipe.id)}>{selected ? '✓ ' : ''}{recipe.name}</Button>
      })}</View><Text>已选 {menuSelection.length}/3 · 先取消一项可换菜</Text></View> : null}
      <Button id='kitchen-start' className='pet-kitchen__button pet-kitchen__primary' disabled={!active || (level.mechanic === 'banquet' && menuSelection.length !== 3)} onClick={() => start(levelId)}>开张营业 · {level.name}</Button>
      <Text className='pet-kitchen__footnote'>游戏菜谱 · 本机成绩 · 收藏按真实结算保存</Text>
    </> : state.status === 'finished' && state.result ? <View className='pet-kitchen__result'>
      <Text className='pet-kitchen__result-kicker'>今日营业结束</Text><Text className='pet-kitchen__result-stars'>{'★'.repeat(state.result.stars)}{'☆'.repeat(3 - state.result.stars)}</Text><Text className='pet-kitchen__result-title'>{state.result.passed ? '这一餐，有你的用心' : '慢慢来，下次会更顺手'}</Text><Text className='pet-kitchen__result-score'>{state.result.score}<Text> 分</Text></Text>
      <View className='pet-kitchen__result-stats'><View><Text>{state.result.served}</Text><Text>送达餐食</Text></View><View><Text>{state.result.bestCombo}</Text><Text>最高连击</Text></View><View><Text>{state.result.missed}</Text><Text>错过订单</Text></View><View><Text>{state.result.wasted}</Text><Text>重新制作</Text></View></View>
      <View className='pet-kitchen__review'><Text>下一局的小诀窍</Text><Text>{state.result.advice}</Text><Text>基础目标：正确交付{state.result.targetServed}份 · 高分挑战{state.result.targetScore}分</Text>{state.result.passed ? <Text>本关纪念：{level.collectibleName} · {onFinished ? '以保存结果为准' : '待连接成长册'}</Text> : null}</View>
      {settling ? <View className='pet-kitchen__settlement-spinner' aria-label='正在保存本局成长' /> : <Text className='pet-kitchen__settlement'>{settlementText || (settlementError ? '本局暂未保存，请重试。' : '')}</Text>}
      {onRetrySettlement || settlementError ? <Button id='kitchen-retry-settlement' className='pet-kitchen__button pet-kitchen__secondary' disabled={settling} onClick={retrySettlement}>重新保存这份成长</Button> : null}
      <Button id='kitchen-retry' disabled={settling || Boolean(onRetrySettlement) || settlementError} className='pet-kitchen__button pet-kitchen__primary' onClick={() => start(levelId, tutorial)}>再开一局</Button>
      {state.result.passed && levelId < KITCHEN_LEVELS.length ? <Button id='kitchen-next' disabled={settling || Boolean(onRetrySettlement) || settlementError} className='pet-kitchen__button pet-kitchen__secondary' onClick={() => start(levelId + 1)}>前往下一站 ›</Button> : null}
      <Button disabled={settling || Boolean(onRetrySettlement) || settlementError} className='pet-kitchen__button pet-kitchen__text-button' onClick={backToMenu}>返回关卡地图</Button><Text className='pet-kitchen__footnote'>这是游戏成绩，不计入饮食或运动记录。</Text>
    </View> : <>
      <View className='pet-kitchen__hud'><View className={state.remainingMs <= 15000 ? 'is-urgent' : ''}><Text>{Math.ceil(state.remainingMs / 1000)}<Text>秒</Text></Text><Text>剩余时间</Text></View><View><Text>{state.score}<Text>分</Text></Text><Text>本局得分</Text></View><View><Text>{state.served}<Text>/{level.targetServed}</Text></Text><Text>送达目标</Text></View><View className='pet-kitchen__combo'><Text>×{state.combo}</Text><Text>当前连击</Text></View></View>
      <View className='pet-kitchen__section-heading pet-kitchen__orders-heading'><Text>顾客的期待</Text><Text className='pet-kitchen__muted'>{level.name}</Text></View>
      <ScrollView className='pet-kitchen__orders' scrollX showScrollbar={false}><View className='pet-kitchen__order-track'>{liveOrders.length ? liveOrders.map(order => {
        const recipe = recipeById(order.recipeId)
        const patience = Math.max(0, Math.min(100, (order.expiresAtMs - state.elapsedMs) / order.patienceMs * 100))
        const inStation = Object.values(state.stations).some(station => station.job?.orderId === order.id) || state.bufferedPrep.some(job => job.orderId === order.id)
        return <Button key={order.id} id={`kitchen-order-${order.id}`} className={`pet-kitchen__button pet-kitchen-drop pet-kitchen__order ${state.selectedOrderId === order.id ? 'is-selected' : ''} ${patience < 25 ? 'is-urgent' : ''}`} disabled={!playing || inStation || prepBusy || prepCount >= 2} onClick={() => dispatch({ type: 'take-order', orderId: order.id })}><View className='pet-kitchen__order-top'><Text>{order.customer}</Text><Text>{Math.ceil(Math.max(0, order.expiresAtMs - state.elapsedMs) / 1000)}秒</Text></View><Text className='pet-kitchen__order-name'>{recipe?.name}</Text><Text className='pet-kitchen__order-state'>{inStation ? '伙伴正在制作' : prepBusy ? '配菜后可接单' : prepCount >= 2 ? '等候空位' : '点一下 · 开做'}</Text><View className='pet-kitchen__patience'><View style={{ width: `${patience}%` }} /></View></Button>
      }) : <View className='pet-kitchen__order-empty'><Text>这一波都送到了</Text><Text>下一位顾客马上来</Text></View>}</View></ScrollView>
      <View className='pet-kitchen__scene is-round-scene'><Image className='pet-kitchen__scene-art' src='/packagePetStudio/assets/kitchen-scene-v1.jpg' mode='aspectFill' /><View className='pet-kitchen__scene-actor'>{pet ? <KitchenActor pet={pet} size={actorSize} active={active && playing} action={!playing ? 'idle' : state.feedback.kind === 'success' && !state.stations.cook.job ? 'celebrate' : state.stations.prep.job || state.stations.cook.job ? 'cook' : 'observe'} /> : null}</View><Text className='pet-kitchen__scene-level'>{level.name}</Text></View>
      <View key={state.feedback.sequence} className={`pet-kitchen__feedback is-${state.feedback.kind}`}><Text>{state.feedback.kind === 'success' ? '✓' : state.feedback.kind === 'warning' ? '!' : '·'}</Text><Text>{state.feedback.message}</Text></View>
      {tutorial && showGuide ? <View className='pet-kitchen__guide'><View><Text>边玩边学</Text><Button className='pet-kitchen__button' onClick={() => setShowGuide(false)}>收起</Button></View><Text>{guideText}</Text></View> : null}
      <View className='pet-kitchen__service-strip'>
        <View><Text>配菜</Text><Text>{prepCount ? `${prepCount}份${prepBusy ? '准备中' : '等入锅'}` : '点订单开做'}</Text></View>
        <Text className='pet-kitchen__service-arrow'>›</Text>
        <View className='is-current'><Text>看火候</Text><Text>{cook ? cookingRecipe?.cookLabel : state.cleaningMs ? '清锅中' : '等菜入锅'}</Text></View>
        <Text className='pet-kitchen__service-arrow'>›</Text>
        <View><Text>送餐</Text><Text>{state.stations.plate.job ? '伙伴装盘中' : '起锅后自动送达'}</Text></View>
      </View>
      <View id='kitchen-station-cook' className={`pet-kitchen__stove ${cook?.stage === 'burnt' ? 'is-burnt' : ''} ${cook && cook.progress >= 1 && cook.progress <= 1.2 ? 'is-perfect' : ''}`}>
        <View className='pet-kitchen__stove-heading'><View><Text className='pet-kitchen__stove-kicker'>这一锅，交给你</Text><Text className='pet-kitchen__stove-name'>{cookingRecipe?.name || (state.cleaningMs ? '收拾灶台' : '等一份好餐食')}</Text></View><Text className='pet-kitchen__pot' aria-hidden>{cook?.stage === 'burnt' ? '♨' : '🍲'}</Text></View>
        <View className='pet-kitchen__cook-meter'><View className='pet-kitchen__cook-track'><View className='pet-kitchen__cook-perfect' /><View className='pet-kitchen__cook-marker' style={{ left: `${cook ? Math.min(98, cook.progress / 1.55 * 100) : 0}%` }} /></View><View className='pet-kitchen__cook-labels'><Text>未熟</Text><Text>亮区 · 最佳起锅</Text><Text>烧焦</Text></View></View>
        {cook?.stage === 'burnt' ? <Button id='kitchen-discard-cook' className='pet-kitchen__button pet-kitchen__primary' disabled={!playing} onClick={() => dispatch({ type: 'discard', station: 'cook' })}>清锅重做</Button>
          : <Button id='kitchen-move-cook' className='pet-kitchen__button pet-kitchen__primary' disabled={!canLift} onClick={() => dispatch({ type: 'move', from: 'cook' })}>{!cook ? state.cleaningMs ? `清锅还剩${Math.ceil(state.cleaningMs / 1000)}秒` : '点上方订单，开始做菜' : state.stations.plate.job ? '伙伴送餐中，稍等片刻' : cook.progress < .65 ? '烹饪中，留意火候' : cook.progress < 1 ? '提前起锅 · 品质降低' : cook.progress <= 1.2 ? '起锅！火候正好' : '马上起锅 · 别烧焦'}</Button>}
        <Text className='pet-kitchen__stove-tip'>伙伴负责配菜和送餐，你来决定顺序与起锅时机。</Text>
      </View>
      <Button className='pet-kitchen__button pet-kitchen__text-button pet-kitchen__playing-help' onClick={() => { dispatch({ type: 'pause' }); setRecipeBook(true) }}>配方与操作说明</Button>
    </>}

    {state.status === 'paused' && !recipeBook ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__dialog'><Text className='pet-kitchen__dialog-title'>餐车歇一会儿</Text><Text className='pet-kitchen__muted'>时间、工序和顾客耐心都已暂停。</Text><Button id='kitchen-resume' disabled={!active} className='pet-kitchen__button pet-kitchen__primary' onClick={() => dispatch({ type: 'resume' })}>继续营业</Button><Button id='kitchen-restart' className='pet-kitchen__button pet-kitchen__secondary' onClick={() => start(levelId, tutorial)}>重新开始本关</Button><Button className='pet-kitchen__button pet-kitchen__text-button' onClick={backToMenu}>返回关卡地图</Button><Button className='pet-kitchen__button pet-kitchen__text-button' onClick={onExit}>离开餐车</Button></View></View> : null}
    {tutorialStep !== null ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__dialog'><Text className='pet-kitchen__dialog-kicker'>新手教学 · {tutorialStep + 1}/3</Text><Text className='pet-kitchen__tutorial-icon'>0{tutorialStep + 1}</Text><Text className='pet-kitchen__dialog-title'>{['点单开做', '看准火候', '连续出餐'][tutorialStep]}</Text><Text className='pet-kitchen__tutorial-copy'>{['点一下顾客的订单，伙伴自动配菜并送入空锅。你可以决定先照顾哪位顾客。', '火候条进入亮区时点“起锅”。太早会影响品质，太晚会烧焦；做菜时可以点下一单提前配菜。', '起锅后伙伴会自动装盘送餐，正确出餐获得分数与连击。顾客耐心越少，越需要优先照顾。'][tutorialStep]}</Text><Button id='kitchen-tutorial-next' className='pet-kitchen__button pet-kitchen__primary' onClick={() => tutorialStep < 2 ? setTutorialStep(tutorialStep + 1) : start(1, true)}>{tutorialStep < 2 ? '下一步' : '开始第一关 · 边玩边学'}</Button><Button className='pet-kitchen__button pet-kitchen__text-button' onClick={() => setTutorialStep(null)}>暂时跳过</Button></View></View> : null}
    {recipeBook ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__recipe-dialog'><View className='pet-kitchen__section-heading'><Text>餐车配方本 · 12份</Text><Button className='pet-kitchen__button' id='kitchen-close-recipes' onClick={() => setRecipeBook(false)}>关闭 ×</Button></View><ScrollView className='pet-kitchen__recipe-scroll' scrollY><View className='pet-kitchen__recipe-book'>{KITCHEN_RECIPES.map(recipe => <View key={recipe.id}><Text className='pet-kitchen__recipe-emoji'>{recipe.ingredients.map(id => ingredientById(id)?.emoji).join('')}</Text><View><Text>{recipe.name}</Text><Text>{recipe.ingredients.map(id => ingredientById(id)?.name).join(' ＋ ')}</Text><Text>{recipe.prepLabel} → {recipe.cookLabel} → 装盘</Text></View></View>)}</View><Text className='pet-kitchen__recipe-instructions'>点订单开做 → 亮区起锅。伙伴自动配菜、入锅和送餐。优先照顾耐心少的顾客，灶台忙时提前准备下一单，连续送达可获得连击。</Text></ScrollView></View></View> : null}
  </View>
}
