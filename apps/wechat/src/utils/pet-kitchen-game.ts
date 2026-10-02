export interface KitchenIngredient { id: string; name: string; emoji: string }
export interface KitchenRecipe {
  id: string; name: string; ingredients: string[]; prepMs: number; cookMs: number; plateMs: number
  idealHeat: number; baseScore: number; prepLabel: string; cookLabel: string
}
export interface KitchenLevel {
  id: number; name: string; description: string; recipeIds: string[]; durationMs: number
  targetServed: number; targetScore: number; orderIntervalMs: number; patienceMs: number; maxOrders: number
  mechanic: 'tutorial' | 'warmth' | 'shared' | 'oven' | 'combination' | 'banquet'
  collectibleId: string; collectibleName: string; story: string; coolingWindowMs: number
}
export type KitchenStationId = 'prep' | 'cook' | 'plate'
export interface KitchenOrder {
  id: string; recipeId: string; arrivedAtMs: number; expiresAtMs: number; patienceMs: number
  status: 'waiting' | 'served' | 'expired'; express: boolean
  customer?: string; note?: string; returned?: boolean
}
export interface KitchenJob {
  orderId: string; recipeId: string; stage: 'working' | 'ready' | 'burnt'; progress: number
  quality: number; baseQuality: number; heat: number; elapsedMs: number; cookWorkUnits: number; heatExposure: number
  cookDurationMs?: number; batch?: boolean
}
export interface KitchenStation { job: KitchenJob | null }
export interface KitchenFeedback { kind: 'info' | 'success' | 'warning'; message: string; sequence: number }
export interface KitchenResult {
  levelId?: number
  stars: 0 | 1 | 2 | 3; passed: boolean; score: number; served: number; missed: number; wasted: number
  bestCombo: number; targetServed: number; targetScore: number; advice: string
  collectibleIds?: string[]; recipesServed?: string[]; stoveIdleMs?: number
}
export interface KitchenGameState {
  levelId: number; status: 'ready' | 'running' | 'paused' | 'finished'; elapsedMs: number; remainingMs: number
  selectedOrderId: string | null; selectedIngredients: string[]; orders: KitchenOrder[]
  stations: Record<KitchenStationId, KitchenStation>; score: number; combo: number; bestCombo: number
  served: number; missed: number; mistakes: number; wasted: number; nextOrderAtMs: number; nextOrderNumber: number
  feedback: KitchenFeedback; result: KitchenResult | null
  bufferedPrep: KitchenJob[]; menuIds: string[]; cleaningMs: number; stoveIdleMs: number; recipesServed: string[]
}
export type KitchenAction =
  | { type: 'start' | 'pause' | 'resume' | 'clear-ingredients' | 'prepare' | 'prepare-batch' | 'prepare-stock' }
  | { type: 'set-menu'; recipeIds: string[] }
  | { type: 'select-order'; orderId: string }
  | { type: 'toggle-ingredient'; ingredientId: string }
  | { type: 'move'; from: 'prep' | 'cook'; orderId?: string }
  | { type: 'heat'; value: number }
  | { type: 'serve'; orderId?: string }
  | { type: 'discard'; station: KitchenStationId }
  | { type: 'discard-prepared'; orderId: string }

export const KITCHEN_INGREDIENTS: KitchenIngredient[] = [
  { id: 'rice', name: '米饭', emoji: '🍚' }, { id: 'egg', name: '鸡蛋', emoji: '🥚' },
  { id: 'fish', name: '鱼肉', emoji: '🐟' }, { id: 'chicken', name: '鸡肉', emoji: '🍗' },
  { id: 'tofu', name: '豆腐', emoji: '🧈' }, { id: 'greens', name: '青菜', emoji: '🥬' },
  { id: 'carrot', name: '胡萝卜', emoji: '🥕' }, { id: 'mushroom', name: '蘑菇', emoji: '🍄' },
]

