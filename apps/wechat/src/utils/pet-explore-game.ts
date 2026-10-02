/** 水岸寻宝的纯单人规则。行动、谜题和收线结果均由实际输入产生。 */
export type ExploreSymbol = 'leaf' | 'circle' | 'wave' | 'flower'
export type ExplorePort = 0 | 1 | 2 | 3 // 上、右、下、左
export interface ExploreCanal { cells: [number, number][]; ports: [ExplorePort, ExplorePort][]; initial: number[] }
export interface ExploreNode {
  id: string; name: string; x: number; y: number; kind: 'camp' | 'view' | 'clue' | 'canal' | 'slate' | 'treasure'
  text: string; requires?: string[]; canal?: ExploreCanal; pattern?: ExploreSymbol[]; orderPattern?: boolean
  collectible?: string; rhythm?: 'gentle' | 'surge'
}
export interface ExploreLevel {
  id: number; name: string; description: string; budget: number; nodes: ExploreNode[]; edges: [string, string][]
  main: string[]; completionCollectibles: string[]; story: string; recipe: string
}
export interface ExploreHistory { claimed: string[]; clues: string[]; solved: string[]; collectibles: string[]; bonusClaimed: boolean }
export interface ExploreResult {
  game: 'explore'; levelId: number; score: number; completed: boolean; stars: number; collectibles: string[]
  detail: Record<string, number>; landmarks?: string[]
}
export interface ExploreGameState extends ExploreHistory {
  levelId: number; status: 'ready' | 'running' | 'paused' | 'finished'; nodeId: string; remaining: number
  phase: 'map' | 'canal' | 'slate' | 'haul'; rotations: number[]; sequence: ExploreSymbol[]
  haul: { progress: number; tension: number; pulling: boolean; elapsedMs: number; pullMs: number; safePullMs: number }
  score: number; newCollectibles: string[]; moves: number; discovered: number; puzzles: number; treasures: number; qualityPoints: number
  haulFailures: number; puzzleFailures: number; feedback: string; result: ExploreResult | null
}
export type ExploreAction =
  | { type: 'start' | 'pause' | 'resume' | 'observe' | 'challenge' | 'check-canal' | 'reset-puzzle' | 'close-challenge' | 'finish' }
  | { type: 'move'; nodeId: string }
  | { type: 'rotate'; index: number }
  | { type: 'slate'; symbol: ExploreSymbol }
  | { type: 'pull'; value: boolean }

export const EXPLORE_SYMBOLS: Record<ExploreSymbol, { label: string; glyph: string }> = {
  leaf: { label: '叶', glyph: '♧' }, circle: { label: '圆', glyph: '○' }, wave: { label: '波', glyph: '≈' }, flower: { label: '花', glyph: '✿' },
}
export const EXPLORE_COLLECTIBLES: Record<string, string> = {
  'pebble-ornament': '鹅卵石摆件', 'waterside-memory-1': '第一段水岸记忆', 'reed-bottle': '芦苇瓶', 'drifting-letter': '漂流信故事',
  'travel-stamp': '旅行印章', 'bridge-mat': '桥纹地垫', 'bridge-memory': '石桥回声故事页', 'shell-frame-material': '贝壳相框材料',
  'shell-frame': '贝壳相框', driftwood: '浮木', 'garden-flower': '花台花束', 'driftwood-planter': '浮木花台',
  'waterside-album': '水岸纪念册', 'homecoming-chapter': '归航章节', 'waterside-memory': '水岸故事页',
}

const canal = (count: 3 | 4 | 5): ExploreCanal => count === 3
  ? { cells: [[0, 1], [1, 1], [1, 0]], ports: [[3, 1], [3, 0], [2, 0]], initial: [1, 2, 1] }
  : count === 4
    ? { cells: [[0, 1], [1, 1], [1, 0], [2, 0]], ports: [[3, 1], [3, 0], [2, 1], [3, 1]], initial: [3, 1, 2, 1] }
    : { cells: [[0, 2], [1, 2], [1, 1], [2, 1], [2, 0]], ports: [[3, 1], [3, 0], [2, 1], [3, 0], [2, 0]], initial: [1, 3, 1, 2, 1] }
