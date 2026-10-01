import { Button, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PetIdentityAvatar } from '../../components/PetIdentityAvatar'
import type { PetProfile } from '../../utils/api'
import {
  KITCHEN_INGREDIENTS, KITCHEN_LEVELS, KITCHEN_RECIPES,
  advanceKitchenGame, applyKitchenAction, createKitchenGame,
  type KitchenAction, type KitchenGameState,
} from '../../utils/pet-kitchen-game'
import './PetKitchenGame.scss'

interface PetKitchenGameProps {
  active: boolean
  pet?: PetProfile | null
  accountId?: string
  onExit: () => void
}
type StationId = 'prep' | 'cook' | 'plate'
type LocalBest = Record<string, { score: number; stars: number; served: number }>
type TouchLike = { touches?: { clientX: number; clientY: number }[]; changedTouches?: { clientX: number; clientY: number }[]; stopPropagation?: () => void; preventDefault?: () => void }
type Drag = { kind: 'ingredient'; ingredientId: string; x: number; y: number; startX: number; startY: number; moved: boolean }
  | { kind: 'dish'; station: StationId; x: number; y: number; startX: number; startY: number; moved: boolean }
type DropRect = { id: string; left: number; right: number; top: number; bottom: number }
const BEST_PREFIX = 'pet_kitchen_best_v1:'
const recipeById = (id: string) => KITCHEN_RECIPES.find(recipe => recipe.id === id)
const ingredientById = (id: string) => KITCHEN_INGREDIENTS.find(ingredient => ingredient.id === id)
const stationLabels: Record<StationId, string> = { prep: '备餐台', cook: '灶台', plate: '装盘台' }

function readBest(accountId?: string): LocalBest {
  if (!accountId) return {}
  try {
    const stored = Taro.getStorageSync(`${BEST_PREFIX}${accountId}`)
    if (stored?.version !== 1 || !stored.levels || typeof stored.levels !== 'object') return {}
    return Object.fromEntries(Object.entries(stored.levels).filter(([key, value]) => {
      const best = value as LocalBest[string]
      return KITCHEN_LEVELS.some(level => String(level.id) === key) && Number.isFinite(best?.score)
        && best.score >= 0 && Number.isInteger(best.stars) && best.stars >= 0 && best.stars <= 3 && Number.isFinite(best.served)
    })) as LocalBest
  } catch { return {} }
}

