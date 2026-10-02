import {
  ADVENTURE_LEVELS, advanceAdventureGame, applyAdventureAction, createAdventureGame, exportAdventureCheckpoint,
  type AdventureGameState,
} from '../../src/utils/pet-adventure-game'

const start = (level = 1, seed = 0) => applyAdventureAction(createAdventureGame(level, seed), { type: 'start' })
const act = (state: AdventureGameState, type: 'move-forward' | 'move-backward' | 'jump' | 'dash' | 'interact' | 'continue' | 'assist') => applyAdventureAction(state, { type })
function waitUntil(state: AdventureGameState, condition: (current: AdventureGameState) => boolean, step = 100): AdventureGameState {
  for (let tries = 0; tries < 1000 && !condition(state) && state.status === 'running'; tries += 1) state = advanceAdventureGame(state, step)
  if (!condition(state)) throw new Error(`Player could not reach ${state.phase}, level ${state.levelId} scene ${state.sceneIndex}, ${state.feedback.message}`)
  return state
}
function enterMechanism(state: AdventureGameState, route: 'safe' | 'collectible' = 'collectible') {
  state = waitUntil(state, current => current.phase === 'fork')
  state = applyAdventureAction(state, { type: 'choose-route', route })
  return waitUntil(state, current => current.phase === 'mechanism')
}
function solveMechanism(state: AdventureGameState) {
  const type = state.mechanism.type
  if (type === 'box') {
    state = act(state, 'interact')
    state = act(state, 'move-forward')
    state = act(state, 'interact')
    if (state.route === 'collectible') while (state.x > 48) state = act(state, 'move-backward')
    while (state.x < 59) state = act(state, 'move-forward')
    state = advanceAdventureGame(act(state, 'jump'), 100)
  } else if (type === 'platform') {
    const total = state.mechanism.platformTotal
    for (let hop = 0; hop < total; hop += 1) {
      state = waitUntil(state, current => Math.abs(current.mechanism.platformX - current.mechanism.platformTarget) <= .6, 20)
      state = act(act(state, 'jump'), 'move-forward')
      if (state.recoveries > 0) throw new Error(`A visible aligned landing failed: ${state.feedback.message}`)
    }
    return state
  } else {
    if (type === 'wind' && state.route === 'collectible') {
      // 等下一次由横摆变为垂下的旗子，留下足够的完整过桥窗口。
      if (state.mechanism.windCalm) state = waitUntil(state, current => !current.mechanism.windCalm)
      state = waitUntil(state, current => current.mechanism.windCalm)
    }
    state = advanceAdventureGame(act(state, 'jump'), 100)
  }
  for (let moves = 0; moves < 12 && state.phase === 'mechanism'; moves += 1) state = act(state, 'move-forward')
  if (state.phase !== 'travel') throw new Error(`Player failed to solve ${type}: ${state.feedback.message}`)
  return state
}
function play(levelId: number, seed = 0, route: 'safe' | 'collectible' = 'collectible') {
  let state = start(levelId, seed)
  for (let index = 0; index < 3; index += 1) {
    state = solveMechanism(enterMechanism(state, route))
    state = waitUntil(state, current => current.phase === 'rest' || current.status === 'finished')
    if (state.phase === 'rest') state = act(state, 'continue')
  }
  return state
}

test('the six report levels preserve stored chapter identities and use three distinct short scenes', () => {
  expect(ADVENTURE_LEVELS.map(item => item.name)).toEqual(['门前小径', '晨光草坡', '风铃木桥', '林间邮站', '星灯石阶', '归家夜路'])
  expect(ADVENTURE_LEVELS.map(item => item.chapterName)).toEqual(['晨光林道', '晨光林道', '石桥溪谷', '石桥溪谷', '云顶山径', '云顶山径'])
  expect(ADVENTURE_LEVELS.map(item => item.chapterId)).toEqual([1, 1, 2, 2, 3, 3])
  expect(ADVENTURE_LEVELS.map(item => item.scenes.map(part => part.mechanism))).toEqual([
    ['root', 'root', 'home'], ['slope', 'slope', 'home'], ['root', 'wind', 'wind'], ['root', 'box', 'box'], ['root', 'platform', 'platform'], ['wind', 'box', 'platform'],
  ])
})

