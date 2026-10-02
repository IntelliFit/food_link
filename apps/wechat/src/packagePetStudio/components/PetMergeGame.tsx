import { Button, Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidHide } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PetActor } from '../../components/PetActor'
import type { PetProfile } from '../../utils/api'
import {
  MERGE_CATEGORIES, MERGE_LEVELS, applyMergeAction, createMergeGame, getAvailableMergeRecipes,
  getMergePreview, mergeLevelFor, mergeRecipeFor,
  type MergeAction, type MergeDirection, type MergeGameState, type MergeResult,
} from '../../utils/pet-merge-game'
import './PetMergeGame.scss'

export interface PetMergeGameProps {
  pet: PetProfile; accountId: string; active: boolean; startLevel?: number
  onFinished: (result: MergeResult, roundId: string, sessionAccountId: string) => void | Promise<void>
  onExit: () => void; settlementText?: string; onRetrySettlement?: () => void | Promise<void>
}
type TouchPoint = { clientX: number; clientY: number }
type TouchEventLike = { touches?: TouchPoint[]; changedTouches?: TouchPoint[] }
type RoundSession = { id: string; owner: string; accountId: string; callback: PetMergeGameProps['onFinished'] }
const RANK_LABELS = ['零', '一', '二', '三', '四']
const RANK_MARKS = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ']
const BACKDROP = '/packagePetStudio/assets/chapter-map-v1.jpg'
const directions: { direction: MergeDirection; mark: string; label: string }[] = [
  { direction: 'up', mark: '↑', label: '向上滑动' }, { direction: 'left', mark: '←', label: '向左滑动' },
  { direction: 'down', mark: '↓', label: '向下滑动' }, { direction: 'right', mark: '→', label: '向右滑动' },
]
function actorPixels() {
  try { return Math.round((Taro.getSystemInfoSync().windowWidth || 375) * 156 / 750) } catch { return 78 }
}