const node = (id: string, name: string, kind: ExploreNode['kind'], x: number, y: number, text: string, extra: Partial<ExploreNode> = {}): ExploreNode => ({ id, name, kind, x, y, text, ...extra })

export const EXPLORE_LEVELS: ExploreLevel[] = [
  {
    id: 1, name: '浅滩拾光', description: '六个停靠点，一条线索，第一次把湖边的光带回家。', budget: 8,
    nodes: [node('camp', '营地', 'camp', 16, 80, '看看目标，选一条相邻路线出发。'), node('lookout', '观景石', 'view', 16, 47, '浮标向右，再往上，出口就在水渠尽头。'), node('clue', '浅滩石牌', 'clue', 47, 72, '石牌记着：浮标从左岸出发，沿弯道到上方出口。'), node('canal', '三块水渠', 'canal', 48, 38, '把浮标接到出口。', { requires: ['clue'], canal: canal(3) }), node('pebble', '拾光浅滩', 'treasure', 79, 22, '打捞一枚光滑鹅卵石。', { requires: ['clue', 'canal'], collectible: 'pebble-ornament', rhythm: 'gentle' }), node('rest', '湖边小径', 'view', 80, 69, '小径能绕回石牌，留下你的脚印。')],
    edges: [['camp', 'clue'], ['camp', 'lookout'], ['lookout', 'clue'], ['lookout', 'canal'], ['clue', 'canal'], ['clue', 'rest'], ['rest', 'canal'], ['canal', 'pebble']],
    main: ['pebble'], completionCollectibles: ['waterside-memory-1'], story: '伙伴捧起鹅卵石：“原来普通的小石头，也能记住一起出发的日子。”', recipe: '鹅卵石摆件可放小屋窗台；第一段水岸记忆收进故事册。',
  },
  {
    id: 2, name: '芦苇来信', description: '先到左岸看石牌，再选短水渠或稳定的岸边路线。', budget: 9,
    nodes: [node('camp', '营地', 'camp', 17, 82, '主线目标：右岸的芦苇瓶与漂流信。'), node('fork', '两岸岔口', 'view', 43, 73, '左边找石牌，右边通向短水渠与稳定点。'), node('clue', '左岸石牌', 'clue', 16, 43, '岸边图案依次是：叶、圆、叶。', { pattern: ['leaf', 'circle', 'leaf'] }), node('canal', '短路水渠', 'canal', 44, 39, '接通三块水渠，走近右岸。', { requires: ['clue'], canal: canal(3) }), node('slate', '右岸石板', 'slate', 72, 30, '按左岸石牌的顺序点石板。', { requires: ['clue'], pattern: ['leaf', 'circle', 'leaf'] }), node('letter', '漂流信', 'treasure', 80, 9, '把装着来信的芦苇瓶稳稳收起。', { requires: ['clue', 'slate'], collectible: 'reed-bottle', rhythm: 'surge' }), node('stable', '稳定浅湾', 'treasure', 79, 71, '这里的收线节奏平稳，可先练习收线。', { requires: ['clue'], collectible: 'travel-stamp', rhythm: 'gentle' })],
    edges: [['camp', 'fork'], ['fork', 'clue'], ['clue', 'canal'], ['fork', 'canal'], ['canal', 'slate'], ['fork', 'stable'], ['stable', 'slate'], ['slate', 'letter']],
    main: ['letter'], completionCollectibles: ['drifting-letter'], story: '信纸展开：“谢谢你找到我。沿着湖岸走，下一封信也许正在石桥等你。”', recipe: '芦苇瓶放小屋书桌；漂流信保存在故事册，旅行印章贴进纪念册。',
  },
  {
    id: 3, name: '石桥回声', description: '共用桥头入口，两侧各有一段水渠与一份记忆。', budget: 10,
    nodes: [node('camp', '营地', 'camp', 45, 86, '主线需取回左右两岸的宝物。'), node('bridge', '桥头交叉', 'view', 46, 55, '两侧入口共用桥头，先走哪一侧都可以。'), node('clue', '桥头碑文', 'clue', 45, 19, '两道水渠分别沿三块、四块石槽通到对岸。'), node('west-canal', '西岸水渠', 'canal', 18, 52, '三块水渠，接通西岸。', { requires: ['clue'], canal: canal(3) }), node('east-canal', '东岸水渠', 'canal', 74, 52, '四块水渠，接通东岸。', { requires: ['clue'], canal: canal(4) }), node('west-treasure', '桥纹拓片', 'treasure', 15, 18, '西岸留下古老的桥纹。', { requires: ['clue', 'west-canal'], collectible: 'bridge-mat', rhythm: 'gentle' }), node('east-treasure', '回声印章', 'treasure', 80, 18, '东岸留下旅途的回声。', { requires: ['clue', 'east-canal'], collectible: 'travel-stamp', rhythm: 'surge' }), node('rest', '桥下小径', 'view', 78, 81, '小径连接两侧入口，避免原路折返。')],
    edges: [['camp', 'bridge'], ['bridge', 'clue'], ['bridge', 'west-canal'], ['bridge', 'east-canal'], ['west-canal', 'west-treasure'], ['east-canal', 'east-treasure'], ['west-canal', 'rest'], ['rest', 'east-canal'], ['clue', 'west-canal'], ['clue', 'east-canal']],
    main: ['west-treasure', 'east-treasure'], completionCollectibles: ['bridge-memory'], story: '两个印记拼在一起，伙伴听见石桥回声：“每一次折返，都为了和你再走一段。”', recipe: '桥纹地垫摆在小屋门口；旅行印章与回声故事页收进纪念册。',
  },
  {
    id: 4, name: '月湾浮标', description: '近湾平缓，远湾起伏。双藏宝点考验路线和收线节奏。', budget: 12,
    nodes: [node('camp', '营地', 'camp', 14, 82, '主线需拿到近湾材料与远湾相框。'), node('fork', '月湾岔口', 'view', 41, 70, '近湾张力平缓；远湾每三秒会改变拉力。'), node('clue', '月光石牌', 'clue', 16, 42, '石板顺序：圆、波、圆。远湾浮标由四块水渠引导。', { pattern: ['circle', 'wave', 'circle'] }), node('slate', '近湾石板', 'slate', 43, 36, '依照月光石牌开通近湾。', { requires: ['clue'], pattern: ['circle', 'wave', 'circle'] }), node('near', '近湾贝壳', 'treasure', 43, 13, '平缓水面下是相框材料。', { requires: ['clue', 'slate'], collectible: 'shell-frame-material', rhythm: 'gentle' }), node('canal', '远湾水渠', 'canal', 74, 67, '旋转四块水渠。', { requires: ['clue'], canal: canal(4) }), node('lookout', '浮标观测点', 'view', 79, 37, '听水声，起伏时松开收线，安全时再继续。'), node('far', '远湾相框', 'treasure', 80, 12, '此处张力有平缓与浪涌两种节奏。', { requires: ['clue', 'canal'], collectible: 'shell-frame', rhythm: 'surge' })],
    edges: [['camp', 'fork'], ['fork', 'clue'], ['clue', 'slate'], ['fork', 'slate'], ['slate', 'near'], ['fork', 'canal'], ['canal', 'lookout'], ['lookout', 'far'], ['slate', 'lookout'], ['near', 'lookout']],
    main: ['near', 'far'], completionCollectibles: [], story: '伙伴把相框朝向月亮：“这里留一个位置，下次放我们的合照。”', recipe: '贝壳相框放小屋墙面，材料保存在背包，不会自动出售。',
  },
  {
    id: 5, name: '雨后花园', description: '线索的发现顺序会改变石板密码。收齐浮木与花束做花台。', budget: 10,
    nodes: [node('camp', '营地', 'camp', 14, 82, '花台需要浮木和花束；先决定从哪枚标记找起。'), node('fork', '花园入口', 'view', 44, 75, '两枚线索都要找，石板按“先发现、后发现”交替四次。'), node('leaf-clue', '雨滴叶标', 'clue', 15, 44, '这枚标记是“叶”。与另一枚标记按发现顺序交替四次。', { pattern: ['leaf'] }), node('flower-clue', '岸边花标', 'clue', 74, 76, '这枚标记是“花”。与另一枚标记按发现顺序交替四次。', { pattern: ['flower'] }), node('slate', '雨后石板', 'slate', 45, 39, '先后两枚图案交替四次。', { requires: ['leaf-clue', 'flower-clue'], orderPattern: true }), node('wood', '浮木停靠点', 'treasure', 16, 12, '先捞浮木，也可先去花束停靠点。', { requires: ['leaf-clue', 'flower-clue', 'slate'], collectible: 'driftwood', rhythm: 'gentle' }), node('flower', '花束停靠点', 'treasure', 79, 12, '收回花束，让小屋花台开花。', { requires: ['leaf-clue', 'flower-clue', 'slate'], collectible: 'garden-flower', rhythm: 'surge' }), node('lookout', '雨后小径', 'view', 79, 43, '小径连接线索、石板与花束；按所缺材料选择下一站。')],
    edges: [['camp', 'fork'], ['fork', 'leaf-clue'], ['fork', 'flower-clue'], ['leaf-clue', 'slate'], ['flower-clue', 'slate'], ['flower-clue', 'lookout'], ['lookout', 'slate'], ['slate', 'wood'], ['slate', 'flower'], ['wood', 'flower'], ['lookout', 'flower']],
    main: ['wood', 'flower'], completionCollectibles: ['driftwood-planter'], story: '浮木与花束变成一座花台。伙伴说：“雨停了，我们的小屋也有了花园。”', recipe: '浮木 ×1 ＋ 花束 ×1 → 浮木花台，放在小屋窗边；制作不额外扣星光。',
  },
  {
    id: 6, name: '归航纪念', description: '九个节点、组合谜题，三条主线可按已有收藏选择顺序。', budget: 12,
    nodes: [node('camp', '归航营地', 'camp', 46, 85, '三条主线：印章、相框与故事页。任选一条开始，续程保留已有成果。'), node('fork', '归航路口', 'view', 46, 57, '主线共用线索和谜题；解开后选择三个藏宝点。'), node('clue', '归航碑文', 'clue', 15, 71, '石板顺序：波、叶、圆、花；水渠从左侧浮标连向上方出口。', { pattern: ['wave', 'leaf', 'circle', 'flower'] }), node('canal', '五块水渠', 'canal', 16, 38, '五块水渠先接通归航水道。', { requires: ['clue'], canal: canal(5) }), node('slate', '纪念石板', 'slate', 47, 28, '水渠接通后，按碑文点出四枚图案。', { requires: ['clue', 'canal'], pattern: ['wave', 'leaf', 'circle', 'flower'] }), node('stamp', '印章航线', 'treasure', 15, 9, '平缓航线带回旅行印章。', { requires: ['clue', 'canal', 'slate'], collectible: 'travel-stamp', rhythm: 'gentle' }), node('frame', '相框航线', 'treasure', 78, 10, '起伏航线带回贝壳相框。', { requires: ['clue', 'canal', 'slate'], collectible: 'shell-frame', rhythm: 'surge' }), node('story', '故事航线', 'treasure', 80, 48, '最后一页故事等待归航。', { requires: ['clue', 'canal', 'slate'], collectible: 'waterside-memory', rhythm: 'surge' }), node('rest', '归航小径', 'view', 79, 78, '小径连接故事航线，留出从容返航的选择。')],
    edges: [['camp', 'fork'], ['fork', 'clue'], ['clue', 'canal'], ['canal', 'slate'], ['fork', 'slate'], ['slate', 'stamp'], ['slate', 'frame'], ['slate', 'story'], ['stamp', 'frame'], ['frame', 'story'], ['fork', 'rest'], ['rest', 'story'], ['canal', 'stamp']],
    main: ['stamp', 'frame', 'story'], completionCollectibles: ['waterside-album', 'homecoming-chapter'], story: '纪念册合上，又留下一页空白。伙伴轻轻挥手：“回家吧。下次，还一起出发。”', recipe: '旅行印章、相框与故事页收入水岸纪念册；完整纪念册放小屋书架。',
  },
]

