export type MergeCategory = 'grain' | 'greens' | 'protein'
export type MergeDirection = 'up' | 'down' | 'left' | 'right'
export interface MergeTile { id: string; category: MergeCategory; rank: number }
export interface MergeRequirement { category: MergeCategory; rank: number }
export interface MergeRecipe { id: string; name: string; requirements: MergeRequirement[] }
export interface MergeLevel {
  id: number; name: string; description: string; maxSteps: number; obstacles: number[]
  recipeIds: string[]; ordered: boolean; targetRank: number; collectible: string; collectibleName: string
  initial: { cell: number; category: MergeCategory; rank: number }[]; sequence: MergeCategory[]
}
export interface MergeResult {
  game: 'merge'; levelId: number; score: number; completed: boolean; stars: number
  collectibles: string[]; detail: Record<string, number>
}
export interface MergeSnapshot {
  board: (MergeTile | null)[]; steps: number; score: number; cursor: number; nextTileId: number
  completedRecipeIds: string[]; highestRank: number; merges: number
}
export interface MergeGameState extends MergeSnapshot {
  levelId: number; seed: number; status: 'ready' | 'running' | 'paused' | 'finished'
  selectedRecipeId: string | null; selectedCells: number[]; undoAvailable: boolean
  previous: MergeSnapshot | null; feedback: { message: string; sequence: number; warning: boolean }
  result: MergeResult | null
}
export type MergeAction =
  | { type: 'start' | 'pause' | 'resume' | 'undo' }
  | { type: 'slide'; direction: MergeDirection }
  | { type: 'choose-recipe'; recipeId: string }
  | { type: 'toggle-cell'; cell: number }
  | { type: 'submit' }

