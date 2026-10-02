import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidHide } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PetActor } from '../../components/PetActor'
import type { PetProfile } from '../../utils/api'
import {
  EXPLORE_COLLECTIBLES, EXPLORE_LEVELS, EXPLORE_SYMBOLS, advanceExploreGame, applyExploreAction, createExploreGame,
  exploreCanalPorts, exploreHistory, exploreLevel, exploreMissing, exploreNeighbors, exploreNode,
  type ExploreAction, type ExploreCanal, type ExploreHistory, type ExplorePort, type ExploreResult, type ExploreSymbol,
} from '../../utils/pet-explore-game'
import './PetExploreGame.scss'

export interface PetExploreGameProps {
  pet: PetProfile; accountId: string; active: boolean; startLevel?: number; onExit: () => void
  onFinished: (result: ExploreResult, roundId: string, sessionAccountId: string) => void | Promise<void>
  settlementText?: string; onRetrySettlement?: () => void | Promise<void>
}
const BACKDROP = '/packagePetStudio/assets/chapter-map-v1.jpg'
const KIND_LABEL = { camp: '营地', view: '路口', clue: '线索', canal: '水渠', slate: '石板', treasure: '宝物' }
const KIND_GLYPH = { camp: '⌂', view: '·', clue: '⌕', canal: '≈', slate: '▦', treasure: '◇' }
const PORT_LABEL = ['上', '右', '下', '左']
function canalGlyph(ports: ExplorePort[]) {
  const has = (p: ExplorePort) => ports.includes(p)
  if (has(0) && has(2)) return '│'
  if (has(1) && has(3)) return '─'
  if (has(0) && has(1)) return '└'
  if (has(1) && has(2)) return '┌'
  if (has(2) && has(3)) return '┐'
  return '┘'
}
function petSize() {
  try { return Math.round((Taro.getSystemInfoSync().windowWidth || 375) * 164 / 750) } catch { return 82 }
}
function canalOutlet(puzzle: ExploreCanal) {
  const [x, y] = puzzle.cells[puzzle.cells.length - 1]
  const [previousX, previousY] = puzzle.cells[puzzle.cells.length - 2]
  const incoming: ExplorePort = previousX < x ? 3 : previousX > x ? 1 : previousY < y ? 0 : 2
  const outlet = puzzle.ports[puzzle.ports.length - 1].find(port => port !== incoming) || 0
  return {
    label: outlet === 1 ? '出口 →' : outlet === 2 ? '↓ 出口' : outlet === 3 ? '← 出口' : '↑ 出口',
    left: `${(x + .5 + (outlet === 1 ? .47 : outlet === 3 ? -.47 : 0)) / 3 * 100}%`,
    top: `${(y + .5 + (outlet === 2 ? .47 : outlet === 0 ? -.47 : 0)) / 3 * 100}%`,
    transform: outlet === 1 ? 'translate(-100%, -50%)' : outlet === 3 ? 'translate(0, -50%)' : 'translate(-50%, 0)',
  }
}