export const exploreLevel = (levelId: number): ExploreLevel => EXPLORE_LEVELS.find(level => level.id === levelId) || EXPLORE_LEVELS[0]
export const exploreNode = (state: ExploreGameState): ExploreNode => exploreLevel(state.levelId).nodes.find(item => item.id === state.nodeId)!
export function exploreNeighbors(state: ExploreGameState): string[] {
  return exploreLevel(state.levelId).edges.flatMap(([a, b]) => a === state.nodeId ? [b] : b === state.nodeId ? [a] : [])
}
export function exploreMissing(state: ExploreGameState, target = exploreNode(state)): string[] {
  return (target.requires || []).filter(id => !state.clues.includes(id) && !state.solved.includes(id))
}
export function exploreSlatePattern(state: ExploreGameState, target = exploreNode(state)): ExploreSymbol[] {
  if (!target.orderPattern) return target.pattern || []
  const clues = state.clues.filter(id => (target.requires || []).includes(id))
  const first = exploreLevel(state.levelId).nodes.find(item => item.id === clues[0])?.pattern?.[0]
  const second = exploreLevel(state.levelId).nodes.find(item => item.id === clues[1])?.pattern?.[0]
  return first && second ? [first, second, first, second] : []
}
export function exploreCanalPorts(target: ExploreNode, rotations: number[], index: number): ExplorePort[] {
  return (target.canal?.ports[index] || []).map(port => ((port + (rotations[index] || 0)) % 4) as ExplorePort)
}
export function isExploreCanalConnected(target: ExploreNode, rotations: number[]): boolean {
  return Boolean(target.canal) && target.canal!.ports.every((ports, index) => {
    const actual = exploreCanalPorts(target, rotations, index)
    return ports.every(port => actual.includes(port))
  })
}