export const MERGE_CATEGORIES: Record<MergeCategory, { name: string; mark: string }> = {
  grain: { name: '主食', mark: '米' }, greens: { name: '蔬果', mark: '叶' }, protein: { name: '蛋白', mark: '豆' },
}
const need = (category: MergeCategory, rank = 1): MergeRequirement => ({ category, rank })
export const MERGE_RECIPES: MergeRecipe[] = [
  { id: 'breakfast', name: '三色早餐', requirements: [need('grain'), need('greens'), need('protein')] },
  { id: 'morning-bowl', name: '晨光小碗', requirements: [need('grain'), need('greens'), need('protein')] },
  { id: 'lunch-rice', name: '清爽饭盘', requirements: [need('grain', 2), need('greens'), need('protein')] },
  { id: 'lunch-garden', name: '绿意午餐', requirements: [need('greens', 2), need('grain'), need('protein')] },
  { id: 'basket-soup', name: '篮中暖汤', requirements: [need('greens', 2), need('protein')] },
  { id: 'basket-rice', name: '整理饭盘', requirements: [need('grain', 2), need('greens'), need('protein')] },
  { id: 'bento-main', name: '便当 · 主菜', requirements: [need('grain', 2), need('protein')] },
  { id: 'bento-side', name: '便当 · 配菜', requirements: [need('greens', 2), need('grain')] },
  { id: 'shared-rice', name: '共享饭盘', requirements: [need('grain', 2), need('greens'), need('protein', 2)] },
  { id: 'shared-garden', name: '共享菜盘', requirements: [need('greens', 2), need('grain'), need('protein', 2)] },
  { id: 'shared-side', name: '桌边小菜', requirements: [need('grain'), need('greens')] },
  { id: 'season-rice', name: '季节饭盘', requirements: [need('grain', 2), need('greens'), need('protein')] },
  { id: 'season-soup', name: '季节暖汤', requirements: [need('greens', 2), need('protein')] },
  { id: 'season-side', name: '季节小碗', requirements: [need('grain'), need('greens'), need('protein', 2)] },
]
const initial = (...items: [number, MergeCategory, number?][]): MergeLevel['initial'] => items.map(([cell, category, rank = 1]) => ({ cell, category, rank }))
const standardSequence: MergeCategory[] = ['greens', 'protein', 'grain', 'greens', 'grain', 'protein']
export const MERGE_LEVELS: MergeLevel[] = [
  { id: 1, name: '早餐三色', description: '没有障碍：先交两份一级配方，学会留出空位。', maxSteps: 28, obstacles: [], recipeIds: ['breakfast', 'morning-bowl'], ordered: true, targetRank: 1, collectible: 'merge-tricolor-plate', collectibleName: '三色陶盘', initial: initial([0, 'grain'], [4, 'grain'], [10, 'greens'], [20, 'protein']), sequence: standardSequence },
  { id: 2, name: '清爽午餐', description: '主食与蔬果各合成二级；不要提前交走全部低阶棋子。', maxSteps: 32, obstacles: [], recipeIds: ['lunch-rice', 'lunch-garden'], ordered: false, targetRank: 2, collectible: 'merge-leaf-bowl', collectibleName: '叶纹碗', initial: initial([0, 'grain'], [4, 'grain'], [10, 'greens'], [11, 'greens'], [20, 'protein']), sequence: standardSequence },
  { id: 3, name: '篮中整理', description: '两个收纳篮把路线分开，按先汤后饭的顺序交配方。', maxSteps: 32, obstacles: [7, 17], recipeIds: ['basket-soup', 'basket-rice'], ordered: true, targetRank: 2, collectible: 'merge-basket-material', collectibleName: '收纳篮材料', initial: initial([0, 'grain'], [4, 'grain'], [10, 'greens'], [11, 'greens'], [20, 'protein']), sequence: standardSequence },
  { id: 4, name: '露营便当', description: '一份便当分主菜和配菜两阶段，完成前一格再做下一格。', maxSteps: 34, obstacles: [], recipeIds: ['bento-main', 'bento-side'], ordered: true, targetRank: 2, collectible: 'merge-bento-mat', collectibleName: '便当餐垫', initial: initial([0, 'grain'], [4, 'grain'], [10, 'greens'], [11, 'greens'], [20, 'protein']), sequence: ['grain', 'greens', 'protein', 'greens', 'grain', 'protein'] },
  { id: 5, name: '共享餐桌', description: '三道配方同时开放，两道主菜都需要稀缺的二级蛋白。', maxSteps: 36, obstacles: [], recipeIds: ['shared-rice', 'shared-garden', 'shared-side'], ordered: false, targetRank: 2, collectible: 'merge-wood-tray-material', collectibleName: '木托盘材料', initial: initial([0, 'grain'], [4, 'grain'], [10, 'greens'], [11, 'greens'], [20, 'protein'], [21, 'protein']), sequence: ['grain', 'greens', 'protein', 'grain', 'greens', 'grain', 'protein', 'greens'] },
  { id: 6, name: '季节拼盘', description: '中央障碍改变滑动路径：合出四级食材，再完成三份餐盘。', maxSteps: 36, obstacles: [12], recipeIds: ['season-rice', 'season-soup', 'season-side'], ordered: false, targetRank: 4, collectible: 'merge-season-nameplate', collectibleName: '季节展示架铭牌', initial: initial([0, 'grain'], [4, 'grain'], [5, 'greens'], [6, 'greens'], [10, 'greens'], [15, 'protein'], [16, 'protein'], [20, 'grain', 3], [21, 'grain', 3]), sequence: standardSequence },
]
export const mergeLevelFor = (levelId: number): MergeLevel => MERGE_LEVELS.find(level => level.id === levelId) || MERGE_LEVELS[0]
export const mergeRecipeFor = (recipeId: string): MergeRecipe | undefined => MERGE_RECIPES.find(recipe => recipe.id === recipeId)

