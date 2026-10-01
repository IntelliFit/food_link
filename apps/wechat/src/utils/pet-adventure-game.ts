export type AdventureLane = -1 | 0 | 1
export interface AdventureLevel {
  id: number; name: string; chapterId: number; chapterName: string; description: string
  durationMs: number; speed: number; targetScore: number; sceneSpacing: number
}
export interface AdventureObstacle {
  id: string; lane: AdventureLane; distance: number; type: 'rock' | 'tree' | 'gap'; resolved: boolean
}
export interface AdventurePickup {
  id: string; lane: AdventureLane; distance: number; type: 'leaf' | 'star'; collected: boolean; resolved: boolean
}
export interface AdventureResult {
  levelId: number; completed: boolean; score: number; stars: 0 | 1 | 2 | 3; leaves: number
  collectedStars: number; hearts: number; distance: number; elapsedMs: number; experience: number
}
export interface AdventureGameState {
  status: 'ready' | 'running' | 'paused' | 'finished'; levelId: number; seed: number; elapsedMs: number
  remainingMs: number; pendingMs: number; distance: number; speed: number; lane: AdventureLane
  jumpRemainingMs: number; jumpHeight: number; dashRemainingMs: number; dashCharge: number
  hearts: number; invulnerableMs: number; score: number; combo: number; bestCombo: number
  leaves: number; collectedStars: number; obstacles: AdventureObstacle[]; pickups: AdventurePickup[]
  feedback: { kind: 'info' | 'success' | 'warning'; message: string; sequence: number }; result: AdventureResult | null
}
export type AdventureAction = { type: 'start' | 'pause' | 'resume' | 'move-left' | 'move-right' | 'jump' | 'dash' }

export const ADVENTURE_LEVELS: AdventureLevel[] = [
  { id: 1, name: '晨光初行', chapterId: 1, chapterName: '晨光林道', description: '跟随树叶出发，第一次起跳与冲刺。', durationMs: 45000, speed: 6, targetScore: 700, sceneSpacing: 22 },
  { id: 2, name: '林间回声', chapterId: 1, chapterName: '晨光林道', description: '避开树木，寻找藏在不同路线的星星。', durationMs: 45000, speed: 6.4, targetScore: 850, sceneSpacing: 20 },
  { id: 3, name: '溪谷石桥', chapterId: 2, chapterName: '石桥溪谷', description: '踏过石桥与溪沟，用起跳保持节奏。', durationMs: 50000, speed: 6.8, targetScore: 1000, sceneSpacing: 18 },
  { id: 4, name: '水岸追光', chapterId: 2, chapterName: '石桥溪谷', description: '安排换道与冲刺，把更多星光带回小屋。', durationMs: 50000, speed: 7.2, targetScore: 1200, sceneSpacing: 17 },
  { id: 5, name: '山径远望', chapterId: 3, chapterName: '云顶山径', description: '连绵山径考验判断，收集沿路的纪念。', durationMs: 60000, speed: 7.6, targetScore: 1500, sceneSpacing: 16 },
  { id: 6, name: '云端归途', chapterId: 3, chapterName: '云顶山径', description: '穿过最后一段旅途，带着伙伴的故事回家。', durationMs: 60000, speed: 8, targetScore: 1800, sceneSpacing: 15 },
]
const levelFor = (id: number) => ADVENTURE_LEVELS.find(level => level.id === id) || ADVENTURE_LEVELS[0]
const JUMP_MS = 900
const DASH_MS = 1200
const INVULNERABLE_MS = 1500
const FIXED_STEP_MS = 20
const DASH_MULTIPLIER = 1.6
const jumpHeightAt = (remainingMs: number) => remainingMs > 0 ? 4 * (1 - remainingMs / JUMP_MS) * (remainingMs / JUMP_MS) : 0

// Each handcrafted scene leaves at least one clear lane. Mirroring preserves that guarantee.
const SCENES: { lane: AdventureLane; type: AdventureObstacle['type'] }[][] = [
  [{ lane: 0, type: 'rock' }],
  [{ lane: 1, type: 'tree' }],
  [{ lane: -1, type: 'rock' }, { lane: 1, type: 'rock' }],
  [{ lane: 0, type: 'gap' }],
  [{ lane: -1, type: 'tree' }, { lane: 0, type: 'rock' }],
  [{ lane: 1, type: 'gap' }],
]