export function createExploreGame(levelId = 1, history?: ExploreHistory): ExploreGameState {
  const level = exploreLevel(levelId)
  // 只接受该地图节点；跨地图的已领 ID 不能解开主线。
  const known = new Set(level.nodes.map(item => item.id))
  return {
    levelId: level.id, status: 'ready', nodeId: 'camp', remaining: level.budget, phase: 'map', rotations: [], sequence: [],
    claimed: (history?.claimed || []).filter(id => known.has(id)), clues: (history?.clues || []).filter(id => known.has(id)),
    solved: (history?.solved || []).filter(id => known.has(id)), collectibles: [...(history?.collectibles || [])], bonusClaimed: history?.bonusClaimed || false,
    haul: { progress: 0, tension: 30, pulling: false, elapsedMs: 0, pullMs: 0, safePullMs: 0 },
    score: 0, newCollectibles: [], moves: 0, discovered: 0, puzzles: 0, treasures: 0, qualityPoints: 0, haulFailures: 0, puzzleFailures: 0,
    feedback: '移动到相邻节点花 1 点行动；线索可随时免费重看。', result: null,
  }
}
export function exploreHistory(state: ExploreGameState): ExploreHistory {
  return { claimed: [...state.claimed], clues: [...state.clues], solved: [...state.solved], collectibles: [...state.collectibles], bonusClaimed: state.bonusClaimed }
}
export function continueExploreGame(state: ExploreGameState): ExploreGameState { return createExploreGame(state.levelId, exploreHistory(state)) }
/** 后续 checkpoint API 可保存此快照；当前组件不自行写本机或云端存档。 */
export function exportExploreCheckpoint(state: ExploreGameState): { version: 1; game: 'explore'; state: ExploreGameState } {
  return { version: 1, game: 'explore', state: JSON.parse(JSON.stringify(state)) as ExploreGameState }
}