export const KITCHEN_RECIPES: KitchenRecipe[] = [
  { id: 'egg-rice', name: '煎蛋饭', ingredients: ['rice', 'egg'], prepMs: 2000, cookMs: 4000, plateMs: 1500, idealHeat: 55, baseScore: 100, prepLabel: '拌料', cookLabel: '煎制' },
  { id: 'greens-soup', name: '蔬菜汤', ingredients: ['greens', 'carrot'], prepMs: 2200, cookMs: 4500, plateMs: 1500, idealHeat: 50, baseScore: 100, prepLabel: '切配', cookLabel: '炖煮' },
  { id: 'veggie-rice', name: '时蔬饭', ingredients: ['rice', 'greens', 'carrot'], prepMs: 2500, cookMs: 4500, plateMs: 1800, idealHeat: 55, baseScore: 150, prepLabel: '切配', cookLabel: '蒸煮' },
  { id: 'mushroom-egg', name: '菌菇煎蛋', ingredients: ['mushroom', 'egg'], prepMs: 2200, cookMs: 4300, plateMs: 1500, idealHeat: 60, baseScore: 100, prepLabel: '拌料', cookLabel: '煎制' },
  { id: 'tofu-soup', name: '豆腐鲜汤', ingredients: ['tofu', 'greens', 'mushroom'], prepMs: 2500, cookMs: 5000, plateMs: 1800, idealHeat: 50, baseScore: 150, prepLabel: '切配', cookLabel: '炖煮' },
  { id: 'fish-rice', name: '清蒸鱼饭', ingredients: ['fish', 'rice', 'greens'], prepMs: 2800, cookMs: 5500, plateMs: 2000, idealHeat: 55, baseScore: 150, prepLabel: '切配', cookLabel: '蒸煮' },
  { id: 'chicken-rice', name: '香煎鸡饭', ingredients: ['chicken', 'rice', 'carrot'], prepMs: 2800, cookMs: 5500, plateMs: 2000, idealHeat: 65, baseScore: 150, prepLabel: '切配', cookLabel: '煎制' },
  { id: 'tofu-rice', name: '豆腐盖饭', ingredients: ['tofu', 'rice', 'mushroom'], prepMs: 2500, cookMs: 5000, plateMs: 1800, idealHeat: 60, baseScore: 150, prepLabel: '切配', cookLabel: '煎制' },
  { id: 'fish-soup', name: '鱼鲜汤', ingredients: ['fish', 'tofu', 'greens'], prepMs: 3000, cookMs: 6000, plateMs: 2200, idealHeat: 50, baseScore: 200, prepLabel: '切配', cookLabel: '炖煮' },
  { id: 'chicken-bake', name: '彩蔬烤鸡', ingredients: ['chicken', 'carrot', 'mushroom'], prepMs: 3000, cookMs: 6500, plateMs: 2200, idealHeat: 65, baseScore: 200, prepLabel: '拌料', cookLabel: '烘烤' },
  { id: 'egg-tofu', name: '蛋香蒸豆腐', ingredients: ['egg', 'tofu', 'greens'], prepMs: 2600, cookMs: 5200, plateMs: 2000, idealHeat: 55, baseScore: 150, prepLabel: '拌料', cookLabel: '蒸煮' },
  { id: 'garden-bake', name: '田园烤蔬', ingredients: ['carrot', 'mushroom', 'greens', 'tofu'], prepMs: 3000, cookMs: 6000, plateMs: 2200, idealHeat: 60, baseScore: 200, prepLabel: '切配', cookLabel: '烘烤' },
]