function cloneBoard(board: (MergeTile | null)[]) { return board.map(tile => tile && { ...tile }) }
function snapshot(state: MergeSnapshot): MergeSnapshot {
  return { board: cloneBoard(state.board), steps: state.steps, score: state.score, cursor: state.cursor, nextTileId: state.nextTileId, completedRecipeIds: [...state.completedRecipeIds], highestRank: state.highestRank, merges: state.merges }
}
function cloneState(state: MergeGameState): MergeGameState { return { ...state, ...snapshot(state), selectedCells: [...state.selectedCells] } }
function message(state: MergeGameState, text: string, warning = false): MergeGameState {
  state.feedback = { message: text, warning, sequence: state.feedback.sequence + 1 }; return state
}
function seededIndex(seed: number, cursor: number, length: number): number {
  let value = (seed ^ Math.imul(cursor + 1, 0x9e3779b9)) >>> 0
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0; value ^= value >>> 13
  return (value >>> 0) % length
}
export function getMergePreview(state: MergeGameState, count = 2): MergeRequirement[] {
  const sequence = mergeLevelFor(state.levelId).sequence
  const offset = (state.seed >>> 0) % sequence.length
  return Array.from({ length: Math.max(0, Math.min(5, Math.floor(count))) }, (_, index) => need(sequence[(offset + state.cursor + index) % sequence.length]))
}
function spawn(state: MergeGameState): void {
  const level = mergeLevelFor(state.levelId)
  const empty = state.board.map((tile, cell) => !tile && !level.obstacles.includes(cell) ? cell : -1).filter(cell => cell >= 0)
  if (!empty.length) return
  const next = getMergePreview(state, 1)[0]
  const cell = empty[seededIndex(state.seed, state.cursor, empty.length)]
  state.board[cell] = { ...next, id: `tile-${state.nextTileId++}` }; state.cursor += 1
}
export function createMergeGame(levelId = 1, seed = levelId * 3600): MergeGameState {
  const level = mergeLevelFor(levelId)
  const board: (MergeTile | null)[] = Array.from({ length: 25 }, () => null)
  level.initial.forEach((item, index) => { board[item.cell] = { id: `tile-${index + 1}`, category: item.category, rank: item.rank } })
  return { levelId: level.id, seed: Number.isFinite(seed) ? Math.floor(seed) >>> 0 : level.id * 3600, status: 'ready', board, score: 0, steps: 0, cursor: 0, nextTileId: level.initial.length + 1, highestRank: Math.max(1, ...level.initial.map(item => item.rank)), merges: 0, completedRecipeIds: [], selectedRecipeId: null, selectedCells: [], undoAvailable: true, previous: null, feedback: { message: '先看目标配方：滑动合成，选中食材后交菜腾空位。', sequence: 0, warning: false }, result: null }
}
export function getAvailableMergeRecipes(state: MergeGameState): MergeRecipe[] {
  const level = mergeLevelFor(state.levelId)
  const remaining = level.recipeIds.filter(id => !state.completedRecipeIds.includes(id))
  return (level.ordered ? remaining.slice(0, 1) : remaining).map(id => mergeRecipeFor(id)!).filter(Boolean)
}
export function getRecipeCells(state: MergeGameState, recipe: MergeRecipe): number[] | null {
  const used: number[] = []
  for (const requirement of recipe.requirements) {
    const cell = state.board.findIndex((tile, index) => !used.includes(index) && tile?.category === requirement.category && tile.rank === requirement.rank)
    if (cell < 0) return null
    used.push(cell)
  }
  return used
}
function orientedLines(direction: MergeDirection): number[][] {
  const horizontal = direction === 'left' || direction === 'right'
  const reverse = direction === 'right' || direction === 'down'
  return Array.from({ length: 5 }, (_, line) => Array.from({ length: 5 }, (__, pos) => {
    const offset = reverse ? 4 - pos : pos; return horizontal ? line * 5 + offset : offset * 5 + line
  }))
}
function canMerge(a: MergeTile | null, b: MergeTile | null): boolean { return Boolean(a && b && a.category === b.category && a.rank === b.rank && a.rank < 4) }
export function isMergeBlocked(state: MergeGameState): boolean {
  const obstacles = mergeLevelFor(state.levelId).obstacles
  if (state.board.some((tile, cell) => !tile && !obstacles.includes(cell))) return false
  for (let cell = 0; cell < 25; cell += 1) {
    if (obstacles.includes(cell)) continue
    if (cell % 5 < 4 && !obstacles.includes(cell + 1) && canMerge(state.board[cell], state.board[cell + 1])) return false
    if (cell < 20 && !obstacles.includes(cell + 5) && canMerge(state.board[cell], state.board[cell + 5])) return false
  }
  return !getAvailableMergeRecipes(state).some(recipe => getRecipeCells(state, recipe))
}
function finishIfNeeded(state: MergeGameState): void {
  const level = mergeLevelFor(state.levelId)
  const completed = level.recipeIds.every(id => state.completedRecipeIds.includes(id)) && state.highestRank >= level.targetRank
  const blocked = isMergeBlocked(state)
  if (!completed && state.steps < level.maxSteps && !blocked) return
  state.status = 'finished'; state.selectedCells = []; state.previous = null
  const stars = completed ? state.steps <= Math.floor(level.maxSteps * .65) && state.undoAvailable ? 3 : state.steps <= Math.floor(level.maxSteps * .8) ? 2 : 1 : 0
  state.result = { game: 'merge', levelId: state.levelId, score: state.score, completed, stars, collectibles: completed ? [level.collectible] : [], detail: { steps: state.steps, plates: state.completedRecipeIds.length, highestRank: state.highestRank, merges: state.merges, blocked: blocked ? 1 : 0 } }
  message(state, completed ? `餐盘完成！${level.collectibleName}可以带回小屋。` : blocked ? '棋盘暂时排满了。已完成的餐盘会保留，下次试着早点交菜。' : '这次的步数用完了。已经交出的餐盘仍是你的成果。', !completed)
}