function clone(state: ExploreGameState): ExploreGameState {
  return { ...state, claimed: [...state.claimed], clues: [...state.clues], solved: [...state.solved], collectibles: [...state.collectibles], newCollectibles: [...state.newCollectibles], rotations: [...state.rotations], sequence: [...state.sequence], haul: { ...state.haul } }
}
function addCollectible(state: ExploreGameState, id: string) {
  if (state.collectibles.includes(id)) return
  state.collectibles.push(id)
  state.newCollectibles.push(id)
}
function completeBonus(state: ExploreGameState) {
  const level = exploreLevel(state.levelId)
  if (state.bonusClaimed || !level.main.every(id => state.claimed.includes(id))) return
  state.bonusClaimed = true
  state.score += 100
  level.completionCollectibles.forEach(id => addCollectible(state, id))
  state.feedback += ' 全部主线完成 +100 分，故事已收进纪念册。'
}
function finish(state: ExploreGameState): ExploreGameState {
  state.status = 'finished'
  state.haul.pulling = false
  const completed = exploreLevel(state.levelId).main.every(id => state.claimed.includes(id))
  const averageQuality = state.treasures > 0 ? state.qualityPoints / state.treasures : 0
  const clean = state.haulFailures + state.puzzleFailures === 0
  const efficient = state.moves <= Math.ceil(exploreLevel(state.levelId).budget * .75)
  state.result = {
    game: 'explore', levelId: state.levelId, score: state.score, completed,
    // 评价星级与奖励星光分开；星光由统一结算层核算。
    stars: !completed || state.treasures === 0 ? 0 : clean && efficient && averageQuality >= 40 ? 3 : averageQuality >= 20 ? 2 : 1, collectibles: [...state.newCollectibles],
    // Cumulative node sources let the shared ledger deduplicate level:node across exits and continuations.
    landmarks: [...state.claimed],
    detail: { moves: state.moves, nodes: state.discovered + state.puzzles + state.treasures, clues: state.discovered, puzzles: state.puzzles, treasures: state.treasures, qualityPoints: state.qualityPoints, haulFailures: state.haulFailures, puzzleFailures: state.puzzleFailures, remaining: state.remaining },
  }
  return state
}
function claim(state: ExploreGameState, target: ExploreNode, points: number) {
  if (state.claimed.includes(target.id)) return
  state.claimed.push(target.id)
  state.score += points
  state.phase = 'map'
  state.haul.pulling = false
  if (target.kind === 'clue') { state.clues.push(target.id); state.discovered += 1 }
  else if (target.kind === 'canal' || target.kind === 'slate') { state.solved.push(target.id); state.puzzles += 1 }
  else if (target.kind === 'treasure') { state.treasures += 1; if (target.collectible) addCollectible(state, target.collectible) }
  completeBonus(state)
  if (state.remaining === 0) finish(state)
}