export function PetMergeGame({ pet, accountId, active, startLevel = 1, onFinished, onExit, settlementText, onRetrySettlement }: PetMergeGameProps) {
  const owner = `${accountId}:${pet.id}`
  const [state, setState] = useState<MergeGameState>(() => createMergeGame(startLevel))
  const [guide, setGuide] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settlementError, setSettlementError] = useState(false)
  const [actorSize] = useState(actorPixels)
  const ownerRef = useRef(owner)
  const activeRef = useRef(active)
  const stateRef = useRef(state)
  const mountedRef = useRef(true)
  const callbackRef = useRef(onFinished)
  const sessionRef = useRef<RoundSession | null>(null)
  const notifiedRef = useRef('')
  const counterRef = useRef(0)
  const touchRef = useRef<TouchPoint | null>(null)
  const suppressClickUntil = useRef(0)
  ownerRef.current = owner; activeRef.current = active; stateRef.current = state; callbackRef.current = onFinished
  const level = mergeLevelFor(state.levelId)
  const playing = state.status === 'running'
  const actorActive = active && state.status !== 'paused'
  const inRound = playing || state.status === 'paused'
  const blockedSettlement = settling || settlementError || Boolean(onRetrySettlement)
  const availableRecipes = getAvailableMergeRecipes(state)
  const selectedRecipe = mergeRecipeFor(state.selectedRecipeId || '')
  const preview = getMergePreview(state)
  const dispatch = useCallback((action: MergeAction) => {
    if (!activeRef.current && action.type !== 'pause') return
    setState(previous => applyMergeAction(previous, action))
  }, [])

  useDidHide(() => { touchRef.current = null; dispatch({ type: 'pause' }) })
  useEffect(() => {
    sessionRef.current = null; notifiedRef.current = ''; touchRef.current = null; suppressClickUntil.current = 0
    setState(createMergeGame(startLevel)); setSettling(false); setSettlementError(false); setGuide(false)
  }, [owner, startLevel])
  useEffect(() => { if (!active) { touchRef.current = null; dispatch({ type: 'pause' }) } }, [active, dispatch])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; activeRef.current = false; sessionRef.current = null }
  }, [])
  useEffect(() => {
    const result = state.result; const session = sessionRef.current
    if (!result || !session || session.owner !== ownerRef.current || !activeRef.current || notifiedRef.current === session.id) return
    notifiedRef.current = session.id; setSettling(true); setSettlementError(false)
    Promise.resolve().then(() => {
      if (!mountedRef.current || sessionRef.current !== session || ownerRef.current !== session.owner) return
      if (!activeRef.current) { notifiedRef.current = ''; return }
      return session.callback(result, session.id, session.accountId)
    }).then(() => {
      if (mountedRef.current && sessionRef.current === session && ownerRef.current === session.owner) setSettling(false)
    }).catch(() => {
      if (mountedRef.current && sessionRef.current === session && ownerRef.current === session.owner) { setSettling(false); setSettlementError(true) }
    })
  }, [state.result, active, owner])

  const start = (levelId = state.levelId) => {
    if (!activeRef.current || blockedSettlement) return
    const id = `merge:${Date.now().toString(36)}:${++counterRef.current}:${Math.random().toString(36).slice(2, 8)}`
    sessionRef.current = { id, owner, accountId, callback: callbackRef.current }; notifiedRef.current = ''
    setSettlementError(false); setGuide(false); touchRef.current = null; suppressClickUntil.current = 0
    setState(applyMergeAction(createMergeGame(levelId), { type: 'start' }))
  }
  const returnToMenu = () => {
    if (!activeRef.current || blockedSettlement) return
    sessionRef.current = null; notifiedRef.current = ''; touchRef.current = null; suppressClickUntil.current = 0
    setState(createMergeGame(state.levelId)); setGuide(false)
  }
  const exit = () => {
    if (!activeRef.current || blockedSettlement) return
    sessionRef.current = null; notifiedRef.current = ''; touchRef.current = null; suppressClickUntil.current = 0
    dispatch({ type: 'pause' })
    onExit()
  }
  const retrySettlement = () => {
    const result = stateRef.current.result; const session = sessionRef.current
    if (settling || !activeRef.current) return
    if (!onRetrySettlement && (!result || !session || session.owner !== ownerRef.current)) return
    setSettling(true)
    let attempted = false
    Promise.resolve().then(() => {
      if (!mountedRef.current || !activeRef.current || ownerRef.current !== owner || sessionRef.current !== session) return
      attempted = true
      return onRetrySettlement ? onRetrySettlement() : session!.callback(result!, session!.id, session!.accountId)
    }).then(() => {
      if (mountedRef.current && ownerRef.current === owner && sessionRef.current === session) { setSettling(false); setSettlementError(!attempted) }
    }).catch(() => { if (mountedRef.current && ownerRef.current === owner && sessionRef.current === session) { setSettling(false); setSettlementError(true) } })
  }
  const endSwipe = (event: unknown) => {
    const from = touchRef.current; const to = (event as TouchEventLike).changedTouches?.[0]; touchRef.current = null
    if (!from || !to || !playing) return
    const dx = to.clientX - from.clientX; const dy = to.clientY - from.clientY
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    suppressClickUntil.current = Date.now() + 350
    dispatch({ type: 'slide', direction: Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up' })
  }
  const guideContent = <View className='pet-merge__guide'>
    <Text className='pet-merge__guide-title'>先留空位，再把餐盘端上桌</Text>
    <Text className='pet-merge__guide-line'>① 滑动或点方向键：同类同级合成，最高四级。</Text>
    <Text className='pet-merge__guide-line'>② 点配方，再点对应棋子，确认交菜；交菜占一步，腾出空间。</Text>
    <Text className='pet-merge__guide-line'>③ 看下一枚，别把全部低级食材合掉；每局可完整撤回一步。</Text>
    <Text className='pet-merge__guide-line'>不倒计时。失败会保留已完成的成果，随时暂停。</Text>
  </View>

  return <ScrollView className='pet-merge' scrollY>
    <View className='pet-merge__header'>
      <Button id='merge-back' className='pet-merge__button pet-merge__back' disabled={!active || blockedSettlement} aria-label={inRound ? '暂停合成' : '回到伙伴小屋'} onClick={() => inRound ? dispatch({ type: 'pause' }) : exit()}>‹</Button>
      <View className='pet-merge__heading'><Text className='pet-merge__eyebrow'>伙伴游戏 · 单人</Text><Text className='pet-merge__title'>食材合成</Text></View>
      <Button id='merge-help' className='pet-merge__button pet-merge__help' onClick={() => setGuide(!guide)}>{guide ? '收起' : '玩法'}</Button>
    </View>
    {guide ? guideContent : null}
    {state.status === 'ready' ? <View className='pet-merge__menu'>
      <View className='pet-merge__scene'><Image className='pet-merge__backdrop' src={BACKDROP} mode='aspectFill' /><View className='pet-merge__scene-shade' /><View className='pet-merge__actor'><PetActor pet={pet} size={actorSize} active={actorActive} showStatus action='idle' /></View><View className='pet-merge__scene-copy'><Text className='pet-merge__scene-title'>为小屋摆一桌小成果</Text><Text className='pet-merge__scene-caption'>想一想，滑一格。收藏来自明确目标。</Text></View></View>
      <Text className='pet-merge__section-title'>选择今天的餐盘</Text>
      <View className='pet-merge__levels'>{MERGE_LEVELS.map(item => <Button key={item.id} id={`merge-level-${item.id}`} className={`pet-merge__button pet-merge__level${item.id === level.id ? ' pet-merge__level--selected' : ''}`} disabled={!active || blockedSettlement} onClick={() => setState(createMergeGame(item.id))}><Text className='pet-merge__level-index'>0{item.id}</Text><Text className='pet-merge__level-title'>{item.name}</Text><Text className='pet-merge__level-detail'>{item.maxSteps}步 · {item.obstacles.length ? `${item.obstacles.length}个障碍` : item.ordered ? '分阶段配方' : '自由选择配方'}</Text></Button>)}</View>
      <View className='pet-merge__target'><Text className='pet-merge__target-title'>{level.name}</Text><Text className='pet-merge__caption'>{level.description}</Text><Text className='pet-merge__collection'>目标收藏 · {level.collectibleName}</Text></View>
      <Button id='merge-start' className='pet-merge__button pet-merge__primary' disabled={!active || blockedSettlement} onClick={() => start()}>开始摆餐盘</Button>
    </View> : null}
    {inRound ? <View className='pet-merge__play'>
      <View className='pet-merge__stats'><View><Text className='pet-merge__stat-value'>{level.maxSteps - state.steps}</Text><Text className='pet-merge__stat-label'>剩余步数</Text></View><View><Text className='pet-merge__stat-value'>{state.score}</Text><Text className='pet-merge__stat-label'>游戏分</Text></View><View><Text className='pet-merge__stat-value'>{state.completedRecipeIds.length}/{level.recipeIds.length}</Text><Text className='pet-merge__stat-label'>目标餐盘</Text></View><Button id='merge-pause' className='pet-merge__button pet-merge__pause' disabled={!playing} onClick={() => dispatch({ type: 'pause' })}>暂停</Button></View>
      <View className='pet-merge__partner'><PetActor pet={pet} size={actorSize} active={actorActive} showStatus action={state.selectedRecipeId ? 'observe' : state.completedRecipeIds.length ? 'cook' : 'idle'} /><View className='pet-merge__partner-copy'><Text className='pet-merge__target-title'>{level.name}</Text><Text className='pet-merge__caption'>{level.targetRank > 2 ? `合到${RANK_LABELS[level.targetRank]}级，再完成配方` : level.ordered ? '按顺序完成当前配方' : '选择想先完成的配方'}</Text><Text className='pet-merge__caption'>最高已到{RANK_LABELS[state.highestRank]}级 · 可以慢慢想</Text></View></View>
      <View className='pet-merge__recipes'>{level.recipeIds.map(id => {
        const recipe = mergeRecipeFor(id)!; const done = state.completedRecipeIds.includes(id); const available = availableRecipes.some(item => item.id === id)
        return <Button key={id} id={`merge-recipe-${id}`} className={`pet-merge__button pet-merge__recipe${state.selectedRecipeId === id ? ' pet-merge__recipe--selected' : ''}${done ? ' pet-merge__recipe--done' : ''}`} disabled={!playing || !available} onClick={() => dispatch({ type: 'choose-recipe', recipeId: id })}><Text className='pet-merge__recipe-title'>{done ? '✓ ' : !available ? '随后 · ' : ''}{recipe.name}</Text><Text className='pet-merge__recipe-needs'>{recipe.requirements.map(item => `${MERGE_CATEGORIES[item.category].mark}${RANK_MARKS[item.rank]}`).join(' + ')}</Text></Button>
      })}</View>
      <View className='pet-merge__preview'><Text>下一枚</Text>{preview.map((item, index) => <View key={index} className={`pet-merge__preview-tile pet-merge__preview-tile--${item.category}`}><Text>{MERGE_CATEGORIES[item.category].mark}{RANK_MARKS[item.rank]}</Text></View>)}<Text className='pet-merge__preview-note'>每个有效滑动新增一枚</Text></View>
      <View id='merge-board' className='pet-merge__board' catchMove={playing} onTouchMove={event => event.stopPropagation()} data-state={state.status} data-steps={state.steps} data-score={state.score} onTouchStart={event => { touchRef.current = (event as unknown as TouchEventLike).touches?.[0] || null }} onTouchEnd={endSwipe} onTouchCancel={() => { touchRef.current = null }}>
        {state.board.map((tile, cell) => {
          const obstacle = level.obstacles.includes(cell); const selectable = Boolean(selectedRecipe && tile && selectedRecipe.requirements.some(item => item.category === tile.category && item.rank === tile.rank))
          return <Button key={cell} id={`merge-cell-${cell}`} className={`pet-merge__button pet-merge__cell${obstacle ? ' pet-merge__cell--obstacle' : tile ? ` pet-merge__cell--${tile.category}` : ' pet-merge__cell--empty'}${selectable ? ' pet-merge__cell--eligible' : ''}${state.selectedCells.includes(cell) ? ' pet-merge__cell--selected' : ''}`} disabled={!playing || !tile || !selectedRecipe} aria-label={obstacle ? '固定收纳篮' : tile ? `${MERGE_CATEGORIES[tile.category].name}${RANK_LABELS[tile.rank]}级${state.selectedCells.includes(cell) ? '已选中' : ''}` : '空格'} onClick={() => { if (Date.now() >= suppressClickUntil.current) dispatch({ type: 'toggle-cell', cell }) }}>{obstacle ? <Text className='pet-merge__obstacle-mark'>▤</Text> : tile ? <><Text className='pet-merge__tile-mark'>{MERGE_CATEGORIES[tile.category].mark}</Text><Text className='pet-merge__tile-rank'>{RANK_MARKS[tile.rank]} · {MERGE_CATEGORIES[tile.category].name}</Text></> : <Text className='pet-merge__empty-mark'>·</Text>}</Button>
        })}
      </View>
      <View className='pet-merge__directions'>{directions.map(item => <Button key={item.direction} id={`merge-${item.direction}`} className='pet-merge__button pet-merge__direction' aria-label={item.label} disabled={!playing} onClick={() => dispatch({ type: 'slide', direction: item.direction })}>{item.mark}</Button>)}</View>
      <View className='pet-merge__actions'><Button id='merge-submit' className='pet-merge__button pet-merge__primary' disabled={!playing || !selectedRecipe} onClick={() => dispatch({ type: 'submit' })}>确认交菜{state.selectedCells.length ? ` · ${state.selectedCells.length}格` : ''}</Button><Button id='merge-undo' className='pet-merge__button pet-merge__secondary' disabled={!playing || !state.undoAvailable || !state.previous} onClick={() => dispatch({ type: 'undo' })}>{state.undoAvailable ? '撤回一步' : '已用撤回'}</Button></View>
      <Text className={`pet-merge__feedback${state.feedback.warning ? ' pet-merge__feedback--warning' : ''}`}>{state.feedback.message}</Text>
      <Text className='pet-merge__footnote'>等级是游戏收集阶，不代表真实食物的营养优劣。</Text>
    </View> : null}
    {state.status === 'paused' ? <View className='pet-merge__pause-card'><Text className='pet-merge__target-title'>餐桌在这里等你</Text><Text className='pet-merge__caption'>棋盘和步数都停在原处，回来后再继续。</Text><Button id='merge-resume' className='pet-merge__button pet-merge__primary' disabled={!active} onClick={() => dispatch({ type: 'resume' })}>继续摆餐盘</Button><Button id='merge-abandon' className='pet-merge__button pet-merge__secondary' disabled={!active || blockedSettlement} onClick={returnToMenu}>重新选择关卡</Button><Button id='merge-exit' className='pet-merge__button pet-merge__quiet' disabled={!active || blockedSettlement} onClick={exit}>回到小屋</Button></View> : null}
    {state.result ? <View id='merge-result' className='pet-merge__result'><PetActor pet={pet} size={actorSize} active={actorActive} showStatus action={state.result.completed ? 'celebrate' : 'wave'} /><Text className='pet-merge__result-title'>{state.result.completed ? '一桌小成果' : '我们下次再试试'}</Text><Text className='pet-merge__caption'>{state.feedback.message}</Text><View className='pet-merge__result-stats'><Text>{state.score} 游戏分</Text><Text>{state.completedRecipeIds.length} 份餐盘</Text><Text>{state.steps} 有效步</Text></View>{settling ? <View className='pet-merge__spinner' aria-label='正在保存本局结果' /> : settlementError ? <Text className='pet-merge__save-warning'>成果尚未保存，请重新保存后再离开。</Text> : settlementText ? <Text className='pet-merge__save-text'>{settlementText}</Text> : null}{(settlementError || onRetrySettlement) ? <Button id='merge-retry-settlement' className='pet-merge__button pet-merge__secondary' disabled={settling || !active} onClick={retrySettlement}>重新保存成果</Button> : null}<Button id='merge-retry' className='pet-merge__button pet-merge__primary' disabled={!active || blockedSettlement} onClick={() => start()}>再摆一桌</Button><Button id='merge-result-exit' className='pet-merge__button pet-merge__secondary' disabled={!active || blockedSettlement} onClick={exit}>带着成果回小屋</Button><Button id='merge-menu' className='pet-merge__button pet-merge__quiet' disabled={!active || blockedSettlement} onClick={returnToMenu}>看看其他关卡</Button></View> : null}
  </ScrollView>
}