export function createAdventureGame(levelId = 1, seed?: number): AdventureGameState {
  const level = levelFor(levelId)
  const gameSeed = Number.isFinite(seed) ? Number(seed) >>> 0 : (20261001 * level.id) >>> 0
  let random = gameSeed
  const nextRandom = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random }
  const obstacles: AdventureObstacle[] = []
  const pickups: AdventurePickup[] = []
  const maximumDistance = level.speed * level.durationMs / 1000 * DASH_MULTIPLIER + level.sceneSpacing
  for (let scene = 0, distance = 20; distance <= maximumDistance; scene++, distance += level.sceneSpacing) {
    const mirror = nextRandom() % 2 ? 1 : -1
    const layout = SCENES[(scene + (level.chapterId - 1) * 2) % SCENES.length]
    const occupied = layout.map(item => item.lane * mirror as AdventureLane)
    layout.forEach((item, index) => obstacles.push({ id: `obstacle-${scene}-${index}`, lane: item.lane * mirror as AdventureLane, distance, type: item.type, resolved: false }))
    const safe = ([-1, 0, 1] as AdventureLane[]).filter(lane => !occupied.includes(lane))
    const pickupLane = safe[nextRandom() % safe.length]
    for (let index = 0; index < 3; index++) pickups.push({ id: `leaf-${scene}-${index}`, lane: pickupLane, distance: distance - 9 + index * 3, type: 'leaf', collected: false, resolved: false })
    if (scene % 2 === 0) pickups.push({ id: `star-${scene}`, lane: pickupLane, distance: distance + 3, type: 'star', collected: false, resolved: false })
  }
  return { status: 'ready', levelId: level.id, seed: gameSeed, elapsedMs: 0, remainingMs: level.durationMs,
    pendingMs: 0, distance: 0, speed: level.speed, lane: 0, jumpRemainingMs: 0, jumpHeight: 0,
    dashRemainingMs: 0, dashCharge: 100, hearts: 3, invulnerableMs: 0, score: 0, combo: 0, bestCombo: 0,
    leaves: 0, collectedStars: 0, obstacles, pickups,
    feedback: { kind: 'info', message: '左右换道、起跳跨越；冲刺可以撞碎岩石，树木仍要避开。', sequence: 0 }, result: null }
}

function feedback(state: AdventureGameState, kind: AdventureGameState['feedback']['kind'], message: string): AdventureGameState {
  state.feedback = { kind, message, sequence: state.feedback.sequence + 1 }; return state
}
function finish(state: AdventureGameState, completed: boolean): void {
  const level = levelFor(state.levelId)
  let stars: AdventureResult['stars'] = completed ? 1 : 0
  if (completed && state.score >= level.targetScore) stars = 2
  if (completed && state.score >= level.targetScore * 1.4 && state.hearts === 3) stars = 3
  const experience = Math.min(80, Math.floor(state.score / 100) + state.leaves + (completed ? 20 : 0))
  state.status = 'finished'; state.pendingMs = 0
  state.result = { levelId: level.id, completed, score: state.score, stars, leaves: state.leaves,
    collectedStars: state.collectedStars, hearts: state.hearts, distance: Math.round(state.distance * 100) / 100,
    elapsedMs: state.elapsedMs, experience }
  feedback(state, completed ? 'success' : 'info', completed ? '旅途完成，把沿路的收获带回小屋。' : '伙伴歇一会儿吧，换条路线再出发。')
}

export function applyAdventureAction(original: AdventureGameState, action: AdventureAction): AdventureGameState {
  if (original.status === 'finished') return original
  if (action.type === 'start') return original.status === 'ready' ? feedback({ ...original, status: 'running' }, 'info', '出发啦！跟着树叶探索三条路线。') : original
  if (action.type === 'pause') return original.status === 'running' ? { ...original, status: 'paused' } : original
  if (action.type === 'resume') return original.status === 'paused' ? { ...original, status: 'running' } : original
  if (original.status !== 'running') return original
  const state = { ...original }
  switch (action.type) {
    case 'move-left': state.lane = Math.max(-1, state.lane - 1) as AdventureLane; return state
    case 'move-right': state.lane = Math.min(1, state.lane + 1) as AdventureLane; return state
    case 'jump':
      if (state.jumpRemainingMs > 0) return original
      state.jumpRemainingMs = JUMP_MS; state.jumpHeight = 0
      return feedback(state, 'info', '起跳！岩石与溪沟都可以跃过。')
    case 'dash':
      if (state.dashRemainingMs > 0 || state.dashCharge < 100) return feedback(state, 'info', '收集树叶补充冲刺能量，能量满后再冲刺。')
      state.dashCharge -= 100; state.dashRemainingMs = DASH_MS; state.speed = levelFor(state.levelId).speed * DASH_MULTIPLIER
      return feedback(state, 'success', '冲刺！可以撞碎岩石，树木与溪沟仍要避开。')
    default: return original
  }
}