export function applyExploreAction(previous: ExploreGameState, action: ExploreAction): ExploreGameState {
  if (action.type === 'start') return previous.status === 'ready' ? { ...previous, status: 'running' } : previous
  if (action.type === 'pause') return previous.status === 'running' ? { ...previous, status: 'paused', haul: { ...previous.haul, pulling: false } } : previous
  if (action.type === 'resume') return previous.status === 'paused' ? { ...previous, status: 'running' } : previous
  if (previous.status !== 'running') return previous
  const state = clone(previous)
  const target = exploreNode(state)
  if (action.type === 'finish') return state.moves > 0 ? finish(state) : previous
  if (action.type === 'move') {
    if (state.phase !== 'map' || state.remaining <= 0 || !exploreNeighbors(state).includes(action.nodeId)) return previous
    state.nodeId = action.nodeId
    state.remaining -= 1
    state.moves += 1
    const next = exploreNode(state)
    state.feedback = `抵达${next.name}，消耗 1 点行动。`
    if (state.remaining === 0 && (state.claimed.includes(next.id) || next.kind === 'camp' || next.kind === 'view' || exploreMissing(state, next).length > 0)) return finish(state)
    return state
  }
  if (action.type === 'observe') {
    if (state.phase !== 'map' || target.kind !== 'clue') return previous
    state.feedback = target.text + (state.claimed.includes(target.id) ? ' 已记录，重看不消耗行动，也不重复计分。' : ' 发现线索 +50 分。')
    claim(state, target, 50)
    return state
  }
  if (action.type === 'close-challenge') { state.phase = 'map'; state.haul.pulling = false; return state }
  if (action.type === 'challenge') {
    if (state.phase !== 'map' || !['canal', 'slate', 'treasure'].includes(target.kind) || state.claimed.includes(target.id)) return previous
    const missing = exploreMissing(state)
    if (missing.length) { state.feedback = `还需要：${missing.map(id => exploreLevel(state.levelId).nodes.find(item => item.id === id)?.name).join('、')}。先找到线索，不能跳过探索。`; return state }
    state.phase = target.kind === 'treasure' ? 'haul' : target.kind as 'canal' | 'slate'
    state.rotations = [...(target.canal?.initial || [])]
    state.sequence = []
    state.haul = { progress: 0, tension: 30, pulling: false, elapsedMs: 0, pullMs: 0, safePullMs: 0 }
    state.feedback = target.kind === 'treasure' ? '按住收线，松开降张力；纹理区 20–65 最稳。' : target.text
    return state
  }
  if (action.type === 'rotate') {
    if (state.phase !== 'canal' || !Number.isInteger(action.index) || action.index < 0 || action.index >= state.rotations.length) return previous
    state.rotations[action.index] = (state.rotations[action.index] + 1) % 4
    return state
  }
  if (action.type === 'reset-puzzle') {
    if (state.phase !== 'canal' && state.phase !== 'slate') return previous
    state.rotations = [...(target.canal?.initial || [])]; state.sequence = []
    state.feedback = '当前谜题已重置；线索、宝物与行动点保持。'
    return state
  }
  if (action.type === 'check-canal') {
    if (state.phase !== 'canal') return previous
    if (isExploreCanalConnected(target, state.rotations)) { state.feedback = '浮标到达出口！完成谜题 +100 分。'; claim(state, target, 100) }
    else { state.puzzleFailures += 1; state.rotations = [...(target.canal?.initial || [])]; state.feedback = '水渠还没连通：检查各块出口方向。只重置当前水渠，不扣行动点。' }
    return state
  }
  if (action.type === 'slate') {
    if (state.phase !== 'slate' || !EXPLORE_SYMBOLS[action.symbol]) return previous
    const pattern = exploreSlatePattern(state)
    if (action.symbol !== pattern[state.sequence.length]) { state.sequence = []; state.puzzleFailures += 1; state.feedback = '图案顺序不对，当前石板已重置。可免费重看已发现线索。'; return state }
    state.sequence.push(action.symbol)
    if (state.sequence.length === pattern.length) { state.feedback = '岸边石板亮起！完成谜题 +100 分。'; claim(state, target, 100) }
    return state
  }
  if (action.type === 'pull') {
    if (state.phase !== 'haul') return previous
    state.haul.pulling = action.value
    return state
  }
  return previous
}

