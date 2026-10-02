export type AdventureLane = -1 | 0 | 1
export type AdventureMechanismType = 'root' | 'slope' | 'wind' | 'box' | 'platform' | 'home'
export interface AdventureScene { id: string; name: string; mechanism: AdventureMechanismType; description: string; collectibleId: string; collectibleName: string; safeBypass: boolean }
export interface AdventureLevel {
  id: number; name: string; chapterId: number; chapterName: string; description: string
  durationMs: number; speed: number; targetScore: number; sceneSpacing: number; scenes: AdventureScene[]
}
export interface AdventureObstacle { id: string; lane: AdventureLane; distance: number; type: 'rock' | 'tree' | 'gap'; resolved: boolean }
export interface AdventurePickup { id: string; lane: AdventureLane; distance: number; type: 'leaf' | 'star'; collected: boolean; resolved: boolean }
export interface AdventureResult {
  levelId: number; completed: boolean; score: number; stars: 0 | 1 | 2 | 3; leaves: number
  collectedStars: number; hearts: number; distance: number; elapsedMs: number; experience: number
  collectibleIds?: string[]; landmarks?: string[]; recoveries?: number; assisted?: boolean; completedScenes?: number
}
export interface AdventureMechanism {
  type: AdventureMechanismType; status: 'waiting' | 'solved'; elapsedMs: number; windCalm: boolean
  boxX: number; gateOpen: boolean; platformX: number; platformTarget: number; platformSteps: number; platformTotal: number
  mistakes: number; passedHazards: string[]
}
export interface AdventureGameState {
  status: 'ready' | 'running' | 'paused' | 'finished'; levelId: number; seed: number; elapsedMs: number
  remainingMs: number; pendingMs: number; distance: number; speed: number; lane: AdventureLane
  jumpRemainingMs: number; jumpHeight: number; dashRemainingMs: number; dashCharge: number; dashCooldownMs: number
  hearts: number; invulnerableMs: number; score: number; combo: number; bestCombo: number
  leaves: number; collectedStars: number; obstacles: AdventureObstacle[]; pickups: AdventurePickup[]
  sceneIndex: number; phase: 'travel' | 'fork' | 'mechanism' | 'rest'; x: number; route: 'safe' | 'collectible' | null
  checkpointX: number; recoveries: number; assisted: boolean; collectedLandmarks: string[]; completedScenes: number
  claimedEvents: string[]; mechanism: AdventureMechanism
  feedback: { kind: 'info' | 'success' | 'warning'; message: string; sequence: number }; result: AdventureResult | null
}
export type AdventureAction =
  | { type: 'start' | 'pause' | 'resume' | 'move-left' | 'move-right' | 'jump' | 'dash' | 'interact' | 'move-forward' | 'move-backward' | 'assist' | 'continue' }
  | { type: 'choose-route'; route: 'safe' | 'collectible' }