test('automatic travel stops at the fork and then at its mechanism, even on a long frame', () => {
  let state = advanceAdventureGame(start(), 15000)
  expect(state.phase).toBe('fork')
  expect(state.x).toBe(25)
  expect(state.completedScenes).toBe(0)
  state = applyAdventureAction(state, { type: 'choose-route', route: 'collectible' })
  state = advanceAdventureGame(state, 15000)
  expect(state.phase).toBe('mechanism')
  expect(state.x).toBe(55)
  expect(state.mechanism.status).toBe('waiting')
  expect(act(state, 'interact')).toBe(state)
  expect(advanceAdventureGame(state, 5000).x).toBe(55)
})

test('a mistimed root jump restores a landmark, subtracts two seconds and resets combo without exhausting lives', () => {
  let state = enterMechanism(start())
  state = act(state, 'move-forward')
  const before = state
  state = act(state, 'move-forward')
  expect(state.x).toBe(45)
  expect(state.recoveries).toBe(1)
  expect(state.elapsedMs - before.elapsedMs).toBe(2160)
  expect(state.score).toBe(Math.max(0, before.score - 50))
  expect(state.combo).toBe(0)
  expect(state.hearts).toBe(3)
  expect(state.status).toBe('running')
  // 在路标前移两格，再起跳过根，真正恢复后仍可以走完。
  state = act(act(state, 'move-forward'), 'move-forward')
  state = advanceAdventureGame(act(state, 'jump'), 100)
  while (state.phase === 'mechanism') state = act(state, 'move-forward')
  expect(state.mechanism.status).toBe('solved')
})

test('dash uses a fixed cooldown and can cross the short slope but cannot pass the rock slope', () => {
  let state = enterMechanism(start(2))
  state = act(state, 'dash')
  expect(state.dashCharge).toBe(0)
  expect(act(state, 'dash')).toBe(state)
  state = act(act(state, 'move-forward'), 'move-forward')
  expect(state.x).toBe(63)
  expect(state.recoveries).toBe(0)
  state = act(act(state, 'move-forward'), 'dash')
  state = act(state, 'move-forward')
  expect(state.x).toBe(45)
  expect(state.recoveries).toBe(1)
  expect(state.feedback.message).toContain('岩石不能')
  state = advanceAdventureGame(state, 4000)
  expect(state.dashCharge).toBe(100)
  expect(act(state, 'dash').dashRemainingMs).toBeGreaterThan(0)
})

test('wind on the upper route requires a calm flag while the safe lower route is still reachable', () => {
  let state = start(6, 0)
  state = enterMechanism(state)
  expect(state.mechanism.windCalm).toBe(false)
  state = advanceAdventureGame(act(state, 'jump'), 100)
  state = act(act(state, 'move-forward'), 'move-forward')
  expect(state.recoveries).toBe(1)
  expect(state.feedback.message).toContain('风旗横摆')
  const safe = solveMechanism(enterMechanism(start(6, 0), 'safe'))
  expect(safe.recoveries).toBe(0)
  expect(safe.phase).toBe('travel')
  expect(safe.collectedLandmarks).toEqual([])
})

test('pushing a nearby box opens its gate only at the switch, and the mailbag requires actual backtracking', () => {
  let state = playFirstScene(4)
  state = enterMechanism(act(state, 'continue'))
  state = act(state, 'interact')
  expect(state.mechanism.boxX).toBe(62)
  expect(state.mechanism.gateOpen).toBe(false)
  expect(act(state, 'interact').mechanism.boxX).toBe(62)
  state = act(state, 'move-forward')
  state = act(state, 'interact')
  expect(state.mechanism.gateOpen).toBe(true)
  expect(state.collectedLandmarks).not.toContain('mail-hat-pattern')
  state = act(act(act(state, 'move-backward'), 'move-backward'), 'move-backward')
  expect(state.collectedLandmarks).toContain('mail-hat-pattern')
  const collected = [...state.collectedLandmarks]
  while (state.x < 63) state = act(state, 'move-forward')
  state = act(state, 'move-forward') // 没跳箱沿，回到最近路标。
  expect(state.recoveries).toBe(1)
  expect(state.collectedLandmarks).toEqual(collected)
  expect(state.mechanism.gateOpen).toBe(true)
  expect(state.mechanism.boxX).toBe(66)
  expect(act(state, 'interact').score).toBe(state.score)
})