export const KITCHEN_LEVELS: KitchenLevel[] = [
  { id: 1, name: '迎客早餐', description: '煎蛋饭与暖汤；先开长工序，再照顾下一单。', recipeIds: ['egg-rice', 'greens-soup'], durationMs: 90000, targetServed: 4, targetScore: 480, orderIntervalMs: 14000, patienceMs: 36000, maxOrders: 3, mechanic: 'tutorial', collectibleId: 'breakfast-page', collectibleName: '早餐菜谱页', story: '隔壁的邻居第一次来到餐车，想带一份热早餐回家。', coolingWindowMs: 12000 },
  { id: 2, name: '雨天热汤', description: '热菜出锅后只有短暂保温；别让成品等汤。', recipeIds: ['egg-rice', 'greens-soup', 'tofu-soup', 'egg-tofu'], durationMs: 90000, targetServed: 5, targetScore: 620, orderIntervalMs: 12000, patienceMs: 33000, maxOrders: 3, mechanic: 'warmth', collectibleId: 'rain-coaster', collectibleName: '雨滴杯垫', story: '雨棚下的客人搓着手，热汤最好最后出锅、马上端出。', coolingWindowMs: 2500 },
  { id: 3, name: '双份野餐', description: '成对订单共享备餐，一次备两份但只能存两份。', recipeIds: ['veggie-rice', 'fish-rice', 'greens-soup'], durationMs: 90000, targetServed: 6, targetScore: 850, orderIntervalMs: 10000, patienceMs: 36000, maxOrders: 3, mechanic: 'shared', collectibleId: 'picnic-pattern', collectibleName: '野餐布纹样', story: '两位朋友约好去草地野餐，希望吃到同一道餐食。', coolingWindowMs: 8000 },
  { id: 4, name: '午后烘焙', description: '烤菜占灶更久；趁等待把短订单备好。', recipeIds: ['chicken-bake', 'garden-bake', 'mushroom-egg', 'egg-tofu'], durationMs: 90000, targetServed: 6, targetScore: 950, orderIntervalMs: 9500, patienceMs: 42000, maxOrders: 3, mechanic: 'oven', collectibleId: 'little-oven', collectibleName: '小烤箱摆件', story: '第一份烤菜的香气引来客人，灶台别闲着。', coolingWindowMs: 8000 },
  { id: 5, name: '灯下晚餐', description: '组合餐穿插简单单；按耐心决定稳连击或冲高分。', recipeIds: ['fish-soup', 'egg-tofu', 'tofu-rice', 'mushroom-egg'], durationMs: 90000, targetServed: 7, targetScore: 1150, orderIntervalMs: 9000, patienceMs: 34000, maxOrders: 3, mechanic: 'combination', collectibleId: 'table-lamp-material', collectibleName: '桌灯材料', story: '晚餐灯亮了：有客人慢慢等，也有客人赶着回家。', coolingWindowMs: 8000 },
  { id: 6, name: '小屋宴会', description: '自选三道游戏菜谱；分波次来客，安排好每一锅。', recipeIds: KITCHEN_RECIPES.map(recipe => recipe.id), durationMs: 90000, targetServed: 8, targetScore: 1400, orderIntervalMs: 8000, patienceMs: 34000, maxOrders: 3, mechanic: 'banquet', collectibleId: 'kitchen-sign', collectibleName: '餐车招牌', story: '朋友带着故事来到小屋，菜单由你决定。', coolingWindowMs: 8000 },
]

const recipeFor = (id: string): KitchenRecipe => KITCHEN_RECIPES.find(recipe => recipe.id === id)!
const levelFor = (id: number): KitchenLevel => KITCHEN_LEVELS.find(level => level.id === id) || KITCHEN_LEVELS[0]

export function createKitchenGame(levelId = 1): KitchenGameState {
  const level = levelFor(levelId)
  return {
    levelId: level.id, status: 'ready', elapsedMs: 0, remainingMs: level.durationMs,
    selectedOrderId: null, selectedIngredients: [], orders: [],
    stations: { prep: { job: null }, cook: { job: null }, plate: { job: null } },
    score: 0, combo: 0, bestCombo: 0, served: 0, missed: 0, mistakes: 0, wasted: 0,
    nextOrderAtMs: level.orderIntervalMs, nextOrderNumber: 1,
    feedback: { kind: 'info', message: '先选订单，按配方备餐；灶台忙时可以准备下一单。', sequence: 0 }, result: null,
    bufferedPrep: [], menuIds: level.mechanic === 'banquet' ? ['egg-rice', 'veggie-rice', 'mushroom-egg'] : [...level.recipeIds],
    cleaningMs: 0, stoveIdleMs: 0, recipesServed: [],
  }
}