const scene = (id: string, name: string, mechanism: AdventureMechanismType, collectibleId: string, collectibleName: string, description: string, safeBypass = mechanism === 'slope' || mechanism === 'home'): AdventureScene => ({ id, name, mechanism, collectibleId, collectibleName, description, safeBypass })
const level = (id: number, name: string, chapterId: number, chapterName: string, description: string, scenes: AdventureScene[]): AdventureLevel => ({ id, name, chapterId, chapterName, description, scenes, durationMs: 90000, speed: 6, targetScore: 560 + id * 20, sceneSpacing: 100 })
export const ADVENTURE_LEVELS: AdventureLevel[] = [
  level(1, '门前小径', 1, '晨光林道', '跳过矮树根，沿路标选择宽桥或收藏跳台。', [
    scene('door-root', '门前树根', 'root', 'trail-leaf', '旅途叶片', '前移到树根前再起跳；失误回到路标，不损害伙伴。'),
    scene('door-bridge', '宽桥与跳台', 'root', 'leaf-badge', '第一枚叶章', '稳妥路线走宽桥，收藏支路从短跳台带回叶章。', true),
    scene('door-home', '出门纪念站', 'home', 'departure-page', '出门故事页', '再跨过一段矮树根，到休息站展示今天的故事。'),
  ]),
  level(2, '晨光草坡', 1, '晨光林道', '短冲刺有固定冷却，两段坡道需要安排节奏。', [
    scene('slope-first', '晨光上坡', 'slope', 'bookshelf-wood', '小书架木片', '第一坡可跳跃或短冲刺，第二处岩石必须起跳；冲刺冷却四秒。'),
    scene('slope-second', '草坡转弯', 'slope', 'trail-wood', '支路木片', '先跨短坡，再跳过岩石坡；冲刺不能穿过岩石。'),
    scene('slope-rest', '坡顶休息站', 'home', 'slope-page', '草坡旅行页', '选平路从容归来，或沿跳台捎一页木片制作笔记。'),
  ]),
  level(3, '风铃木桥', 2, '石桥溪谷', '看懂风旗：旗子垂下时再过上层桥，也可绕下层。', [
    scene('wind-root', '桥前树根', 'root', 'trail-wood', '下层木片', '先用一次起跳熟悉桥前路标。'),
    scene('wind-bridge', '风铃木桥', 'wind', 'wind-chime', '小屋风铃', '收藏支路要等风停再跳过桥心；下层路线不受风影响。'),
    scene('wind-return', '慢下来平台', 'wind', 'slow-down-page', '学会慢下来故事页', '在平台等下一次垂旗窗口，或走稳妥下层到休息站。'),
  ]),
  level(4, '林间邮站', 2, '石桥溪谷', '轻箱压住踏板打开木门，收藏支路需要开门后折返。', [
    scene('post-root', '邮站入口', 'root', 'trail-leaf', '邮路叶片', '先跨树根到邮站入口，路标会记住你到过这里。'),
    scene('post-box', '轻箱与木门', 'box', 'mail-hat-pattern', '邮差帽纹样', '靠近箱子推两次到踏板，门打开后折返到 x48 取邮袋。'),
    scene('post-letter', '来信投递站', 'box', 'mail-story', '来信故事', '木门打开后仍要跳过箱沿；收藏支路的来信在身后。'),
  ]),
  level(5, '星灯石阶', 3, '云顶山径', '等移动踏板靠近落点，选五次短跳或三次大跳。', [
    scene('lamp-root', '星灯入口', 'root', 'trail-wood', '星灯木片', '跟着路标跨过入口树根，再进入移动踏板。'),
    scene('lamp-platform', '移动石阶', 'platform', 'star-lamp-material', '小屋星灯材料', '落点数字先显示：踏板靠近圆环后起跳并点前进落到踏板。'),
    scene('lamp-top', '星灯高台', 'platform', 'star-lamp-page', '星灯制作页', '稳妥主路五次短跳，收藏支路三次大跳；落空回路标。'),
  ]),
  level(6, '归家夜路', 3, '云顶山径', '组合风桥、轻箱和踏板，携一件喜欢的纪念品归家。', [
    scene('home-wind', '夜路风桥', 'wind', 'night-stamp', '夜路纪念印章', '根据风旗选上层收藏支路，或绕下层从容过桥。'),
    scene('home-box', '归家木门', 'box', 'home-letter', '归家来信', '推箱开门后可折返拿信；已经拿到的纪念品不会因失误丢失。'),
    scene('home-platform', '灯下踏板', 'platform', 'travel-frame', '旅途相框', '看清最后的踏板落点，把今天喜欢的纪念品带到家门口。'),
  ]),
]
export const adventureLevel = (id: number): AdventureLevel => ADVENTURE_LEVELS.find(item => item.id === id) || ADVENTURE_LEVELS[0]
export const adventureScene = (state: AdventureGameState): AdventureScene => adventureLevel(state.levelId).scenes[state.sceneIndex]
const JUMP_MS = 900
const DASH_MS = 400
const DASH_COOLDOWN_MS = 4000
const STEP_MS = 20
const MOVE_MS = 160
const jumpHeightAt = (remainingMs: number) => remainingMs > 0 ? 4 * (1 - remainingMs / JUMP_MS) * (remainingMs / JUMP_MS) : 0
function mechanismFor(type: AdventureMechanismType): AdventureMechanism {
  return { type, status: 'waiting', elapsedMs: 0, windCalm: false, boxX: 58, gateOpen: false, platformX: 59, platformTarget: 59, platformSteps: 0, platformTotal: 5, mistakes: 0, passedHazards: [] }
}
function updateMechanism(state: AdventureGameState) {
  const mechanism = state.mechanism
  const time = mechanism.elapsedMs * (state.assisted ? .65 : 1) + state.seed % 4 * 250
  mechanism.windCalm = time % 4000 >= (state.assisted ? 1600 : 2200)
  const phase = time % 4800 / 2400
  mechanism.platformX = 59 + (phase <= 1 ? phase : 2 - phase) * 16
  mechanism.platformTotal = state.route === 'collectible' ? 3 : 5
  mechanism.platformTarget = Math.min(75, 55 + (mechanism.platformSteps + 1) * 20 / mechanism.platformTotal)
}
export function createAdventureGame(levelId = 1, seed?: number): AdventureGameState {
  const selected = adventureLevel(levelId)
  const gameSeed = Number.isFinite(seed) ? Number(seed) >>> 0 : (20261001 * selected.id) >>> 0
  const pickups: AdventurePickup[] = selected.scenes.flatMap((item, index) => [8, 18, 34, 42, 82, 92].map((x, ordinal) => ({
    id: `${item.id}-pickup-${ordinal}`, lane: 0 as AdventureLane, distance: index * 100 + x,
    type: (ordinal === 5 ? 'star' : 'leaf') as AdventurePickup['type'], collected: false, resolved: false,
  })))
  const state: AdventureGameState = {
    status: 'ready', levelId: selected.id, seed: gameSeed, elapsedMs: 0, remainingMs: selected.durationMs, pendingMs: 0,
    distance: 0, speed: selected.speed, lane: 0, jumpRemainingMs: 0, jumpHeight: 0, dashRemainingMs: 0, dashCharge: 100, dashCooldownMs: 0,
    hearts: 3, invulnerableMs: 0, score: 0, combo: 0, bestCombo: 0, leaves: 0, collectedStars: 0, obstacles: [], pickups,
    sceneIndex: 0, phase: 'travel', x: 0, route: null, checkpointX: 0, recoveries: 0, assisted: false,
    collectedLandmarks: [], completedScenes: 0, claimedEvents: [], mechanism: mechanismFor(selected.scenes[0].mechanism),
    feedback: { kind: 'info', message: '先到路口选路线。普通路段自动前进，机关处会停下等你的操作。', sequence: 0 }, result: null,
  }
  updateMechanism(state)
  return state
}
function clone(state: AdventureGameState): AdventureGameState {
  return { ...state, pickups: state.pickups.map(item => ({ ...item })), obstacles: state.obstacles.map(item => ({ ...item })),
    claimedEvents: [...state.claimedEvents], collectedLandmarks: [...state.collectedLandmarks], mechanism: { ...state.mechanism, passedHazards: [...state.mechanism.passedHazards] } }
}
function feedback(state: AdventureGameState, kind: AdventureGameState['feedback']['kind'], message: string) { state.feedback = { kind, message, sequence: state.feedback.sequence + 1 } }
function award(state: AdventureGameState, id: string, base: number) {
  if (state.claimedEvents.includes(id)) return
  state.claimedEvents.push(id)
  state.score += Math.round(base * (1 + Math.min(6, state.combo) * .05))
  state.combo += 1; state.bestCombo = Math.max(state.bestCombo, state.combo)
}
function collectLandmark(state: AdventureGameState) {
  const current = adventureScene(state)
  if (state.route !== 'collectible' || state.collectedLandmarks.includes(current.collectibleId)) return
  state.collectedLandmarks.push(current.collectibleId)
  feedback(state, 'success', `拿到${current.collectibleName}，失误也会保留在背包。`)
}
function finish(state: AdventureGameState, completed: boolean) {
  const selected = adventureLevel(state.levelId)
  let stars: AdventureResult['stars'] = completed ? 1 : 0
  if (completed && !state.assisted && state.score >= selected.targetScore) stars = 2
  if (completed && !state.assisted && state.recoveries === 0 && state.score >= selected.targetScore * 1.15) stars = 3
  if (completed) { const storyId = `adventure-story-${selected.id}`; if (!state.collectedLandmarks.includes(storyId)) state.collectedLandmarks.push(storyId) }
  state.status = 'finished'; state.pendingMs = 0
  state.result = {
    levelId: selected.id, completed, score: state.score, stars, leaves: state.leaves, collectedStars: state.collectedStars,
    hearts: state.hearts, distance: Math.round(state.distance * 100) / 100, elapsedMs: state.elapsedMs,
    experience: Math.min(80, Math.floor(state.score / 100) + state.leaves + (completed ? 20 : 0)),
    collectibleIds: [...state.collectedLandmarks], landmarks: selected.scenes.slice(0, state.completedScenes).map(item => item.id),
    recoveries: state.recoveries, assisted: state.assisted, completedScenes: state.completedScenes,
  }
  feedback(state, completed ? 'success' : 'info', completed ? '三个场景走完了，带着保留的纪念品回家。' : '这程先休息，已经拿到的收藏保留；下次再沿路标出发。')
}
function recover(state: AdventureGameState, reason: string) {
  state.recoveries += 1; state.mechanism.mistakes += 1; state.score = Math.max(0, state.score - 50); state.combo = 0
  state.elapsedMs = Math.min(adventureLevel(state.levelId).durationMs, state.elapsedMs + 2000)
  state.remainingMs = Math.max(0, adventureLevel(state.levelId).durationMs - state.elapsedMs)
  state.mechanism.elapsedMs += 2000; state.x = state.checkpointX; state.distance = state.sceneIndex * 100 + state.x
  state.jumpRemainingMs = 0; state.jumpHeight = 0; state.dashRemainingMs = 0; state.mechanism.platformSteps = 0
  updateMechanism(state)
  feedback(state, 'warning', `${reason} 回到路标，-50 分、-2 秒，连击重置；收藏保留。${state.recoveries >= 3 ? '可开启慢速提示继续故事。' : ''}`)
  if (state.remainingMs === 0) finish(state, false)
}
function solved(state: AdventureGameState) { state.mechanism.status = 'solved'; award(state, `${adventureScene(state).id}:mechanism`, 50) }
function precision(state: AdventureGameState) { award(state, `${adventureScene(state).id}:precision`, Math.min(30, Math.round(state.jumpHeight * 30))) }
function pickupsBetween(state: AdventureGameState, from: number, to: number) {
  if (to <= from) return
  const offset = state.sceneIndex * 100
  for (const pickup of state.pickups) {
    if (pickup.resolved || pickup.distance < offset + from || pickup.distance > offset + to) continue
    pickup.resolved = true; pickup.collected = true
    if (pickup.type === 'leaf') state.leaves += 1
    else state.collectedStars += 1
    award(state, pickup.id, 10)
  }
}
function sceneFinished(state: AdventureGameState) {
  const current = adventureScene(state)
  award(state, `${current.id}:scene`, 100); state.completedScenes = Math.max(state.completedScenes, state.sceneIndex + 1)
  state.x = 100; state.distance = state.sceneIndex * 100 + 100
  if (state.sceneIndex === 2) finish(state, true)
  else { state.phase = 'rest'; feedback(state, 'success', '这一段到了休息站，伙伴伸展一下。点继续前往下一个场景。') }
}
function automaticStep(state: AdventureGameState, step: number) {
  const selected = adventureLevel(state.levelId)
  state.elapsedMs += step; state.remainingMs = Math.max(0, selected.durationMs - state.elapsedMs)
  state.jumpRemainingMs = Math.max(0, state.jumpRemainingMs - step); state.jumpHeight = jumpHeightAt(state.jumpRemainingMs)
  state.dashRemainingMs = Math.max(0, state.dashRemainingMs - step); state.dashCooldownMs = Math.max(0, state.dashCooldownMs - step)
  state.dashCharge = Math.min(100, (DASH_COOLDOWN_MS - state.dashCooldownMs) / DASH_COOLDOWN_MS * 100)
  state.speed = selected.speed * (state.assisted ? .7 : 1) * (state.dashRemainingMs > 0 ? 1.6 : 1)
  if (state.phase === 'mechanism') { state.mechanism.elapsedMs += step; updateMechanism(state) }
  if (state.phase === 'travel') {
    const previousX = state.x
    const limit = !state.route ? 25 : state.mechanism.status === 'waiting' ? 55 : 100
    state.x = Math.min(limit, state.x + state.speed * step / 1000); state.distance = state.sceneIndex * 100 + state.x
    pickupsBetween(state, previousX, state.x)
    if (state.x >= limit) {
      if (limit === 25) { state.phase = 'fork'; state.checkpointX = 25; feedback(state, 'info', '路口到了，选稳妥主路或带奖品的收藏支路。') }
      else if (limit === 55) { state.phase = 'mechanism'; state.checkpointX = 45; feedback(state, 'info', adventureScene(state).description) }
      else sceneFinished(state)
    }
  }
  if (state.remainingMs === 0 && state.status === 'running') finish(state, false)
}
/** 固定步长检查路口、机关和终点；长帧不会自动穿过待选择场景。 */
export function advanceAdventureGame(original: AdventureGameState, deltaMs: number): AdventureGameState {
  if (original.status !== 'running' || !Number.isFinite(deltaMs) || deltaMs < 1) return original
  const state = clone(original); state.pendingMs += Math.floor(deltaMs)
  while (state.pendingMs >= STEP_MS && state.status === 'running') {
    const step = Math.min(STEP_MS, state.remainingMs)
    if (step <= 0) { finish(state, false); break }
    state.pendingMs -= step; automaticStep(state, step)
  }
  return state
}
function manualMove(original: AdventureGameState, forward: boolean): AdventureGameState {
  if (original.phase !== 'mechanism') return original
  let state = clone(original)
  if (state.assisted && forward && state.jumpRemainingMs === 0 && (state.mechanism.type !== 'box' || state.mechanism.gateOpen && state.x + 4 >= state.mechanism.boxX)) state.jumpRemainingMs = JUMP_MS
  state = advanceAdventureGame(state, MOVE_MS)
  if (state.status !== 'running') return state
  const mechanism = state.mechanism; const previousX = state.x
  if (!forward) {
    state.x = Math.max(state.checkpointX, state.x - 4); state.distance = state.sceneIndex * 100 + state.x
    if (mechanism.type === 'box' && mechanism.gateOpen && state.route === 'collectible' && state.x <= 48) collectLandmark(state)
    return state
  }
  const nextX = Math.min(76, state.x + 4)
  if (mechanism.type === 'platform') {
    const target = mechanism.platformTarget
    const airborne = state.jumpHeight >= .35
    const aligned = Math.abs(mechanism.platformX - target) <= (state.assisted ? 5 : 2)
    if (!airborne || !aligned) { recover(state, !airborne ? '踏板要起跳后再点前进落地。' : '踏板还没到圆环落点，等它靠近再跳。'); return state }
    state.x = target; mechanism.platformSteps += 1; precision(state); state.jumpRemainingMs = 0; state.jumpHeight = 0; updateMechanism(state)
    if (mechanism.platformSteps >= mechanism.platformTotal) { solved(state); collectLandmark(state); state.x = 76; state.phase = 'travel' }
  } else if (mechanism.type === 'box') {
    if (!mechanism.gateOpen && nextX >= mechanism.boxX - 1) { state.x = Math.max(state.checkpointX, mechanism.boxX - 4); feedback(state, 'info', '轻箱挡在前面，靠近后点“推箱”把它送到踏板。') }
    else if (previousX < mechanism.boxX && nextX >= mechanism.boxX && state.jumpHeight < .35) { recover(state, '箱子已垫好，起跳越过箱沿。'); return state }
    else if (nextX >= 72 && !mechanism.gateOpen) { recover(state, '木门未打开，先把箱子推到踏板。'); return state }
    else state.x = nextX
    if (state.x >= 76 && mechanism.gateOpen) state.phase = 'travel'
  } else {
    if (mechanism.type === 'wind' && state.route === 'collectible' && previousX < 70 && nextX > 60 && !mechanism.windCalm) { recover(state, '风旗横摆，桥上风太大，等旗子垂下再过。'); return state }
    const hazards = state.route === 'safe' && adventureScene(state).safeBypass ? [] : mechanism.type === 'slope' ? [60, 70] : [60]
    for (const x of hazards) {
      if (previousX >= x || nextX < x) continue
      if (mechanism.type === 'wind' && state.route === 'collectible' && !mechanism.windCalm) { recover(state, '风旗横摆，桥上风太大，等旗子垂下再过。'); return state }
      const jumping = state.jumpHeight >= .35
      const shortDash = mechanism.type === 'slope' && x === 60 && state.dashRemainingMs > 0
      if (!jumping && !shortDash) { recover(state, mechanism.type === 'slope' && x === 70 ? '岩石不能用冲刺穿过，请起跳越过。' : mechanism.type === 'slope' ? '坡沿需要起跳或一次准备好的短冲刺。' : '跳点错过了，靠近矮树根再起跳。'); return state }
      if (jumping) precision(state)
      const hazardId = `${adventureScene(state).id}:hazard-${x}`
      if (!mechanism.passedHazards.includes(hazardId)) mechanism.passedHazards.push(hazardId)
    }
    state.x = nextX
    if (state.x >= 76) { solved(state); collectLandmark(state); state.phase = 'travel' }
  }
  state.distance = state.sceneIndex * 100 + state.x; pickupsBetween(state, previousX, state.x)
  return state
}
export function applyAdventureAction(original: AdventureGameState, action: AdventureAction): AdventureGameState {
  if (original.status === 'finished') return original
  if (action.type === 'start') { if (original.status !== 'ready') return original; const state = clone(original); state.status = 'running'; feedback(state, 'info', '出发！普通路段自动前进，到路口会等你选路。'); return state }
  if (action.type === 'pause') return original.status === 'running' ? { ...original, status: 'paused' } : original
  if (action.type === 'resume') return original.status === 'paused' ? { ...original, status: 'running' } : original
  if (original.status !== 'running') return original
  if (action.type === 'move-forward' || action.type === 'move-right' && original.phase === 'mechanism') return manualMove(original, true)
  if (action.type === 'move-backward' || action.type === 'move-left' && original.phase === 'mechanism') return manualMove(original, false)
  let state = clone(original)
  switch (action.type) {
    case 'choose-route':
      if (state.phase !== 'fork' || !['safe', 'collectible'].includes(action.route)) return original
      state.route = action.route; state.lane = action.route === 'safe' ? 0 : 1; state.phase = 'travel'; updateMechanism(state)
      feedback(state, 'info', action.route === 'safe' ? '选了稳妥主路，先把这一段走好。' : `收藏支路目标：${adventureScene(state).collectibleName}。`); return state
    case 'move-left': state.lane = Math.max(-1, state.lane - 1) as AdventureLane; return state
    case 'move-right': state.lane = Math.min(1, state.lane + 1) as AdventureLane; return state
    case 'jump':
      if (state.jumpRemainingMs > 0 || state.phase === 'fork' || state.phase === 'rest') return original
      state.jumpRemainingMs = JUMP_MS; state.jumpHeight = 0; feedback(state, 'info', '起跳后点前进跨过跳点，提前太多会在障碍前落地。'); return state
    case 'dash':
      if (state.dashCooldownMs > 0 || state.phase === 'fork' || state.phase === 'rest') return original
      state.dashRemainingMs = DASH_MS; state.dashCooldownMs = DASH_COOLDOWN_MS; state.dashCharge = 0
      feedback(state, 'info', '短冲刺开始，四秒后可再次使用；冲刺不能穿过岩石。'); return state
    case 'interact':
      if (state.phase !== 'mechanism' || state.mechanism.type !== 'box' || state.mechanism.gateOpen) return original
      if (Math.abs(state.mechanism.boxX - state.x) > 4) { feedback(state, 'info', '先走到轻箱旁，再点推箱。'); return state }
      state = advanceAdventureGame(state, 200)
      if (state.status !== 'running') return state
      state.mechanism.boxX = Math.min(66, state.mechanism.boxX + 4)
      if (state.mechanism.boxX === 66) { state.mechanism.gateOpen = true; solved(state); feedback(state, 'success', '踏板压下，木门打开！收藏支路的邮袋在身后 x48，折返可取。') }
      else feedback(state, 'info', '箱子向前一格，跟上后再推一次到踏板。')
      return state
    case 'assist':
      if (state.recoveries < 3 || state.assisted) return original
      state.assisted = true; updateMechanism(state); feedback(state, 'info', '慢速提示已开启：窗口更宽，前进可辅助起跳。首通故事保留，挑战成绩单独记录。'); return state
    case 'continue':
      if (state.phase !== 'rest' || state.sceneIndex >= 2) return original
      state.sceneIndex += 1; state.phase = 'travel'; state.x = 0; state.distance = state.sceneIndex * 100; state.route = null; state.checkpointX = 0
      state.jumpRemainingMs = 0; state.jumpHeight = 0; state.dashRemainingMs = 0; state.mechanism = mechanismFor(adventureScene(state).mechanism); updateMechanism(state)
      feedback(state, 'info', adventureScene(state).description); return state
    default: return original
  }
}
export function exportAdventureCheckpoint(state: AdventureGameState): { version: 1; game: 'adventure'; state: AdventureGameState } {
  return { version: 1, game: 'adventure', state: JSON.parse(JSON.stringify(state)) as AdventureGameState }
}