export function PetExploreGame({ pet, accountId, active, startLevel = 1, onFinished, onExit, settlementText, onRetrySettlement }: PetExploreGameProps) {
  const [state, setState] = useState(() => createExploreGame(startLevel))
  const [help, setHelp] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settlementError, setSettlementError] = useState(false)
  const [walking, setWalking] = useState(false)
  const [size] = useState(petSize)
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const scope = `${accountId}:${pet.id}`
  const scopeRef = useRef(scope)
  const callbackRef = useRef(onFinished)
  const alive = useRef(true)
  const histories = useRef<Record<number, ExploreHistory>>({})
  const counter = useRef(0)
  const notified = useRef('')
  const session = useRef<{ id: string; scope: string; accountId: string; callback: PetExploreGameProps['onFinished'] } | null>(null)
  const blockedRef = useRef(false)
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  stateRef.current = state
  activeRef.current = active
  scopeRef.current = scope
  callbackRef.current = onFinished
  const needsRetry = Boolean(onRetrySettlement) || settlementError
  const blocked = settling || needsRetry
  blockedRef.current = blocked
  const level = exploreLevel(state.levelId)
  const current = exploreNode(state)
  const neighbors = exploreNeighbors(state)
  const playing = state.status === 'running' && active
  const actorActive = active && state.status !== 'paused'
  const missing = exploreMissing(state)
  const completed = level.main.every(id => state.claimed.includes(id))
  const outlet = current.canal ? canalOutlet(current.canal) : null
  const unclaimed = level.nodes.some(item => ['clue', 'canal', 'slate', 'treasure'].includes(item.kind) && !state.claimed.includes(item.id))

  const dispatch = useCallback((action: ExploreAction) => {
    if ((!activeRef.current && action.type !== 'pause') || blockedRef.current) return
    setState(previous => applyExploreAction(previous, action))
  }, [])
  useDidHide(() => { dispatch({ type: 'pause' }) })
  useEffect(() => {
    if (walkTimer.current) { clearTimeout(walkTimer.current); walkTimer.current = null }
    histories.current = {}
    session.current = null
    notified.current = ''
    setState(createExploreGame(startLevel))
    setSettling(false)
    setSettlementError(false)
    setHelp(false)
    setWalking(false)
  }, [scope, startLevel])
  useEffect(() => { if (!active) dispatch({ type: 'pause' }) }, [active, dispatch])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; activeRef.current = false; session.current = null; if (walkTimer.current) clearTimeout(walkTimer.current) }
  }, [])
  useEffect(() => {
    if (!playing || state.phase !== 'haul') return undefined
    const timer = setInterval(() => {
      if (activeRef.current && alive.current) setState(previous => advanceExploreGame(previous, 100))
    }, 100)
    return () => clearInterval(timer)
  }, [playing, state.phase])
  useEffect(() => {
    const round = session.current
    const result = state.result
    if (!round || !result || notified.current === round.id || !activeRef.current || round.scope !== scopeRef.current) return
    // 正常终局保留地图成果；未曾移动的直接离开不产生结算。
    histories.current[state.levelId] = exploreHistory(state)
    if (state.moves === 0) return
    notified.current = round.id
    blockedRef.current = true
    setSettling(true)
    Promise.resolve().then(() => {
      if (!alive.current || session.current?.id !== round.id || scopeRef.current !== round.scope) return
      if (!activeRef.current) { notified.current = ''; return }
      return round.callback(result, round.id, round.accountId)
    }).then(() => {
      if (alive.current && session.current?.id === round.id && scopeRef.current === round.scope) setSettling(false)
    }).catch(() => {
      if (alive.current && session.current?.id === round.id && scopeRef.current === round.scope) { setSettling(false); setSettlementError(true) }
    })
  }, [active, state.result, state.levelId, state.moves, scope])

  const start = () => {
    if (!activeRef.current || !accountId || !pet.id || blockedRef.current || !unclaimed) return
    if (state.status === 'finished') histories.current[state.levelId] = exploreHistory(state)
    counter.current += 1
    session.current = { id: `explore:${Date.now()}:${counter.current}:${Math.random().toString(36).slice(2, 8)}`, scope: scopeRef.current, accountId, callback: callbackRef.current }
    notified.current = ''
    setSettlementError(false)
    setHelp(false)
    setState(applyExploreAction(createExploreGame(state.levelId, histories.current[state.levelId]), { type: 'start' }))
  }
  const selectLevel = (levelId: number) => {
    if (!activeRef.current || blockedRef.current || state.status === 'running' || state.status === 'paused') return
    histories.current[state.levelId] = exploreHistory(state)
    session.current = null
    notified.current = ''
    setState(createExploreGame(levelId, histories.current[levelId]))
  }
  const move = (nodeId: string) => {
    if (!playing || state.phase !== 'map' || state.remaining <= 0 || !neighbors.includes(nodeId)) return
    dispatch({ type: 'move', nodeId })
    setWalking(true)
    if (walkTimer.current) clearTimeout(walkTimer.current)
    walkTimer.current = setTimeout(() => { if (alive.current) setWalking(false) }, 650)
  }
  const leave = () => { if (blockedRef.current || !activeRef.current) return; session.current = null; onExit() }
  const retry = () => {
    const round = session.current
    const result = stateRef.current.result
    if (!activeRef.current || settling || !round || !result || round.scope !== scopeRef.current) return
    blockedRef.current = true
    setSettling(true)
    setSettlementError(false)
    let attempted = false
    Promise.resolve().then(() => {
      if (!alive.current || !activeRef.current || session.current?.id !== round.id || scopeRef.current !== round.scope) return
      attempted = true
      // 明确点击重试沿用原局 ID；统一账本负责请求幂等，绝不创建新局奖励。
      return onRetrySettlement ? onRetrySettlement() : round.callback(result, round.id, round.accountId)
    }).then(() => {
      if (alive.current && session.current?.id === round.id && scopeRef.current === round.scope) { setSettling(false); if (!attempted) setSettlementError(true) }
    }).catch(() => {
      if (alive.current && session.current?.id === round.id && scopeRef.current === round.scope) { setSettling(false); setSettlementError(true) }
    })
  }
  const actorAction = !active || state.status === 'paused' ? 'idle' : state.status === 'finished' && state.treasures > 0 ? 'celebrate' : !playing ? 'idle' : walking ? 'walk' : state.phase !== 'map' || current.kind === 'clue' ? 'observe' : state.feedback.startsWith('打捞成功') ? 'celebrate' : 'idle'

  return <View className='pet-explore'>
    <View className='pet-explore__header'>
      <Button id='explore-back' className='pet-explore__button pet-explore__back' disabled={blocked || !active} aria-label='返回或暂停寻宝' onClick={() => state.status === 'running' ? dispatch({ type: 'pause' }) : leave()}>‹</Button>
      <View><Text className='pet-explore__eyebrow'>水岸寻宝 · {state.levelId}/6</Text><Text className='pet-explore__title'>{level.name}</Text></View>
      <Button id='explore-help' className='pet-explore__button pet-explore__quiet' disabled={blocked} onClick={() => { if (state.status === 'running') dispatch({ type: 'pause' }); setHelp(true) }}>玩法</Button>
    </View>
    {state.status === 'ready' ? <>
      <Text className='pet-explore__intro'>{level.description}</Text>
      <View className='pet-explore__goal'><Text>本次目标 · 奖品出发前可见</Text><Text>{level.main.map(id => level.nodes.find(item => item.id === id)).map(item => `${item?.name}：${EXPLORE_COLLECTIBLES[item?.collectible || ''] || ''}`).join(' / ')}</Text><Text>先找 {level.nodes.filter(item => item.kind === 'clue').map(item => item.name).join('、')}；{level.budget} 点行动，无倒计时。</Text></View>
    </> : null}
    {state.status === 'finished' && state.result ? <View id='explore-result' className='pet-explore__result' data-score={state.result.score} data-completed={state.result.completed}>
      <PetActor pet={pet} size={size} action={actorAction} active={actorActive} showStatus />
      <Text className='pet-explore__result-title'>{state.result.completed ? '水岸记忆，带回家了' : state.remaining === 0 ? '这一程，收获都留下了' : '带着收获回营地'}</Text>
      <Text className='pet-explore__result-score'>{state.result.score}<Text> 分</Text></Text>
      <Text className='pet-explore__rating'>{'★'.repeat(state.result.stars)}{'☆'.repeat(3 - state.result.stars)} · 本程评价</Text>
      <Text className='pet-explore__muted'>移动 {state.moves} 次 · 新线索 {state.discovered} · 谜题 {state.puzzles} · 宝物 {state.treasures}</Text>
      <View className='pet-explore__collection'><Text>本行程带回</Text><Text>{state.result.collectibles.length ? state.result.collectibles.map(id => EXPLORE_COLLECTIBLES[id] || id).join('、') : '已发现的线索与路线记录；下次继续寻找宝物。'}</Text></View>
      {completed ? <View className='pet-explore__story'><Text>{level.story}</Text><Text>{level.recipe}</Text></View> : <Text className='pet-explore__muted'>线索、已解谜题与已领奖节点保留。下一程从营地出发，只计新的收获。</Text>}
      {settling ? <View className='pet-explore__spinner' aria-label='正在保存收获' /> : <Text className='pet-explore__settlement'>{settlementError ? '收获未保存，请重试保存后再离开。' : settlementText || '星光按统一有效完局规则结算；收藏进入背包。'}</Text>}
      {needsRetry ? <Button id='explore-retry-settlement' className='pet-explore__button pet-explore__primary' disabled={settling || !active} onClick={retry}>重试保存收获</Button> : null}
      {unclaimed ? <Button id='explore-continue' className='pet-explore__button pet-explore__primary' disabled={blocked || !active} onClick={start}>另开免费行程 · 继续这张地图</Button> : null}
      {state.levelId < 6 ? <Button id='explore-next' className='pet-explore__button pet-explore__secondary' disabled={blocked || !active} onClick={() => selectLevel(state.levelId + 1)}>下一张水岸地图 ›</Button> : null}
      <Button id='explore-result-exit' className='pet-explore__button pet-explore__quiet' disabled={blocked || !active} onClick={leave}>带收获回成长小屋</Button>
    </View> : <>
      {state.status !== 'ready' ? <View className='pet-explore__hud'><View><Text>{state.remaining}<Text>/{level.budget}</Text></Text><Text>行动点</Text></View><View><Text>{state.score}</Text><Text>本程分数</Text></View><View><Text>{level.main.filter(id => state.claimed.includes(id)).length}<Text>/{level.main.length}</Text></Text><Text>主线宝物</Text></View><Button id='explore-pause' className='pet-explore__button pet-explore__quiet' disabled={!playing} onClick={() => dispatch({ type: 'pause' })}>暂停</Button></View> : null}
      <View id='explore-world' className='pet-explore__map' data-state={state.status} data-node={state.nodeId} data-score={state.score} data-remaining={state.remaining} style={{ backgroundImage: `url(${BACKDROP})` }}>
        <View className='pet-explore__map-wash' />
        {level.edges.map(([a, b]) => {
          const left = level.nodes.find(item => item.id === a)!
          const right = level.nodes.find(item => item.id === b)!
          const dx = right.x - left.x
          const dy = right.y - left.y
          // 地图固定比例：宽 654rpx、高 480rpx，连接线沿节点中心旋转。
          const width = Math.sqrt((dx * 6.54) ** 2 + (dy * 4.8) ** 2)
          const angle = Math.atan2(dy * 4.8, dx * 6.54) * 180 / Math.PI
          return <View key={`${a}-${b}`} className='pet-explore__route' style={{ left: `${left.x}%`, top: `${left.y}%`, width: `${width}rpx`, transform: `rotate(${angle}deg)` }} />
        })}
        {level.nodes.map(item => <Button id={`explore-node-${item.id}`} key={item.id} className={`pet-explore__button pet-explore__node is-${item.kind} ${item.id === state.nodeId ? 'is-current' : ''} ${state.claimed.includes(item.id) ? 'is-claimed' : ''} ${playing && neighbors.includes(item.id) && state.phase === 'map' ? 'is-reachable' : ''}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} disabled={!playing || state.phase !== 'map' || state.remaining <= 0 || !neighbors.includes(item.id)} aria-label={`${item.name}，${state.claimed.includes(item.id) ? '已完成' : KIND_LABEL[item.kind]}${neighbors.includes(item.id) ? '，相邻可移动' : ''}`} onClick={() => move(item.id)}><Text>{state.claimed.includes(item.id) ? '✓' : KIND_GLYPH[item.kind]}</Text><Text>{item.name}</Text></Button>)}
        <View className='pet-explore__map-pet' style={{ left: `${Math.min(84, Math.max(16, current.x + 8))}%`, top: `${Math.max(30, current.y - 8)}%` }}><PetActor pet={pet} size={size} action={actorAction} active={actorActive} showStatus /></View>
      </View>
      <View className='pet-explore__legend'><Text>⌕ 线索</Text><Text>≈ 水渠</Text><Text>▦ 石板</Text><Text>◇ 宝物</Text><Text>✓ 已领</Text></View>
      {state.status === 'ready' ? <>
        <Button id='explore-start' className='pet-explore__button pet-explore__primary' disabled={!active || !accountId || !pet.id || blocked || !unclaimed} onClick={start}>{unclaimed ? `和${pet.name}出发 · ${level.budget} 点行动` : '这张地图的收获已经带回家'}</Button>
        {!unclaimed ? <View className='pet-explore__story'><Text>{level.story}</Text><Text>{level.recipe}</Text></View> : null}
        <View className='pet-explore__level-grid'>{EXPLORE_LEVELS.map(item => <Button id={`explore-level-${item.id}`} key={item.id} className={`pet-explore__button pet-explore__level ${item.id === state.levelId ? 'is-selected' : ''}`} disabled={blocked || !active} onClick={() => selectLevel(item.id)}><Text>{item.id < 10 ? `0${item.id}` : item.id}</Text><Text>{item.name}</Text></Button>)}</View>
      </> : <>
        <Text className='pet-explore__feedback'>{state.feedback}</Text>
        {state.phase === 'map' ? <View className='pet-explore__node-panel'><View className='pet-explore__panel-heading'><Text>{current.name}</Text><Text>{KIND_LABEL[current.kind]}{state.claimed.includes(current.id) ? ' · 已完成' : ''}</Text></View><Text>{current.text}</Text>
          {missing.length ? <Text className='pet-explore__requirement'>还需要：{missing.map(id => level.nodes.find(item => item.id === id)?.name).join('、')}</Text> : null}
          {current.kind === 'clue' ? <Button id='explore-observe' className='pet-explore__button pet-explore__secondary' disabled={!playing} onClick={() => dispatch({ type: 'observe' })}>{state.claimed.includes(current.id) ? '免费重看线索' : '观察并记下线索 · +50 分'}</Button> : ['canal', 'slate', 'treasure'].includes(current.kind) ? <Button id='explore-challenge' className='pet-explore__button pet-explore__primary' disabled={!playing || state.claimed.includes(current.id) || missing.length > 0} onClick={() => dispatch({ type: 'challenge' })}>{state.claimed.includes(current.id) ? '已领收获，继续旅行' : current.kind === 'treasure' ? '开始打捞' : '打开谜题 · +100 分'}</Button> : null}
          <Text className='pet-explore__muted'>相邻地点：{neighbors.map(id => level.nodes.find(item => item.id === id)?.name).join('、')}。点地图移动，每次 1 点行动。</Text>
        </View> : null}
        {state.phase === 'canal' && current.canal ? <View className='pet-explore__puzzle'><Text className='pet-explore__panel-heading'>旋转水渠，让浮标抵达出口</Text><Text className='pet-explore__muted'>点水渠顺时针旋转。数字按水流顺序；每块都要接通前后方向。</Text>
          <View className='pet-explore__canal-grid'>
            <Text className='pet-explore__canal-start' style={{ left: '1%', top: `${(current.canal.cells[0][1] + .5) / 3 * 100}%` }}>● 浮标 →</Text>
            {outlet ? <Text className='pet-explore__canal-exit' style={{ left: outlet.left, top: outlet.top, transform: outlet.transform }}>{outlet.label}</Text> : null}
            {current.canal.cells.map(([x, y], index) => { const ports = exploreCanalPorts(current, state.rotations, index); return <Button id={`explore-canal-${index}`} key={index} className='pet-explore__button pet-explore__canal-tile' disabled={!playing} style={{ left: `${(x + .5) / 3 * 100}%`, top: `${(y + .5) / 3 * 100}%` }} aria-label={`水渠 ${index + 1}，${ports.map(port => PORT_LABEL[port]).join('连接')}，点按旋转`} onClick={() => dispatch({ type: 'rotate', index })}><Text>{canalGlyph(ports)}</Text><Text>{index + 1} · {ports.map(port => PORT_LABEL[port]).join('↔')}</Text></Button> })}
          </View>
          <Button id='explore-check-canal' className='pet-explore__button pet-explore__primary' disabled={!playing} onClick={() => dispatch({ type: 'check-canal' })}>放下浮标，检查连通</Button>
        </View> : null}
        {state.phase === 'slate' ? <View className='pet-explore__puzzle'><Text className='pet-explore__panel-heading'>依照岸边线索，按顺序点石板</Text><View className='pet-explore__slate-sequence'>{Array.from({ length: current.orderPattern ? 4 : current.pattern?.length || 3 }, (_, index) => <Text key={index}>{state.sequence[index] ? EXPLORE_SYMBOLS[state.sequence[index]].glyph : '·'}</Text>)}</View><View className='pet-explore__slate-buttons'>{(Object.keys(EXPLORE_SYMBOLS) as ExploreSymbol[]).map(symbol => <Button id={`explore-slate-${symbol}`} key={symbol} className='pet-explore__button pet-explore__slate-button' disabled={!playing} onClick={() => dispatch({ type: 'slate', symbol })}><Text>{EXPLORE_SYMBOLS[symbol].glyph}</Text><Text>{EXPLORE_SYMBOLS[symbol].label}</Text></Button>)}</View><Text className='pet-explore__muted'>输错只重置这道谜题，免费查看下方线索后可再试。</Text></View> : null}
        {state.phase === 'haul' ? <View id='explore-haul' className='pet-explore__haul' data-progress={state.haul.progress} data-tension={state.haul.tension} data-pulling={state.haul.pulling}><View className='pet-explore__panel-heading'><Text>打捞 · {current.name}</Text><Text>{current.rhythm === 'surge' ? '每三秒改变拉力' : '平缓张力'}</Text></View><Text>打捞进度 {Math.floor(state.haul.progress)}%</Text><View className='pet-explore__progress'><View style={{ width: `${state.haul.progress}%` }} /></View><Text>张力 {Math.floor(state.haul.tension)} / 100</Text><View className='pet-explore__tension'><View className='pet-explore__safe-zone'><Text>▧ 安全区 20–65</Text></View><View className='pet-explore__tension-marker' style={{ left: `${Math.min(98, state.haul.tension)}%` }} /></View><View className='pet-explore__meter-labels'><Text>松弛 0</Text><Text>▲ 过紧 100</Text></View>
          <Button id='explore-hold' className='pet-explore__button pet-explore__primary pet-explore__hold' disabled={!playing} onTouchStart={() => dispatch({ type: 'pull', value: true })} onTouchEnd={() => dispatch({ type: 'pull', value: false })} onTouchCancel={() => dispatch({ type: 'pull', value: false })}>按住收线 · 松开降张力</Button>
          <Button id='explore-pull-toggle' className='pet-explore__button pet-explore__secondary' disabled={!playing} onClick={() => dispatch({ type: 'pull', value: !state.haul.pulling })}>{state.haul.pulling ? '暂停收线 · 降低张力' : '开始收线 · 无需长按'}</Button><Text className='pet-explore__muted'>纹理安全区内收线品质更高，张力到 100 会落回原点。重试保留线索与已得宝物，不补行动点。</Text>
        </View> : null}
        {state.phase === 'canal' || state.phase === 'slate' ? <Button id='explore-reset-puzzle' className='pet-explore__button pet-explore__quiet' disabled={!playing} onClick={() => dispatch({ type: 'reset-puzzle' })}>重置当前谜题</Button> : null}
        {state.phase !== 'map' ? <Button id='explore-close-challenge' className='pet-explore__button pet-explore__quiet' disabled={!playing} onClick={() => dispatch({ type: 'close-challenge' })}>收起挑战，回到地图</Button> : null}
        <View className='pet-explore__clue-book'><Text className='pet-explore__panel-heading'>线索本 · 随时免费重看</Text>{state.clues.length ? state.clues.map((id, index) => <View key={id}><Text>{index + 1}. {level.nodes.find(item => item.id === id)?.name}</Text><Text>{level.nodes.find(item => item.id === id)?.text}</Text></View>) : <Text className='pet-explore__muted'>找到地图上的 ⌕，抵达后点“观察”记下线索。</Text>}</View>
        <Button id='explore-finish' className='pet-explore__button pet-explore__secondary' disabled={!playing || state.moves === 0} onClick={() => dispatch({ type: 'finish' })}>{completed ? '带着主线收获回营地' : '带已有收获回营地'}</Button>
      </>}
    </>}
    {state.status === 'paused' && !help ? <View className='pet-explore__mask'><View className='pet-explore__dialog'><Text className='pet-explore__result-title'>在水岸歇一会儿</Text><Text>行动、谜题与张力都已暂停。回到前台后点“继续旅行”。</Text><Button id='explore-resume' className='pet-explore__button pet-explore__primary' disabled={!active || blocked} onClick={() => dispatch({ type: 'resume' })}>继续旅行</Button><Button id='explore-paused-exit' className='pet-explore__button pet-explore__quiet' disabled={blocked || !active} onClick={leave}>离开本局，回成长小屋</Button></View></View> : null}
    {help ? <View className='pet-explore__mask'><View className='pet-explore__dialog'><Text className='pet-explore__result-title'>观察、解谜、带回收获</Text><Text>① 出发前看目标。只可到相邻节点，每次消耗 1 点行动。</Text><Text>② 找线索并点观察，+50 分；水渠和石板先拿齐所需线索才能开始，完成 +100 分。</Text><Text>③ 按住收线、松开降张力，也可用“开始 / 暂停”切换。宝物 +100 分，安全区操作品质最多 +50 分。</Text><Text>④ 全主线 +100 分。每节点只计一次，失败只重置当前挑战；预算用尽另开免费行程保留收获。</Text><Text>收藏去小屋背包查看用途。单人无倒计时，游戏操作不计入真实饮水或运动记录。</Text><Button id='explore-help-close' className='pet-explore__button pet-explore__primary' onClick={() => setHelp(false)}>明白了</Button></View></View> : null}
  </View>
}