function cloneState(state: KitchenGameState): KitchenGameState {
  return { ...state, orders: state.orders.map(order => ({ ...order })), selectedIngredients: [...state.selectedIngredients],
    bufferedPrep: state.bufferedPrep.map(job => ({ ...job })), menuIds: [...state.menuIds], recipesServed: [...state.recipesServed],
    stations: { prep: { job: state.stations.prep.job && { ...state.stations.prep.job } },
      cook: { job: state.stations.cook.job && { ...state.stations.cook.job } },
      plate: { job: state.stations.plate.job && { ...state.stations.plate.job } } } }
}

function feedback(state: KitchenGameState, kind: KitchenFeedback['kind'], message: string): KitchenGameState {
  state.feedback = { kind, message, sequence: state.feedback.sequence + 1 }
  return state
}

function mistake(state: KitchenGameState, message: string): KitchenGameState {
  state.mistakes += 1; state.combo = 0
  return feedback(state, 'warning', message)
}

function spawnOrder(state: KitchenGameState): void {
  const level = levelFor(state.levelId)
  if (state.orders.filter(order => order.status === 'waiting').length >= level.maxOrders) return
  const number = state.nextOrderNumber++
  const sequence = level.mechanic === 'shared' ? Math.floor((number - 1) / 2)
    : level.mechanic === 'combination' ? [0, 3, 1, 2, 3, 0][(number - 1) % 6] : number - 1
  const returning = state.orders.find(order => order.status === 'expired' && !order.returned && state.elapsedMs >= order.expiresAtMs + 6000)
  const recipeId = returning?.recipeId || state.menuIds[sequence % state.menuIds.length]
  if (returning) returning.returned = true
  const express = state.elapsedMs >= 15000 && number % 4 === 0
  const patienceMs = express ? Math.floor(level.patienceMs * 0.75) : level.patienceMs
  state.orders.push({ id: `order-${number}`, recipeId, arrivedAtMs: state.elapsedMs,
    expiresAtMs: state.elapsedMs + patienceMs, patienceMs, status: 'waiting', express,
    customer: ['窗边邻居', '雨棚旅人', '草地朋友'][((number - 1) % 3)],
    note: returning ? '再次来访 · 想试试上一份餐食' : level.mechanic === 'shared' ? '一起去野餐 · 可以双份备餐' : express ? '准备回家 · 请优先照顾' : level.story })
  if (!state.selectedOrderId) state.selectedOrderId = `order-${number}`
}

function finishRound(state: KitchenGameState): void {
  const level = levelFor(state.levelId)
  const passed = state.served >= level.targetServed
  let stars: KitchenResult['stars'] = passed ? 1 : 0
  if (passed && state.score >= level.targetScore * 1.25 && state.missed <= 3) stars = 2
  if (passed && state.score >= level.targetScore * 1.6 && state.missed <= 1 && state.wasted === 0) stars = 3
  const advice = state.wasted > 0 ? '熟度到达亮区就移到装盘台，别让灶台上的食材等太久。'
    : state.missed > 0 ? '优先处理耐心较短的订单，灶台忙时备好下一单。'
      : state.mistakes > 0 ? '先选顾客再核对配方；成品要送给对应的顾客。'
        : state.stoveIdleMs >= 12000 ? `灶台空了${Math.floor(state.stoveIdleMs / 1000)}秒，下局可以先把暖汤煮上，再备下一份。`
          : passed ? '配合得很好！试试同时备餐与烹饪，争取更长连击。' : '下一局先完成简单订单，用连击提高分数。'
  state.status = 'finished'; state.remainingMs = 0
  state.result = { levelId: state.levelId, stars, passed, score: state.score, served: state.served, missed: state.missed,
    wasted: state.wasted, bestCombo: state.bestCombo, targetServed: level.targetServed, targetScore: level.targetScore, advice,
    collectibleIds: passed ? [level.collectibleId] : [], recipesServed: [...state.recipesServed], stoveIdleMs: state.stoveIdleMs }
  feedback(state, passed ? 'success' : 'info', passed ? '餐车挑战完成，来看看本局的好表现。' : '本局结束，复盘后可以再来一局。')
}