export function PetKitchenGame({ active, pet, accountId, onExit }: PetKitchenGameProps) {
  const [state, setState] = useState<KitchenGameState>(() => createKitchenGame(1))
  const [levelId, setLevelId] = useState(1)
  const [bests, setBests] = useState<LocalBest>(() => readBest(accountId))
  const [tutorial, setTutorial] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<number | null>(null)
  const [recipeBook, setRecipeBook] = useState(false)
  const [showGuide, setShowGuide] = useState(true)
  const [dragging, setDragging] = useState<Drag | null>(null)
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const roundRef = useRef(0)
  const lastTick = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  const suppressClickUntil = useRef(0)
  const recordedResult = useRef<KitchenGameState['result']>(null)
  stateRef.current = state
  activeRef.current = active
  const level = KITCHEN_LEVELS.find(item => item.id === levelId) || KITCHEN_LEVELS[0]
  const selectedOrder = state.orders.find(order => order.id === state.selectedOrderId && order.status === 'waiting')
  const selectedRecipe = selectedOrder ? recipeById(selectedOrder.recipeId) : undefined
  const liveOrders = state.orders.filter(order => order.status === 'waiting')
  const playing = state.status === 'running'
  const levelRecipes = KITCHEN_RECIPES.filter(recipe => level.recipeIds.includes(recipe.id))
  const availableIngredients = KITCHEN_INGREDIENTS.filter(ingredient => levelRecipes.some(recipe => recipe.ingredients.includes(ingredient.id)))
  const dispatch = useCallback((action: KitchenAction) => {
    if (!active && action.type !== 'pause') return
    setState(previous => applyKitchenAction(previous, action))
  }, [active])

  useEffect(() => {
    roundRef.current += 1
    recordedResult.current = stateRef.current.result
    setBests(readBest(accountId))
    setLevelId(1)
    setState(createKitchenGame(1))
    setTutorial(false)
    setTutorialStep(null)
    setRecipeBook(false)
    dragRef.current = null
    setDragging(null)
  }, [accountId])
  useEffect(() => {
    if (!active) {
      dispatch({ type: 'pause' })
      dragRef.current = null
      setDragging(null)
    }
  }, [active, dispatch])
  useEffect(() => () => { activeRef.current = false; roundRef.current += 1 }, [])
  useEffect(() => {
    if (!active || state.status !== 'running') return undefined
    lastTick.current = Date.now()
    const timer = setInterval(() => {
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
    const old = readBest(accountId)
    const best = old[String(levelId)]
    const next = { ...old, [String(levelId)]: { score: Math.max(best?.score || 0, result.score), stars: Math.max(best?.stars || 0, result.stars), served: Math.max(best?.served || 0, result.served) } }
    try {
      Taro.setStorageSync(`${BEST_PREFIX}${accountId}`, { version: 1, levels: next })
      setBests(next)
    } catch { /* A full local cache does not interrupt the completed game. */ }
  }, [accountId, levelId, state.result])

  const start = (id: number, guided = false) => {
    if (!active) return
    roundRef.current += 1
    setLevelId(id)
    setTutorial(guided)
    setShowGuide(true)
    setRecipeBook(false)
    setTutorialStep(null)
    recordedResult.current = null
    setState(applyKitchenAction(createKitchenGame(id), { type: 'start' }))
  }
  const chooseLevel = (id: number) => { roundRef.current += 1; setLevelId(id); setState(createKitchenGame(id)); setTutorial(false) }
  const backToMenu = () => { roundRef.current += 1; setState(createKitchenGame(levelId)); setTutorial(false); setTutorialStep(null); setRecipeBook(false) }
  const safeClick = (action: KitchenAction) => { if (Date.now() >= suppressClickUntil.current) dispatch(action) }
  const beginDrag = (payload: { ingredientId: string } | { station: StationId }, event: unknown) => {
    const touch = (event as TouchLike).touches?.[0]
    if (!touch || !playing || !active) return
    dragRef.current = 'ingredientId' in payload ? { kind: 'ingredient', ...payload, x: touch.clientX, y: touch.clientY, startX: touch.clientX, startY: touch.clientY, moved: false }
      : { kind: 'dish', ...payload, x: touch.clientX, y: touch.clientY, startX: touch.clientX, startY: touch.clientY, moved: false }
  }
  const moveDrag = (event: unknown) => {
    const touchEvent = event as TouchLike
    const touch = touchEvent.touches?.[0]
    const previous = dragRef.current
    if (!touch || !previous) return
    const moved = previous.moved || Math.abs(touch.clientX - previous.startX) + Math.abs(touch.clientY - previous.startY) > 12
    const next = { ...previous, x: touch.clientX, y: touch.clientY, moved }
    dragRef.current = next
    if (moved) {
      touchEvent.stopPropagation?.()
      touchEvent.preventDefault?.()
      setDragging(next)
    }
  }
  const endDrag = (event: unknown) => {
    const drag = dragRef.current
    const touch = (event as TouchLike).changedTouches?.[0]
    dragRef.current = null
    setDragging(null)
    if (!drag?.moved || !touch || !active || stateRef.current.status !== 'running') return
    suppressClickUntil.current = Date.now() + 350
    const releasedX = touch.clientX
    const releasedY = touch.clientY
    const round = roundRef.current
    try {
      // Sticky worktops and scrolling orders can move during the gesture, so
      // resolve the target against its current viewport rectangle at release.
      Taro.createSelectorQuery().selectAll('.pet-kitchen-drop').boundingClientRect(rectangles => {
        if (!activeRef.current || stateRef.current.status !== 'running' || round !== roundRef.current) return
        const currentRects = Array.isArray(rectangles) ? rectangles as unknown as DropRect[] : []
        const target = currentRects.find(rect => releasedX >= rect.left && releasedX <= rect.right && releasedY >= rect.top && releasedY <= rect.bottom)
        if (!target) return
        if (drag.kind === 'ingredient' && target.id === 'kitchen-station-prep') {
          if (!stateRef.current.selectedIngredients.includes(drag.ingredientId)) dispatch({ type: 'toggle-ingredient', ingredientId: drag.ingredientId })
        } else if (drag.kind === 'dish') {
          if (drag.station === 'prep' && target.id === 'kitchen-station-cook') dispatch({ type: 'move', from: 'prep' })
          else if (drag.station === 'cook' && target.id === 'kitchen-station-plate') dispatch({ type: 'move', from: 'cook' })
          else if (drag.station === 'plate' && target.id.startsWith('kitchen-order-')) dispatch({ type: 'serve', orderId: target.id.replace('kitchen-order-', '') })
        }
      }).exec()
    } catch { /* Tap controls remain available when a selector query is unavailable. */ }
  }
  const cancelDrag = () => { dragRef.current = null; setDragging(null) }
  const guideText = !selectedOrder ? '先点一张订单，看清需要的食材。'
    : !state.stations.prep.job && !state.stations.cook.job && !state.stations.plate.job ? '点选所需食材，再点“开始备餐”。多选的食材可再点一次取消。'
      : state.stations.prep.job?.stage === 'ready' ? '备餐完成！送往灶台，然后可以接着做另一份订单。'
        : state.stations.cook.job ? '观察火候，进度进入绿色区再出锅。火太大或等太久会影响品质。'
          : state.stations.plate.job?.stage === 'ready' ? '装盘完成！点“递给顾客”，或拖到对应订单。'
            : '三个工位可以同时工作，优先照顾耐心快耗尽的顾客。'

  const inRound = state.status === 'running' || state.status === 'paused'
  return <View className={`pet-kitchen ${playing ? 'is-playing' : ''} ${inRound ? 'is-round' : ''}`}>
    <View className='pet-kitchen__header'>
      <Button id='kitchen-back' className='pet-kitchen__back' onClick={() => playing || state.status === 'paused' ? dispatch({ type: 'pause' }) : onExit()} aria-label={playing || state.status === 'paused' ? '暂停并查看离开选项' : '返回宠物时光'}>‹</Button>
      <View className='pet-kitchen__header-copy'><Text className='pet-kitchen__eyebrow'>湖畔小厨房</Text><Text className='pet-kitchen__title'>宠物餐车</Text></View>
      {pet ? <View className='pet-kitchen__host'><PetIdentityAvatar pet={pet} size={inRound ? 32 : 56} motion='static' /></View> : null}
      {state.status === 'running' ? <Button id='kitchen-pause' className='pet-kitchen__utility' onClick={() => dispatch({ type: 'pause' })}>暂停</Button> : null}
    </View>

    {state.status === 'ready' ? <>
      <View className='pet-kitchen__welcome'><View className='pet-kitchen__awning' /><Text className='pet-kitchen__welcome-title'>把一餐做好，把快乐递过去</Text><Text className='pet-kitchen__muted'>接订单 · 备食材 · 控火候 · 连击出餐</Text><View className='pet-kitchen__welcome-food'><Text>🥬</Text><Text>🍳</Text><Text>🍚</Text><Text>🥕</Text></View><View className='pet-kitchen__welcome-meta'><Text>90秒一局</Text><Text>三个工位同时开工</Text><Text>服饰不加战力</Text></View></View>
      <View className='pet-kitchen__section-heading'><Text>今日餐车地图</Text><Button id='kitchen-tutorial' onClick={() => setTutorialStep(0)}>新手教学 ›</Button></View>
      <View className='pet-kitchen__levels'>{KITCHEN_LEVELS.map(item => <Button id={`kitchen-level-${item.id}`} key={item.id} className={`pet-kitchen__level ${item.id === levelId ? 'is-selected' : ''}`} onClick={() => chooseLevel(item.id)}><View className='pet-kitchen__level-top'><Text className='pet-kitchen__level-number'>0{item.id}</Text><Text className='pet-kitchen__stars'>{bests[String(item.id)] ? '★'.repeat(bests[String(item.id)].stars) + '☆'.repeat(3 - bests[String(item.id)].stars) : '☆☆☆'}</Text></View><Text className='pet-kitchen__level-name'>{item.name}</Text><Text className='pet-kitchen__level-description'>{item.description}</Text><Text className='pet-kitchen__level-record'>{bests[String(item.id)] ? `最佳 ${bests[String(item.id)].score}分` : `${item.targetServed}份餐食 · ${item.targetScore}分目标`}</Text></Button>)}</View>
      <View className='pet-kitchen__menu'><View className='pet-kitchen__section-heading'><Text>本关菜单 · {levelRecipes.length}份配方</Text><Button id='kitchen-recipe-book' onClick={() => setRecipeBook(true)}>全部配方 ›</Button></View><View className='pet-kitchen__menu-items'>{levelRecipes.map(recipe => <View key={recipe.id}><Text>{recipe.ingredients.map(id => ingredientById(id)?.emoji || '').join('')}</Text><Text>{recipe.name}</Text></View>)}</View></View>
      <Button id='kitchen-start' className='pet-kitchen__primary' onClick={() => start(levelId)}>开张营业 · {level.name}</Button>
      <Text className='pet-kitchen__footnote'>单人闯关 · 成绩保存在本机 · 不发放代币</Text>
    </> : state.status === 'finished' && state.result ? <View className='pet-kitchen__result'>
      <Text className='pet-kitchen__result-kicker'>今日营业结束</Text><Text className='pet-kitchen__result-stars'>{'★'.repeat(state.result.stars)}{'☆'.repeat(3 - state.result.stars)}</Text><Text className='pet-kitchen__result-title'>{state.result.passed ? '这一餐，有你的用心' : '慢慢来，下次会更顺手'}</Text><Text className='pet-kitchen__result-score'>{state.result.score}<Text> 分</Text></Text>
      <View className='pet-kitchen__result-stats'><View><Text>{state.result.served}</Text><Text>送达餐食</Text></View><View><Text>{state.result.bestCombo}</Text><Text>最高连击</Text></View><View><Text>{state.result.missed}</Text><Text>错过订单</Text></View><View><Text>{state.result.wasted}</Text><Text>重新制作</Text></View></View>
      <View className='pet-kitchen__review'><Text>下一局的小诀窍</Text><Text>{state.result.wasted > 0 ? '绿色火候区出锅更稳妥，别让熟食在灶台等太久。' : state.result.missed > 0 ? '先看耐心条，备餐、烹饪、装盘同时进行会更从容。' : '试试一边控火，一边给下一张订单备餐，争取更长连击。'}</Text><Text>本关目标：{state.result.targetServed}份餐食与{state.result.targetScore}分</Text></View>
      <Button id='kitchen-retry' className='pet-kitchen__primary' onClick={() => start(levelId, tutorial)}>再开一局</Button>
      {state.result.passed && levelId < KITCHEN_LEVELS.length ? <Button id='kitchen-next' className='pet-kitchen__secondary' onClick={() => start(levelId + 1)}>前往下一站 ›</Button> : null}
      <Button className='pet-kitchen__text-button' onClick={backToMenu}>返回关卡地图</Button><Text className='pet-kitchen__footnote'>这是游戏成绩，不计入饮食或运动记录。</Text>
    </View> : <>
      <View className='pet-kitchen__hud'><View className={state.remainingMs <= 15000 ? 'is-urgent' : ''}><Text>{Math.ceil(state.remainingMs / 1000)}<Text>秒</Text></Text><Text>剩余时间</Text></View><View><Text>{state.score}<Text>分</Text></Text><Text>本局得分</Text></View><View><Text>{state.served}<Text>/{level.targetServed}</Text></Text><Text>送达目标</Text></View><View className='pet-kitchen__combo'><Text>×{state.combo}</Text><Text>当前连击</Text></View></View>
      <View className='pet-kitchen__section-heading pet-kitchen__orders-heading'><Text>顾客的期待</Text><Text className='pet-kitchen__muted'>{level.name}</Text></View>
      <ScrollView className='pet-kitchen__orders' scrollX showScrollbar={false}><View className='pet-kitchen__order-track'>{liveOrders.length ? liveOrders.map(order => {
        const recipe = recipeById(order.recipeId)
        const patience = Math.max(0, Math.min(100, (order.expiresAtMs - state.elapsedMs) / order.patienceMs * 100))
        const inStation = Object.values(state.stations).some(station => station.job?.orderId === order.id)
        return <Button key={order.id} id={`kitchen-order-${order.id}`} className={`pet-kitchen-drop pet-kitchen__order ${state.selectedOrderId === order.id ? 'is-selected' : ''} ${patience < 25 ? 'is-urgent' : ''}`} onClick={() => safeClick({ type: 'select-order', orderId: order.id })}><View className='pet-kitchen__order-top'><Text>{recipe?.ingredients.map(id => ingredientById(id)?.emoji).join('')}</Text><Text>{Math.ceil(Math.max(0, order.expiresAtMs - state.elapsedMs) / 1000)}秒</Text></View><Text className='pet-kitchen__order-name'>{recipe?.name}</Text><Text className='pet-kitchen__order-state'>{inStation ? '正在制作' : state.selectedOrderId === order.id ? '已选中 · 开始备餐' : '点击接单'}</Text><View className='pet-kitchen__patience'><View style={{ width: `${patience}%` }} /></View></Button>
      }) : <View className='pet-kitchen__order-empty'><Text>这一波都送到了</Text><Text>下一位顾客马上来</Text></View>}</View></ScrollView>
      <View key={state.feedback.sequence} className={`pet-kitchen__feedback is-${state.feedback.kind}`}><Text>{state.feedback.kind === 'success' ? '✓' : state.feedback.kind === 'warning' ? '!' : '·'}</Text><Text>{state.feedback.message}</Text></View>
      {tutorial && showGuide ? <View className='pet-kitchen__guide'><View><Text>边玩边学</Text><Button onClick={() => setShowGuide(false)}>收起</Button></View><Text>{guideText}</Text></View> : null}
      <View className='pet-kitchen__stations'>{(['prep', 'cook', 'plate'] as StationId[]).map((stationId, index) => {
        const job = state.stations[stationId].job
        const recipe = job ? recipeById(job.recipeId) : undefined
        const ready = job?.stage === 'ready'
        const burnt = job?.stage === 'burnt'
        const progress = job ? Math.min(100, Math.max(0, job.progress * 100)) : 0
        return <View id={`kitchen-station-${stationId}`} key={stationId} className={`pet-kitchen-drop pet-kitchen__station is-${stationId} ${ready ? 'is-ready' : ''} ${burnt ? 'is-burnt' : ''}`}><View className='pet-kitchen__station-heading'><Text>{index + 1}</Text><Text>{stationLabels[stationId]}</Text></View><View className='pet-kitchen__dish' onTouchStart={event => beginDrag({ station: stationId }, event)} onTouchMove={moveDrag} onTouchEnd={endDrag} onTouchCancel={cancelDrag}><Text className='pet-kitchen__dish-icon'>{job ? burnt ? '♨' : recipe?.ingredients.map(id => ingredientById(id)?.emoji).slice(0, 2).join('') : stationId === 'prep' ? '🔪' : stationId === 'cook' ? '🍳' : '🍽'}</Text><Text className='pet-kitchen__dish-name'>{recipe?.name || '空闲工位'}</Text></View><Text className='pet-kitchen__station-state'>{!job ? stationId === 'prep' ? '待备餐' : '待送入' : burnt ? '烧焦了' : ready ? stationId === 'plate' ? '可递餐' : '可移交' : stationId === 'prep' ? `${recipe?.prepLabel || '备餐'}中` : stationId === 'cook' ? `${recipe?.cookLabel || '烹饪'}中` : '摆盘中'}</Text><View className='pet-kitchen__progress'><View style={{ width: `${progress}%` }} /></View><Text className='pet-kitchen__quality'>{job ? `品质 ${Math.round(job.quality)}%` : '—'}</Text>
          {stationId === 'prep' ? <Button id='kitchen-prepare' disabled={!playing || Boolean(job && !ready)} className='pet-kitchen__station-action' onClick={() => safeClick(job ? { type: 'move', from: 'prep' } : { type: 'prepare' })}>{job ? '送往灶台 ›' : '开始备餐'}</Button> : stationId === 'cook' ? <Button id='kitchen-move-cook' disabled={!playing || !job || burnt || job.progress < .65} className='pet-kitchen__station-action' onClick={() => safeClick({ type: 'move', from: 'cook' })}>出锅装盘 ›</Button> : <Button id='kitchen-serve' disabled={!playing || !ready} className='pet-kitchen__station-action' onClick={() => safeClick({ type: 'serve', orderId: job?.orderId })}>递给顾客 ✓</Button>}
          {job ? <Button id={`kitchen-discard-${stationId}`} className='pet-kitchen__discard' disabled={!playing} onClick={() => safeClick({ type: 'discard', station: stationId })}>{burnt ? '清理并重做' : '丢弃这份'}</Button> : <Text className='pet-kitchen__station-tip'>可拖拽 · 也可点按钮</Text>}
        </View>
      })}</View>
      <View className='pet-kitchen__heat'><View className='pet-kitchen__section-heading'><Text>掌握火候</Text><Text className='pet-kitchen__muted'>{state.stations.cook.job ? `当前 ${state.stations.cook.job.heat} · 建议 ${recipeById(state.stations.cook.job.recipeId)?.idealHeat}` : '食材送上灶台后可调节'}</Text></View><View className='pet-kitchen__heat-buttons'>{[{ value: 35, label: '小火', desc: '慢慢做' }, { value: state.stations.cook.job ? recipeById(state.stations.cook.job.recipeId)?.idealHeat || 55 : 55, label: '合适火候', desc: '品质更稳' }, { value: 85, label: '大火', desc: '快，但要盯紧' }].map(item => <Button id={`kitchen-heat-${item.label === '小火' ? 'low' : item.label === '大火' ? 'high' : 'ideal'}`} key={item.label} disabled={!playing || !state.stations.cook.job || state.stations.cook.job.stage === 'burnt'} className={state.stations.cook.job?.heat === item.value ? 'is-selected' : ''} onClick={() => dispatch({ type: 'heat', value: item.value })}><Text>{item.label}</Text><Text>{item.desc}</Text></Button>)}</View>{state.stations.cook.job ? <View className='pet-kitchen__cook-meter'><View className='pet-kitchen__cook-track'><View className='pet-kitchen__cook-perfect' /><View className='pet-kitchen__cook-marker' style={{ left: `${Math.min(98, state.stations.cook.job.progress / 1.55 * 100)}%` }} /></View><View className='pet-kitchen__cook-labels'><Text>未熟</Text><Text>绿色区出锅</Text><Text>烧焦</Text></View></View> : null}</View>
      <View className='pet-kitchen__ingredients'><View className='pet-kitchen__section-heading'><Text>选取食材</Text><Button id='kitchen-clear-ingredients' disabled={!playing} onClick={() => dispatch({ type: 'clear-ingredients' })}>清空选择</Button></View><Text className='pet-kitchen__recipe-hint'>{selectedRecipe ? `${selectedRecipe.name}：${selectedRecipe.ingredients.map(id => ingredientById(id)?.name).join(' ＋ ')}` : '先选一张订单，再准备对应食材'}</Text><View className='pet-kitchen__ingredient-grid'>{availableIngredients.map(ingredient => <Button id={`kitchen-ingredient-${ingredient.id}`} key={ingredient.id} disabled={!playing} className={state.selectedIngredients.includes(ingredient.id) ? 'is-selected' : ''} onClick={() => safeClick({ type: 'toggle-ingredient', ingredientId: ingredient.id })} onTouchStart={event => beginDrag({ ingredientId: ingredient.id }, event)} onTouchMove={moveDrag} onTouchEnd={endDrag} onTouchCancel={cancelDrag}><Text className='pet-kitchen__ingredient-icon'>{ingredient.emoji}</Text><Text>{ingredient.name}</Text><Text className='pet-kitchen__ingredient-check'>{state.selectedIngredients.includes(ingredient.id) ? '✓' : '+'}</Text></Button>)}</View></View>
      <Button className='pet-kitchen__text-button pet-kitchen__playing-help' onClick={() => { dispatch({ type: 'pause' }); setRecipeBook(true) }}>配方与操作说明</Button>
    </>}

    {dragging ? <View className='pet-kitchen__drag-ghost' style={{ left: `${dragging.x}px`, top: `${dragging.y}px` }}><Text>{dragging.kind === 'ingredient' ? ingredientById(dragging.ingredientId)?.emoji : '🍽'}</Text></View> : null}
    {state.status === 'paused' && !recipeBook ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__dialog'><Text className='pet-kitchen__dialog-title'>餐车歇一会儿</Text><Text className='pet-kitchen__muted'>时间、工序和顾客耐心都已暂停。</Text><Button id='kitchen-resume' disabled={!active} className='pet-kitchen__primary' onClick={() => dispatch({ type: 'resume' })}>继续营业</Button><Button id='kitchen-restart' className='pet-kitchen__secondary' onClick={() => start(levelId, tutorial)}>重新开始本关</Button><Button className='pet-kitchen__text-button' onClick={backToMenu}>返回关卡地图</Button><Button className='pet-kitchen__text-button' onClick={onExit}>离开餐车</Button></View></View> : null}
    {tutorialStep !== null ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__dialog'><Text className='pet-kitchen__dialog-kicker'>新手教学 · {tutorialStep + 1}/3</Text><Text className='pet-kitchen__tutorial-icon'>{['🥬', '🍳', '🍽'][tutorialStep]}</Text><Text className='pet-kitchen__dialog-title'>{['接单与备餐', '看火候，安排工位', '装盘与连击'][tutorialStep]}</Text><Text className='pet-kitchen__tutorial-copy'>{['点一张订单查看配方，点选对应食材，再点“开始备餐”。食材也可以拖到备餐台，选错可取消或清空。', '备餐完成后送往灶台。绿色进度区出锅品质更好；大火更快，但容易烧焦。灶台忙碌时，你可以准备下一份餐食。', '熟食送去装盘，完成后递给对应顾客。正确出餐积累连击；顾客耐心耗尽会离开，优先处理着急的订单。'][tutorialStep]}</Text><Button id='kitchen-tutorial-next' className='pet-kitchen__primary' onClick={() => tutorialStep < 2 ? setTutorialStep(tutorialStep + 1) : start(1, true)}>{tutorialStep < 2 ? '下一步' : '开始第一关 · 边玩边学'}</Button><Button className='pet-kitchen__text-button' onClick={() => setTutorialStep(null)}>暂时跳过</Button></View></View> : null}
    {recipeBook ? <View className='pet-kitchen__modal-mask'><View className='pet-kitchen__recipe-dialog'><View className='pet-kitchen__section-heading'><Text>餐车配方本 · 12份</Text><Button id='kitchen-close-recipes' onClick={() => setRecipeBook(false)}>关闭 ×</Button></View><ScrollView className='pet-kitchen__recipe-scroll' scrollY><View className='pet-kitchen__recipe-book'>{KITCHEN_RECIPES.map(recipe => <View key={recipe.id}><Text className='pet-kitchen__recipe-emoji'>{recipe.ingredients.map(id => ingredientById(id)?.emoji).join('')}</Text><View><Text>{recipe.name}</Text><Text>{recipe.ingredients.map(id => ingredientById(id)?.name).join(' ＋ ')}</Text><Text>{recipe.prepLabel} → {recipe.cookLabel} → 装盘</Text></View></View>)}</View><Text className='pet-kitchen__recipe-instructions'>操作：点选或拖入食材 → 备餐 → 送往灶台 → 控火出锅 → 装盘 → 递餐。烹饪绿色区为合适出锅时机，熟食摆放过久会降品质。</Text></ScrollView></View></View> : null}
  </View>
}