export function applyMergeAction(original: MergeGameState, action: MergeAction): MergeGameState {
  if (action.type === 'start') return original.status === 'ready' ? { ...original, status: 'running' } : original
  if (action.type === 'pause') return original.status === 'running' ? { ...original, status: 'paused' } : original
  if (action.type === 'resume') return original.status === 'paused' ? { ...original, status: 'running' } : original
  if (original.status !== 'running') return original
  const state = cloneState(original)
  if (action.type === 'choose-recipe') {
    if (!getAvailableMergeRecipes(state).some(recipe => recipe.id === action.recipeId)) return original
    state.selectedRecipeId = action.recipeId; state.selectedCells = []
    return message(state, '按配方点选对应等级的棋子，再确认交菜。')
  }
  if (action.type === 'toggle-cell') {
    if (!Number.isInteger(action.cell) || !state.board[action.cell] || !state.selectedRecipeId) return original
    state.selectedCells = state.selectedCells.includes(action.cell) ? state.selectedCells.filter(cell => cell !== action.cell) : [...state.selectedCells, action.cell]
    return state
  }
  if (action.type === 'undo') {
    if (!state.undoAvailable || !state.previous) return original
    const previous = snapshot(state.previous)
    return message({ ...state, ...previous, previous: null, undoAvailable: false, selectedCells: [], selectedRecipeId: null }, '撤回上一整步：棋盘、分数、步数与下一枚都回到了原处。')
  }
  if (action.type === 'submit') {
    const recipe = getAvailableMergeRecipes(state).find(item => item.id === state.selectedRecipeId)
    if (!recipe) return message(state, '先选一张当前可做的配方。', true)
    const chosen = state.selectedCells.map(cell => state.board[cell]).filter((tile): tile is MergeTile => Boolean(tile))
    const key = (tile: MergeRequirement) => `${tile.category}:${tile.rank}`
    if (chosen.length !== recipe.requirements.length || chosen.map(key).sort().join('|') !== recipe.requirements.map(key).sort().join('|')) return message(state, '食材类别或等级还没对上；保留棋盘，再按配方选一次。', true)
    state.previous = snapshot(original)
    state.selectedCells.forEach(cell => { state.board[cell] = null })
    state.score += 150 + recipe.requirements.reduce((sum, item) => sum + item.rank * 20, 0)
    state.completedRecipeIds.push(recipe.id); state.steps += 1; state.selectedCells = []; state.selectedRecipeId = null
    message(state, `${recipe.name}端上桌了，空出的格子可以继续合成。`)
    finishIfNeeded(state); return state
  }
  if (action.type === 'slide') {
    if (!['left', 'right', 'up', 'down'].includes(action.direction)) return original
    const obstacles = mergeLevelFor(state.levelId).obstacles
    for (const line of orientedLines(action.direction)) {
      const segments: number[][] = [[]]
      line.forEach(cell => { if (obstacles.includes(cell)) segments.push([]); else segments[segments.length - 1].push(cell) })
      for (const segment of segments) {
        const tiles = segment.map(cell => state.board[cell]).filter((tile): tile is MergeTile => Boolean(tile))
        const folded: MergeTile[] = []
        for (let index = 0; index < tiles.length; index += 1) {
          if (canMerge(tiles[index], tiles[index + 1] || null)) {
            const merged = { category: tiles[index].category, rank: tiles[index].rank + 1, id: `tile-${state.nextTileId++}` }
            folded.push(merged); state.score += merged.rank * 20; state.highestRank = Math.max(state.highestRank, merged.rank); state.merges += 1; index += 1
          } else folded.push(tiles[index])
        }
        segment.forEach((cell, index) => { state.board[cell] = folded[index] || null })
      }
    }
    if (state.board.every((tile, cell) => tile?.id === original.board[cell]?.id)) return original
    state.previous = snapshot(original); state.steps += 1; state.selectedCells = []; state.selectedRecipeId = null
    const newMerges = state.merges - original.merges
    spawn(state); message(state, newMerges ? `合成了${newMerges}次。留意下一枚，也别忘了可以交菜腾空间。` : '棋盘移动了，下一枚食材已经落下。')
    finishIfNeeded(state); return state
  }
  return original
}