function refreshJob(job: KitchenJob, station: KitchenStationId, coolingWindowMs = 8000): void {
  const recipe = recipeFor(job.recipeId)
  if (station === 'cook') {
    const duration = job.cookDurationMs || recipe.cookMs
    job.progress = Math.min(1.55, job.cookWorkUnits / (duration * (50 + recipe.idealHeat)))
    job.quality = Math.max(0, 100 - Math.floor(job.heatExposure / (duration * 2)))
  } else {
    job.progress = Math.min(1, job.elapsedMs / (station === 'prep' ? recipe.prepMs : recipe.plateMs))
    if (station === 'plate') {
      const cooling = Math.floor(Math.max(0, job.elapsedMs - recipe.plateMs - coolingWindowMs) * 1.5 / 1000)
      job.quality = Math.max(40, job.baseQuality - cooling)
    }
  }
}

/** Pure elapsed-time simulation. Paused time is intentionally never consumed. */
export function advanceKitchenGame(original: KitchenGameState, elapsedMs: number): KitchenGameState {
  if (original.status !== 'running' || !Number.isFinite(elapsedMs) || elapsedMs < 1) return original
  const state = cloneState(original)
  const level = levelFor(state.levelId)
  const target = Math.min(level.durationMs, state.elapsedMs + Math.floor(elapsedMs))
  while (state.elapsedMs < target) {
    let step = Math.min(target - state.elapsedMs, state.nextOrderAtMs - state.elapsedMs)
    if (state.cleaningMs > 0) step = Math.min(step, state.cleaningMs)
    for (const order of state.orders) if (order.status === 'waiting') step = Math.min(step, order.expiresAtMs - state.elapsedMs)
    for (const station of ['prep', 'cook', 'plate'] as KitchenStationId[]) {
      const job = state.stations[station].job
      if (!job || job.stage === 'burnt') continue
      const recipe = recipeFor(job.recipeId)
      if (station === 'cook') {
        const threshold = (job.stage === 'working' ? 1 : 1.55) * (job.cookDurationMs || recipe.cookMs) * (50 + recipe.idealHeat)
        step = Math.min(step, Math.ceil((threshold - job.cookWorkUnits) / (50 + job.heat)))
      } else if (job.stage === 'working') {
        step = Math.min(step, (station === 'prep' ? recipe.prepMs : recipe.plateMs) - job.elapsedMs)
      }
    }
    // All event times are integer milliseconds; a defensive lower bound avoids a stalled clock.
    step = Math.max(1, step)
    if (!state.stations.cook.job && state.cleaningMs === 0) state.stoveIdleMs += step
    state.cleaningMs = Math.max(0, state.cleaningMs - step)
    state.elapsedMs += step
    for (const job of state.bufferedPrep) {
      job.elapsedMs += step
      refreshJob(job, 'prep')
      if (job.progress >= 1) job.stage = 'ready'
    }
    for (const station of ['prep', 'cook', 'plate'] as KitchenStationId[]) {
      const job = state.stations[station].job
      if (!job || job.stage === 'burnt') continue
      job.elapsedMs += step
      if (station === 'cook') { job.cookWorkUnits += step * (50 + job.heat); job.heatExposure += step * Math.abs(job.heat - recipeFor(job.recipeId).idealHeat) }
      refreshJob(job, station, level.coolingWindowMs)
      if (station === 'cook' && job.progress >= 1.55) {
        job.stage = 'burnt'; job.quality = 0; state.wasted += 1; state.combo = 0
        feedback(state, 'warning', '灶台上的食材烧焦了，收拾灶台后重新制作。')
      } else if (job.stage === 'working' && job.progress >= 1) {
        job.stage = 'ready'
        feedback(state, 'success', station === 'prep' ? '备餐完成，空出灶台后移去烹饪。' : station === 'cook' ? '火候正好！尽快移去装盘，继续加热会烧焦。' : '装盘完成，送给对应的顾客。')
      }
    }
    for (const order of state.orders) {
      if (order.status !== 'waiting' || order.expiresAtMs > state.elapsedMs) continue
      order.status = 'expired'; state.missed += 1; state.combo = 0
      if (state.selectedOrderId === order.id) { state.selectedOrderId = null; state.selectedIngredients = [] }
      feedback(state, 'warning', `${recipeFor(order.recipeId).name}的顾客等不及了，调整一下下一单的顺序。`)
    }
    if (state.elapsedMs >= level.durationMs) { finishRound(state); break }
    if (state.elapsedMs >= state.nextOrderAtMs) {
      spawnOrder(state)
      const banquetWave = level.mechanic === 'banquet' && state.nextOrderNumber % 3 !== 1
      state.nextOrderAtMs += banquetWave ? 1800 : state.elapsedMs >= 60000 ? Math.floor(level.orderIntervalMs * 0.7) : level.orderIntervalMs
    }
    if (!state.selectedOrderId) state.selectedOrderId = state.orders.find(order => order.status === 'waiting')?.id || null
  }
  state.remainingMs = Math.max(0, level.durationMs - state.elapsedMs)
  return state
}