function addScore(state: AdventureGameState, base: number): void {
  state.score += Math.round(base * (1 + Math.min(10, state.combo) * 0.05))
  state.combo += 1; state.bestCombo = Math.max(state.bestCombo, state.combo)
}

function simulateStep(state: AdventureGameState, step: number): void {
  const level = levelFor(state.levelId)
  const beforeDistance = state.distance
  const jumpingBefore = state.jumpRemainingMs
  const dashingBefore = state.dashRemainingMs
  const invulnerableBefore = state.invulnerableMs
  const dashTime = Math.min(step, dashingBefore)
  state.distance += level.speed * (step + dashTime * (DASH_MULTIPLIER - 1)) / 1000
  state.elapsedMs += step; state.remainingMs = Math.max(0, level.durationMs - state.elapsedMs)
  state.jumpRemainingMs = Math.max(0, jumpingBefore - step); state.jumpHeight = jumpHeightAt(state.jumpRemainingMs)
  state.dashRemainingMs = Math.max(0, dashingBefore - step)
  state.speed = level.speed * (state.dashRemainingMs > 0 ? DASH_MULTIPLIER : 1)
  state.invulnerableMs = Math.max(0, invulnerableBefore - step)
  const events: ({ kind: 'obstacle'; item: AdventureObstacle } | { kind: 'pickup'; item: AdventurePickup })[] = [
    ...state.obstacles.filter(item => !item.resolved && item.distance >= beforeDistance && item.distance <= state.distance).map(item => ({ kind: 'obstacle' as const, item })),
    ...state.pickups.filter(item => !item.resolved && item.distance >= beforeDistance && item.distance <= state.distance).map(item => ({ kind: 'pickup' as const, item })),
  ].sort((a, b) => a.item.distance - b.item.distance)
  for (const event of events) {
    const item = event.item
    item.resolved = true
    const crossingDistance = item.distance - beforeDistance
    const dashDistance = level.speed * DASH_MULTIPLIER * dashTime / 1000
    const atMs = crossingDistance <= dashDistance ? crossingDistance / (level.speed * DASH_MULTIPLIER) * 1000
      : dashTime + (crossingDistance - dashDistance) / level.speed * 1000
    if (event.kind === 'pickup') {
      if (item.lane !== state.lane) continue
      event.item.collected = true
      if (event.item.type === 'leaf') { state.leaves += 1; state.dashCharge = Math.min(100, state.dashCharge + 8); addScore(state, 10) }
      else { state.collectedStars += 1; addScore(state, 30); feedback(state, 'success', '拾到星光，带回小屋可以兑换收藏。') }
      continue
    }
    const obstacle = event.item
    const airborne = jumpHeightAt(Math.max(0, jumpingBefore - atMs)) >= 0.35
    const dashing = dashingBefore > atMs
    if (item.lane !== state.lane || ((obstacle.type === 'rock' || obstacle.type === 'gap') && airborne)) { addScore(state, 20); continue }
    if (obstacle.type === 'rock' && dashing) { addScore(state, 50); feedback(state, 'success', '岩石突破！保持节奏继续探索。'); continue }
    if (invulnerableBefore > atMs || state.invulnerableMs > step - atMs) continue
    state.hearts = Math.max(0, state.hearts - 1); state.combo = 0
    state.invulnerableMs = INVULNERABLE_MS - (step - atMs)
    feedback(state, 'warning', obstacle.type === 'tree' ? '碰到树木了，树木需要左右换道。' : obstacle.type === 'gap' ? '溪沟要起跳跨越，冲刺不能代替起跳。' : '碰到岩石了，起跳或蓄满能量冲刺都可以。')
    if (state.hearts === 0) { finish(state, false); return }
  }
  if (state.elapsedMs >= level.durationMs) finish(state, true)
}

/** Fixed-step physics carry partial milliseconds, so long frames cannot skip collisions. */
export function advanceAdventureGame(original: AdventureGameState, deltaMs: number): AdventureGameState {
  if (original.status !== 'running' || !Number.isFinite(deltaMs) || deltaMs < 1) return original
  const state: AdventureGameState = { ...original, obstacles: original.obstacles.map(item => ({ ...item })), pickups: original.pickups.map(item => ({ ...item })) }
  state.pendingMs += Math.floor(deltaMs)
  while (state.pendingMs >= FIXED_STEP_MS && state.status === 'running') {
    const step = Math.min(FIXED_STEP_MS, state.remainingMs)
    state.pendingMs -= step
    simulateStep(state, step)
  }
  return state
}