function playFirstScene(levelId: number) {
  const state = solveMechanism(enterMechanism(start(levelId)))
  return waitUntil(state, current => current.phase === 'rest')
}

test('moving-platform hops require jumping and a real aligned landing; routes have five versus three hops', () => {
  let state = enterMechanism(act(playFirstScene(5), 'continue'), 'safe')
  expect(state.mechanism.platformTotal).toBe(5)
  const failed = act(state, 'move-forward')
  expect(failed.recoveries).toBe(1)
  expect(failed.mechanism.platformSteps).toBe(0)
  state = solveMechanism(state)
  expect(state.mechanism.platformSteps).toBe(5)
  expect(state.phase).toBe('travel')
  const branch = solveMechanism(enterMechanism(act(playFirstScene(5), 'continue'), 'collectible'))
  expect(branch.mechanism.platformSteps).toBe(3)
  expect(branch.collectedLandmarks).toContain('star-lamp-material')
})

test('a real jump at the wrong moving-platform position fails instead of granting its target automatically', () => {
  let state = enterMechanism(act(playFirstScene(5), 'continue'), 'collectible')
  state = waitUntil(state, current => Math.abs(current.mechanism.platformX - current.mechanism.platformTarget) > 5, 20)
  state = act(act(state, 'jump'), 'move-forward')
  expect(state.recoveries).toBe(1)
  expect(state.mechanism.platformSteps).toBe(0)
  expect(state.feedback.message).toContain('踏板还没到')
})

test('the safe grass path is physically flatter than the collectible slope and is passable without jumping', () => {
  let safe = enterMechanism(start(2), 'safe')
  while (safe.phase === 'mechanism') safe = act(safe, 'move-forward')
  expect(safe.recoveries).toBe(0)
  expect(safe.collectedLandmarks).toEqual([])
  let branch = enterMechanism(start(2), 'collectible')
  branch = act(act(branch, 'move-forward'), 'move-forward')
  expect(branch.recoveries).toBe(1)
})

test('already-collected objects and first-correct mechanism events never award twice on a repeated route', () => {
  let state = enterMechanism(start())
  const leaves = state.leaves
  const score = state.score
  state = act(act(state, 'move-backward'), 'move-backward')
  state = act(act(state, 'move-forward'), 'move-forward')
  expect(state.leaves).toBe(leaves)
  expect(state.score).toBe(score)
  state = solveMechanism(state)
  expect(new Set(state.claimedEvents).size).toBe(state.claimedEvents.length)
  expect(state.claimedEvents.filter(id => id.endsWith(':mechanism'))).toHaveLength(1)
  const once = state.score
  expect(act(state, 'interact').score).toBe(once)
})

test('pause freezes world, wind, platform, jump and cooldown until explicit resume', () => {
  let state = enterMechanism(start(6))
  state = advanceAdventureGame(act(state, 'jump'), 100)
  state = act(state, 'dash')
  const paused = applyAdventureAction(state, { type: 'pause' })
  expect(advanceAdventureGame(paused, 60000)).toBe(paused)
  expect(act(paused, 'move-forward')).toBe(paused)
  expect(act(paused, 'interact')).toBe(paused)
  const resumed = applyAdventureAction(paused, { type: 'resume' })
  expect(resumed.mechanism).toEqual(state.mechanism)
  expect(resumed.jumpRemainingMs).toBe(state.jumpRemainingMs)
  expect(advanceAdventureGame(resumed, 100).elapsedMs).toBe(state.elapsedMs + 100)
})