export function applyKitchenAction(original: KitchenGameState, action: KitchenAction): KitchenGameState {
  if (original.status === 'finished') return original
  if (action.type === 'set-menu') {
    if (original.status !== 'ready' || levelFor(original.levelId).mechanic !== 'banquet') return original
    const ids = [...new Set(action.recipeIds)]
    const ingredients = new Set(ids.flatMap(id => KITCHEN_RECIPES.find(recipe => recipe.id === id)?.ingredients || []))
    if (ids.length !== 3 || ids.some(id => !KITCHEN_RECIPES.some(recipe => recipe.id === id)) || ingredients.size > 6) {
      return feedback(cloneState(original), 'warning', '宴会选三道菜，食材总共不超过六种。')
    }
    return feedback({ ...cloneState(original), menuIds: ids }, 'success', '宴会菜单已定，三道菜共用这一份食材架。')
  }
  if (action.type === 'start') {
    if (original.status !== 'ready') return original
    const state = cloneState(original); state.status = 'running'; spawnOrder(state); spawnOrder(state)
    return feedback(state, 'info', '开张啦！先选一份订单，找到配方食材。')
  }
  if (action.type === 'pause') return original.status === 'running' ? { ...original, status: 'paused' } : original
  if (action.type === 'resume') return original.status === 'paused' ? { ...original, status: 'running' } : original
  if (original.status !== 'running') return original
  const state = cloneState(original)
  switch (action.type) {
    case 'select-order': {
      const order = state.orders.find(item => item.id === action.orderId && item.status === 'waiting')
      if (!order) return feedback(state, 'warning', '这位顾客已经离开，请选择其他订单。')
      state.selectedOrderId = order.id; state.selectedIngredients = []
      return feedback(state, 'info', `${recipeFor(order.recipeId).name}：按配方选择食材。`)
    }
    case 'toggle-ingredient': {
      const pool = new Set(state.menuIds.flatMap(id => recipeFor(id).ingredients))
      if (!pool.has(action.ingredientId)) return feedback(state, 'warning', '本关食材架没有这份食材。')
      state.selectedIngredients = state.selectedIngredients.includes(action.ingredientId)
        ? state.selectedIngredients.filter(id => id !== action.ingredientId) : [...state.selectedIngredients, action.ingredientId]
      return state
    }
    case 'clear-ingredients': state.selectedIngredients = []; return state
    case 'prepare':
    case 'prepare-stock':
    case 'prepare-batch': {
      const existing = state.stations.prep.job
      if (existing?.stage === 'working') return feedback(state, 'warning', '备餐台正在忙，等这一份切配完成再继续。')
      if ((existing ? 1 : 0) + state.bufferedPrep.length >= 2) return feedback(state, 'warning', '半成品最多留两份，先把一份送上灶台。')
      const order = state.orders.find(item => item.id === state.selectedOrderId && item.status === 'waiting')
      if (!order) return feedback(state, 'warning', '先选择一位等餐的顾客。')
      const jobs = [...Object.values(state.stations).flatMap(station => station.job ? [station.job] : []), ...state.bufferedPrep]
      if (action.type !== 'prepare-stock' && jobs.some(job => job.orderId === order.id)) return feedback(state, 'warning', '这份订单已经在制作，可以先准备其他顾客的餐食。')
      const recipe = recipeFor(order.recipeId)
      if (state.selectedIngredients.length !== recipe.ingredients.length || !recipe.ingredients.every(id => state.selectedIngredients.includes(id))) {
        return mistake(state, '食材与配方不一致，核对食材后再开始。')
      }
      const pair = action.type === 'prepare-batch' ? state.orders.find(item => item.id !== order.id && item.recipeId === order.recipeId && item.status === 'waiting' && !jobs.some(job => job.orderId === item.id)) : null
      if (action.type === 'prepare-batch' && (!pair || levelFor(state.levelId).mechanic !== 'shared' || existing || state.bufferedPrep.length)) return feedback(state, 'warning', '双份备餐需要两张同菜订单与两个半成品空位。')
      if (existing) state.bufferedPrep.push(existing)
      const job: KitchenJob = { orderId: action.type === 'prepare-stock' ? `stock-${state.elapsedMs}-${order.id}` : order.id, recipeId: recipe.id, stage: 'working', progress: 0,
        quality: 100, baseQuality: 100, heat: recipe.idealHeat, elapsedMs: 0, cookWorkUnits: 0, heatExposure: 0,
        cookDurationMs: recipe.cookMs * (levelFor(state.levelId).mechanic === 'oven' && recipe.cookLabel === '烘烤' ? 1.7 : 1), batch: Boolean(pair) }
      state.stations.prep.job = job
      if (pair) state.bufferedPrep.push({ ...job, orderId: pair.id })
      state.selectedIngredients = []
      return feedback(state, 'info', pair ? '共用配菜一次切好，两份餐食会占满半成品架。' : action.type === 'prepare-stock' ? '多备的一份会留在半成品架，遇到同菜订单再送灶台。' : `${recipe.prepLabel}进行中，可以查看下一位顾客的配方。`)
    }
    case 'move': {
      const bufferedIndex = action.from === 'prep' && action.orderId ? state.bufferedPrep.findIndex(item => item.orderId === action.orderId) : -1
      const job = bufferedIndex >= 0 ? state.bufferedPrep[bufferedIndex] : state.stations[action.from].job
      const to: KitchenStationId = action.from === 'prep' ? 'cook' : 'plate'
      if (!job) return feedback(state, 'warning', '这个工位还没有餐食。')
      if (job.stage === 'burnt') return feedback(state, 'warning', '烧焦的食材不能递餐，请先收拾灶台。')
      if (to === 'cook' && state.cleaningMs > 0) return feedback(state, 'warning', `清锅还剩${Math.ceil(state.cleaningMs / 1000)}秒，可以先备下一单。`)
      if (state.stations[to].job) return feedback(state, 'warning', to === 'cook' ? '灶台还没有空位，先装盘或收拾。' : '装盘台还没有空位，先递餐或收拾。')
      if ((action.from === 'prep' && job.stage !== 'ready') || (action.from === 'cook' && job.progress < 0.65)) return feedback(state, 'warning', '工序还没完成，稍等片刻。')
      if (job.orderId.startsWith('stock-') || state.orders.find(order => order.id === job.orderId)?.status === 'expired') {
        const occupied = [...Object.values(state.stations).flatMap(station => station.job ? [station.job.orderId] : []), ...state.bufferedPrep.map(item => item.orderId)]
        const target = state.orders.find(order => order.status === 'waiting' && order.recipeId === job.recipeId && !occupied.includes(order.id))
        if (!target) return feedback(state, 'info', '还没有需要这份预备菜的顾客，先保留在半成品架。')
        job.orderId = target.id
      }
      if (action.from === 'cook') {
        const under = Math.max(0, 1 - job.progress) * 70
        const over = Math.max(0, job.progress - 1.2) * 100
        job.quality = Math.max(1, job.quality - Math.round(under + over))
      }
      state.stations[to].job = { ...job, baseQuality: job.quality, elapsedMs: 0, progress: 0, stage: 'working' }
      if (bufferedIndex >= 0) state.bufferedPrep.splice(bufferedIndex, 1)
      else state.stations[action.from].job = null
      return feedback(state, 'info', to === 'cook' ? '开始烹饪：亮区是最佳火候，留意灶台进度。' : '开始装盘，完成后尽快递餐。')
    }
    case 'heat': {
      const job = state.stations.cook.job
      if (!job || job.stage === 'burnt' || !Number.isFinite(action.value)) return original
      job.heat = Math.max(0, Math.min(100, Math.round(action.value)))
      return state
    }
    case 'serve': {
      const job = state.stations.plate.job
      if (!job || job.stage !== 'ready') return feedback(state, 'warning', '等装盘完成后再递餐。')
      const order = state.orders.find(item => item.id === (action.orderId || job.orderId))
      if (!order || order.id !== job.orderId || order.status !== 'waiting') return mistake(state, '餐食没有对应这位等餐的顾客，核对订单或收拾成品。')
      const recipe = recipeFor(job.recipeId)
      const quality = job.quality
      const qualityMultiplier = quality >= 90 ? 1.2 : quality >= 70 ? 1.1 : 1
      const comboMultiplier = 1 + Math.min(6, state.combo) * 0.05
      const points = Math.round(recipe.baseScore * qualityMultiplier * comboMultiplier)
      state.score += points; state.served += 1; state.combo += 1; state.bestCombo = Math.max(state.bestCombo, state.combo)
      if (!state.recipesServed.includes(recipe.id)) state.recipesServed.push(recipe.id)
      order.status = 'served'; state.stations.plate.job = null
      if (state.selectedOrderId === order.id) {
        state.selectedOrderId = state.orders.find(item => item.status === 'waiting')?.id || null; state.selectedIngredients = []
      }
      return feedback(state, 'success', `${recipe.name}递餐成功 +${points}分，${quality >= 90 ? '完美火候' : quality >= 70 ? '品质良好' : '下次再练火候'}${state.combo > 1 ? ` · ${state.combo}连击` : ''}。`)
    }
    case 'discard': {
      const job = state.stations[action.station].job
      if (!job) return original
      if (job.stage !== 'burnt') state.wasted += 1
      state.stations[action.station].job = null; state.combo = 0
      if (action.station === 'cook') state.cleaningMs = 2000
      return feedback(state, 'info', action.station === 'cook' ? '清锅需要两秒，趁这会儿备下一份餐。' : '工位收拾好了，重新选择订单继续。')
    }
    case 'discard-prepared': {
      if (!state.bufferedPrep.some(job => job.orderId === action.orderId)) return original
      state.bufferedPrep = state.bufferedPrep.filter(job => job.orderId !== action.orderId)
      state.wasted += 1; state.combo = 0
      return feedback(state, 'info', '半成品空出一个位置，可以继续备餐；总分不扣除。')
    }
    default: return original
  }
}
