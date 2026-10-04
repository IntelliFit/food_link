import { adventureLevel, type AdventureResult } from './pet-adventure-game'

export interface DashObstacle { id: string; distance: number; type: 'rock' | 'tree'; resolved: boolean; cleared: boolean; collectible?: string }
export interface DashResult extends AdventureResult { successfulJumps: number; jumpInputs: number; bestCombo: number; perfects: number }
export interface DashState {
  status: 'ready' | 'running' | 'paused' | 'finished'; levelId: number; distance: number; elapsedMs: number; pendingMs: number
  jumpRemainingMs: number; jumpHeight: number; jumpInputs: number; successfulJumps: number; perfects: number
  hearts: number; score: number; combo: number; bestCombo: number; feverRemainingMs: number; feverCharge: number
  obstacles: DashObstacle[]; collectibles: string[]; feedback: { sequence: number; kind: 'info' | 'perfect' | 'clear' | 'miss'; text: string }
  result: DashResult | null
}
export const DASH_DURATION_MS = 30000
export const DASH_JUMP_MS = 850
export const DASH_SPEED = 10
export function createDashGame(levelId = 1): DashState {
  const level = adventureLevel(levelId)
  return {
    status: 'ready', levelId: level.id, distance: 0, elapsedMs: 0, pendingMs: 0, jumpRemainingMs: 0, jumpHeight: 0,
    jumpInputs: 0, successfulJumps: 0, perfects: 0, hearts: 3, score: 0, combo: 0, bestCombo: 0, feverRemainingMs: 0, feverCharge: 0,
    obstacles: Array.from({ length: 12 }, (_, i) => ({ id: `dash:${level.id}:${i}`, distance: 18 + i * 24 + (i > 0 ? (level.id - 1) * (i % 2 ? 1 : -1) : 0), type: i % 3 === 0 ? 'tree' : 'rock', resolved: false, cleared: false, ...(i % 4 === 3 ? { collectible: level.scenes[Math.floor(i / 4)].collectibleId } : {}) })),
    collectibles: [], feedback: { sequence: 0, kind: 'info', text: '点一下起跳，越过石头；连着跳准三次，进入双倍时刻。' }, result: null,
  }
}
function say(state: DashState, kind: DashState['feedback']['kind'], text: string) { state.feedback = { sequence: state.feedback.sequence + 1, kind, text } }
function finish(state: DashState, completed: boolean) {
  const level = adventureLevel(state.levelId)
  const earned = state.successfulJumps > 0
  state.status = 'finished'; state.pendingMs = 0
  if (completed && earned) state.collectibles = [...new Set([...state.collectibles, `adventure-story-${level.id}`])]
  state.result = {
    levelId: level.id, completed: completed && earned, score: state.score, stars: !completed || !earned ? 0 : state.hearts === 3 ? 3 : state.hearts === 2 ? 2 : 1,
    leaves: state.successfulJumps, collectedStars: state.perfects, hearts: state.hearts, distance: state.distance, elapsedMs: state.elapsedMs,
    experience: earned ? 10 : 0, collectibleIds: [...state.collectibles], recoveries: 3 - state.hearts, completedScenes: Math.floor(state.distance / 100),
    successfulJumps: state.successfulJumps, jumpInputs: state.jumpInputs, bestCombo: state.bestCombo, perfects: state.perfects,
  }
  say(state, completed && earned ? 'clear' : 'info', completed && earned ? '到家了，看看这一程亲手赢回的纪念。' : earned ? '这次的收获留下了。再来，试着多连一次！' : '石头到面前时点一下起跳，再试一次。')
}
export function dashAction(original: DashState, action: 'start' | 'jump' | 'pause' | 'resume'): DashState {
  if (action === 'start') return original.status === 'ready' ? { ...original, status: 'running' } : original
  if (action === 'pause') return original.status === 'running' ? { ...original, status: 'paused' } : original
  if (action === 'resume') return original.status === 'paused' ? { ...original, status: 'running' } : original
  if (original.status !== 'running' || original.jumpRemainingMs > 0) return original
  return { ...original, jumpRemainingMs: DASH_JUMP_MS, jumpInputs: original.jumpInputs + 1 }
}
/** Every crossing is resolved in 10 ms steps. Long frames cannot skip hazards or mint extra collections. */
export function advanceDashGame(original: DashState, deltaMs: number): DashState {
  if (original.status !== 'running' || !Number.isFinite(deltaMs) || deltaMs < 1) return original
  const state: DashState = { ...original, obstacles: original.obstacles.map(item => ({ ...item })), collectibles: [...original.collectibles], pendingMs: original.pendingMs + Math.min(DASH_DURATION_MS, Math.floor(deltaMs)) }
  while (state.pendingMs >= 10 && state.status === 'running') {
    state.pendingMs -= 10; state.elapsedMs += 10; state.distance = Math.min(300, state.elapsedMs * DASH_SPEED / 1000)
    state.jumpRemainingMs = Math.max(0, state.jumpRemainingMs - 10)
    const t = 1 - state.jumpRemainingMs / DASH_JUMP_MS
    state.jumpHeight = state.jumpRemainingMs > 0 ? 4 * t * (1 - t) : 0
    state.feverRemainingMs = Math.max(0, state.feverRemainingMs - 10)
    for (const obstacle of state.obstacles) {
      if (obstacle.resolved || obstacle.distance > state.distance) continue
      obstacle.resolved = true
      if (state.jumpHeight >= .42) {
        obstacle.cleared = true; state.successfulJumps += 1; state.combo += 1; state.bestCombo = Math.max(state.bestCombo, state.combo)
        const perfect = state.jumpHeight >= .88
        if (perfect) { state.perfects += 1; state.feverCharge += 1 }
        else state.feverCharge = 0
        state.score += (perfect ? 100 : 60) * (state.feverRemainingMs > 0 ? 2 : 1) + Math.min(state.combo, 10) * 10
        if (obstacle.collectible) state.collectibles = [...new Set([...state.collectibles, obstacle.collectible])]
        if (state.feverCharge >= 3) { state.feverCharge = 0; state.feverRemainingMs = 5000; say(state, 'perfect', '三次跳准！双倍时刻 · 5 秒') }
        else say(state, perfect ? 'perfect' : 'clear', obstacle.collectible ? '纪念到手！这一跳带回家。' : perfect ? `跳得漂亮！${state.combo} 连击` : `越过了！${state.combo} 连击`)
      } else {
        state.hearts -= 1; state.combo = 0; state.feverCharge = 0; state.feverRemainingMs = 0
        say(state, 'miss', '擦到了，稳住！已经拿到的纪念还在。')
        if (state.hearts <= 0) { finish(state, false); break }
      }
    }
    if (state.status === 'running' && state.elapsedMs >= DASH_DURATION_MS) finish(state, true)
  }
  return state
}