test('three recoveries offer assistance without automatic completion and retain a separate assisted result', () => {
  let state = enterMechanism(start())
  expect(act(state, 'assist')).toBe(state)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = state.recoveries
    while (state.recoveries === previous) state = act(state, 'move-forward')
  }
  state = act(state, 'assist')
  expect(state.assisted).toBe(true)
  expect(state.completedScenes).toBe(0)
  for (let index = 0; index < 3; index += 1) {
    while (state.phase === 'mechanism') state = act(state, 'move-forward')
    state = waitUntil(state, current => current.phase === 'rest' || current.status === 'finished')
    if (state.phase === 'rest') state = enterMechanism(act(state, 'continue'), 'safe')
  }
  expect(state.result).toMatchObject({ completed: true, assisted: true, stars: 1, recoveries: 3 })
  expect(state.result?.collectibleIds).toContain('adventure-story-1')
})

test('completion requires the third physical endpoint; timeout locks an actual failed result', () => {
  const first = playFirstScene(1)
  expect(first.completedScenes).toBe(1)
  expect(first.result).toBeNull()
  expect(act(first, 'interact').result).toBeNull()
  const timedOut = advanceAdventureGame(first, 90000)
  expect(timedOut.result).toMatchObject({ completed: false, stars: 0, completedScenes: 1 })
  expect(timedOut.result?.collectibleIds).toContain('trail-leaf')
  expect(advanceAdventureGame(timedOut, 60000)).toBe(timedOut)
  expect(act(timedOut, 'continue')).toBe(timedOut)
  const finished = play(1)
  expect(finished.result).toMatchObject({ completed: true, completedScenes: 3, distance: 300 })
  expect(finished.elapsedMs).toBeLessThan(90000)
})

test('fixed steps preserve partial milliseconds and make repeated inputs and frame batching deterministic', () => {
  const original = start(4, 37)
  const partial = advanceAdventureGame(original, 17)
  expect(partial.elapsedMs).toBe(0)
  expect(partial.pendingMs).toBe(17)
  expect(advanceAdventureGame(partial, 3)).toEqual(advanceAdventureGame(original, 20))
  let chunked = original
  for (const delta of [23, 177, 400, 901, 1000, 2498]) chunked = advanceAdventureGame(chunked, delta)
  expect(chunked).toEqual(advanceAdventureGame(original, 4999))
  expect(play(6, 37)).toEqual(play(6, 37))
  expect(advanceAdventureGame(original, Infinity)).toBe(original)
  expect(advanceAdventureGame(original, -20)).toBe(original)
  expect(advanceAdventureGame(createAdventureGame(), 10000).status).toBe('ready')
})

test.each(ADVENTURE_LEVELS.map(item => [item.id, item.name]))('level %s %s has a clear route for 100 seeds and a reachable distinct collectible branch', levelId => {
  for (let seed = 0; seed < 100; seed += 1) {
    const safe = play(levelId as number, seed, 'safe')
    expect(safe.result?.completed).toBe(true)
    expect(safe.recoveries).toBe(0)
    expect(safe.completedScenes).toBe(3)
  }
  const branch = play(levelId as number, 0, 'collectible')
  expect(branch.result?.completed).toBe(true)
  expect(branch.result?.collectibleIds).toEqual(expect.arrayContaining(ADVENTURE_LEVELS[(levelId as number) - 1].scenes.map(item => item.collectibleId)))
  expect(branch.score).toBeGreaterThanOrEqual(ADVENTURE_LEVELS[(levelId as number) - 1].targetScore)
  expect(branch.result?.stars).toBeGreaterThanOrEqual(2)
})

test('checkpoint export is a detached tagged JSON snapshot and does not change the actual world', () => {
  const state = enterMechanism(start(6))
  const exported = exportAdventureCheckpoint(state)
  expect(exported).toMatchObject({ version: 1, game: 'adventure' })
  expect(JSON.parse(JSON.stringify(exported))).toEqual(exported)
  exported.state.mechanism.gateOpen = true
  exported.state.collectedLandmarks.push('fake')
  expect(state.mechanism.gateOpen).toBe(false)
  expect(state.collectedLandmarks).not.toContain('fake')
})