export function advanceExploreGame(previous: ExploreGameState, deltaMs: number): ExploreGameState {
  if (previous.status !== 'running' || previous.phase !== 'haul' || !Number.isFinite(deltaMs) || deltaMs <= 0) return previous
  const state = clone(previous)
  const target = exploreNode(state)
  // 收线固定 50ms 子步，长帧也会检查每次张力越界；单人地图不计时。
  let remainingMs = Math.min(deltaMs, 60000)
  while (remainingMs > 0 && state.phase === 'haul' && state.status === 'running') {
    const step = Math.min(50, remainingMs)
    const h = state.haul
    const rate = target.rhythm === 'surge' && Math.floor(h.elapsedMs / 3000) % 2 === 1 ? 20 : target.rhythm === 'surge' ? 10 : 8
    h.elapsedMs += step
    if (h.pulling) {
      h.pullMs += step
      if (h.tension >= 20 && h.tension <= 65) h.safePullMs += step
      h.progress = Math.min(100, h.progress + step / 80)
      h.tension = Math.min(100, h.tension + rate * step / 1000)
    } else h.tension = Math.max(0, h.tension - 25 * step / 1000)
    if (h.tension >= 100) {
      state.haulFailures += 1
      state.haul = { progress: 0, tension: 30, pulling: false, elapsedMs: 0, pullMs: 0, safePullMs: 0 }
      state.feedback = '张力到达 100，物件落回原点。线索和已收获物保留，原地重试不扣行动。'
      break
    }
    if (h.progress >= 100) {
      const quality = Math.max(0, Math.min(50, Math.floor(50 * h.safePullMs / Math.max(1, h.pullMs))))
      state.qualityPoints += quality
      state.feedback = `打捞成功：${EXPLORE_COLLECTIBLES[target.collectible || ''] || target.name}，+${100 + quality} 分（品质 +${quality}）。`
      claim(state, target, 100 + quality)
    }
    remainingMs -= step
  }
  return state
}