/** Serializable candidate checkpoint; the owning page decides storage and account binding. */
export function exportMergeCheckpoint(state: MergeGameState): { version: 1; game: 'merge'; state: MergeGameState } {
  return { version: 1, game: 'merge', state: JSON.parse(JSON.stringify(state)) as MergeGameState }
}

export interface MergeHint { direction?: MergeDirection; recipeId?: string; cells: number[]; message: string }
/** One-step suggestion only: simulations never mutate the player's board or random cursor. */
export function getMergeHint(state: MergeGameState): MergeHint | null {
  if (state.status !== 'running') return null
  for (const recipe of getAvailableMergeRecipes(state)) {
    const cells = getRecipeCells(state, recipe)
    if (cells) return { recipeId: recipe.id, cells, message: `${recipe.name}的食材已经齐了。先交这份，能腾出 ${cells.length} 格。` }
  }
  const labels: Record<MergeDirection, string> = { up: '上', down: '下', left: '左', right: '右' }
  const candidates = (['up', 'left', 'down', 'right'] as MergeDirection[]).map(direction => {
    const next = applyMergeAction(state, { type: 'slide', direction })
    const ready = getAvailableMergeRecipes(next).find(recipe => getRecipeCells(next, recipe))
    const merges = next.merges - state.merges
    const empty = next.board.filter(tile => !tile).length
    const rating = (next.result?.completed ? 10000 : next.status === 'finished' ? -10000 : 0) + (ready ? 1000 : 0) + merges * 20 + empty
    return { direction, next, ready, merges, rating }
  }).filter(item => item.next !== state).sort((a, b) => b.rating - a.rating)
  const best = candidates[0]
  if (!best || (best.next.status === 'finished' && !best.next.result?.completed)) return { cells: [], message: state.undoAvailable && state.previous ? '这一步没有安全的滑动方向，可以考虑撤回一步重新安排。' : '暂时没有安全的滑动方向，看看已完成的餐盘，下次可以更早交菜腾空间。' }
  return { direction: best.direction, cells: [], message: `可以试着向${labels[best.direction]}滑：${best.ready ? `下一步可备齐${best.ready.name}。` : best.merges ? `能合成 ${best.merges} 次，之后留意低级配方。` : '先整理位置，再观察下一枚食材。'}这是一步建议，不保证整局最优。` }
}
