import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import * as ts from 'typescript'
import Taro from '@tarojs/taro'
import { advanceAuthSession, captureAuthSession, isAuthSessionCurrent } from '../../src/utils/auth-session'

// Execute the page's real request functions with controlled network order.
// Heavy native Map/Canvas components are outside this list concurrency test.
const source = readFileSync(join(__dirname, '../../src/packageExtra/pages/food-library/index.tsx'), 'utf8')
const ast = ts.createSourceFile('food-library.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function pageCallback(name: string): string {
  let callback = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      callback = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText(ast) : node.initializer.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!callback) throw new Error(`Missing page callback ${name}`)
  return callback
}

let viewChangeEffect = ''
function findViewChangeEffect(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[1]?.getText(ast) === '[tabMode, viewMode]') viewChangeEffect = node.arguments[0].getText(ast)
  ts.forEachChild(node, findViewChangeEffect)
}
findViewChangeEffect(ast)
if (!viewChangeEffect) throw new Error('Missing view change lifecycle')

function deferred() {
  let resolve!: (value: any) => void
  let reject!: (reason: Error) => void
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function harness() {
  const state = { list: [] as any[], loading: false, error: false, spot: null as any, refreshing: false }
  const queue: ReturnType<typeof deferred>[] = []
  const sandbox: any = {
    exports: {}, captureAuthSession, isAuthSessionCurrent,
    getAccessToken: () => captureAuthSession().token,
    setList: (value: any[]) => { state.list = value },
    setLoading: (value: boolean) => { state.loading = value },
    setListError: (value: boolean) => { state.error = value },
    setSpotDishes: (value: any) => { state.spot = value },
    setRefreshing: (value: boolean) => { state.refreshing = value },
    setShowSkeleton: jest.fn(), clearCache: jest.fn(), saveToCache: jest.fn(),
    getPublicFoodLibraryList: jest.fn(() => queue.shift()!.promise), showUnifiedApiError: jest.fn(),
    listRequestRef: { current: 0 }, spotDishRequestRef: { current: 0 },
    pageMountedRef: { current: true }, listContextRef: { current: true }, spotContextRef: { current: true },
    lastRefreshTime: { current: 0 }, CACHE_DURATION: 300000, SPOT_DISH_PAGE_SIZE: 50,
    sortBy: 'latest', filterFatLoss: undefined, searchMerchant: '',
    listQueryRef: { current: { sortBy: 'latest', filterFatLoss: undefined, searchMerchant: '' } },
    CACHE_KEYS: { LIST: 'food_library_list_cache', FILTERS: 'food_library_filters_cache' }, Taro,
    setSortBy: jest.fn(), setFilterFatLoss: jest.fn(), setSearchMerchant: jest.fn(), setSearchKeyword: jest.fn(),
    list: [{ id: 'A', liked: false, like_count: 0 }],
    likePublicFoodLibraryItem: jest.fn(), unlikePublicFoodLibraryItem: jest.fn(),
    console: { error: jest.fn(), log: jest.fn() }, Date,
  }
  const code = ['isCurrentListRequest', 'canApplyListMutation', 'loadFromCache', 'loadList', 'refreshList', 'loadSpotDishes', 'handleLike']
    .map(name => `var ${name} = ${pageCallback(name)}; exports.${name} = ${name};`).join('\n')
  runInNewContext(ts.transpileModule(code + `\nexports.applyViewChange = ${viewChangeEffect};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, sandbox)
  return { state, sandbox, callbacks: sandbox.exports, request() { const request = deferred(); queue.push(request); return request } }
}

let storage: Map<string, unknown>
beforeEach(() => {
  jest.clearAllMocks()
  storage = new Map([['access_token', 'tokenA'], ['user_id', 'A']])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
})

test('连续搜索只显示并缓存最新查询，慢旧响应不覆盖新结果', async () => {
  const h = harness(), requestA = h.request(), requestB = h.request()
  const a = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '苹果' })
  const b = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '牛肉' })
  requestB.resolve({ list: [{ id: 'B' }] }); await b
  requestA.resolve({ list: [{ id: 'A' }] }); await a
  expect(h.state.list).toEqual([{ id: 'B' }])
  expect(h.sandbox.saveToCache).toHaveBeenCalledTimes(1)
  expect(h.sandbox.saveToCache).toHaveBeenCalledWith([{ id: 'B' }], expect.objectContaining({ searchMerchant: '牛肉' }))
})

test.each(['success', 'error'])('旧查询%s和finally不能关闭新查询的等待状态', async (outcome) => {
  const h = harness(), requestA = h.request(), requestB = h.request()
  const a = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '苹果' })
  const b = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '牛肉' })
  if (outcome === 'success') requestA.resolve({ list: [{ id: 'A' }] })
  else requestA.reject(new Error('旧请求失败'))
  await a
  expect(h.state.loading).toBe(true)
  expect(h.state.error).toBe(false)
  expect(h.sandbox.showUnifiedApiError).not.toHaveBeenCalled()
  expect(h.sandbox.saveToCache).not.toHaveBeenCalled()
  requestB.resolve({ list: [{ id: 'B' }] }); await b
  expect(h.state.loading).toBe(false)
  expect(h.state.list).toEqual([{ id: 'B' }])
})

test('自动加载和主动搜索共用版本，旧自动加载不会覆盖新搜索', async () => {
  const h = harness(), requestA = h.request(), requestB = h.request()
  const a = h.callbacks.loadList(false, true)
  const b = h.callbacks.refreshList({ sortBy: 'hot', searchMerchant: '牛肉' })
  requestB.resolve({ list: [{ id: 'B' }] }); await b
  requestA.resolve({ list: [{ id: 'A' }] }); await a
  expect(h.state.list).toEqual([{ id: 'B' }])
  expect(h.sandbox.saveToCache).toHaveBeenCalledTimes(1)
})

test('缓存筛选恢复后同一次onShow的刷新使用恢复的词和排序', async () => {
  const h = harness(), request = h.request()
  storage.set('food_library_list_cache', JSON.stringify([{ id: 'cached' }]))
  storage.set('food_library_filters_cache', JSON.stringify({ sortBy: 'hot', searchMerchant: '牛肉', searchMode: 'keyword' }))
  expect(h.callbacks.loadFromCache()).toBe(true)
  const pending = h.callbacks.loadList(true, true)
  expect(h.sandbox.getPublicFoodLibraryList).toHaveBeenCalledWith({
    sort_by: 'hot', suitable_for_fat_loss: undefined, keyword: '牛肉', limit: 50,
  })
  request.resolve({ list: [{ id: 'B' }] }); await pending
  expect(h.sandbox.saveToCache).toHaveBeenLastCalledWith([{ id: 'B' }], {
    sortBy: 'hot', filterFatLoss: undefined, searchMerchant: '牛肉',
  })
})

test.each(['unmount', 'session', 'view'])('%s之后的旧响应不写列表或缓存', async (change) => {
  const h = harness(), request = h.request()
  const pending = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '苹果' })
  if (change === 'unmount') h.sandbox.pageMountedRef.current = false
  if (change === 'view') h.sandbox.listContextRef.current = false
  if (change === 'session') {
    storage.set('access_token', 'tokenB'); storage.set('user_id', 'B'); advanceAuthSession()
    storage.set('access_token', 'tokenA'); storage.set('user_id', 'A'); advanceAuthSession()
  }
  request.resolve({ list: [{ id: 'old' }] }); await pending
  expect(h.state.list).toEqual([])
  expect(h.sandbox.saveToCache).not.toHaveBeenCalled()
})

test('当前查询失败仍显示错误并结束等待', async () => {
  const h = harness(), request = h.request()
  const pending = h.callbacks.refreshList({ sortBy: 'latest' })
  request.reject(new Error('网络失败')); await pending
  expect(h.state.error).toBe(true)
  expect(h.state.loading).toBe(false)
  expect(h.sandbox.showUnifiedApiError).toHaveBeenCalledTimes(1)
})

test('地点正常分页保留已有菜品并追加新页', async () => {
  const h = harness(), request = h.request()
  const pending = h.callbacks.loadSpotDishes({ key: 'spot', title: '食堂', foodCount: 2 }, [{ id: 'first' }])
  request.resolve({ list: [{ id: 'second' }] }); await pending
  expect(h.state.spot.items).toEqual([{ id: 'first' }, { id: 'second' }])
  expect(h.state.spot.loading).toBe(false)
  expect(h.sandbox.getPublicFoodLibraryList).toHaveBeenCalledWith({ spot_key: 'spot', limit: 50, offset: 1 })
})

test('地图切换为地点列表的生命周期不丢弃刚发起的地点请求', async () => {
  const h = harness(), request = h.request()
  const pending = h.callbacks.loadSpotDishes({ key: 'spot', title: '食堂', foodCount: 1 }, [])
  h.callbacks.applyViewChange()
  request.resolve({ list: [{ id: 'first' }] }); await pending
  expect(h.state.spot.items).toEqual([{ id: 'first' }])
  expect(h.state.spot.loading).toBe(false)
})

test('新的静默加载接管旧请求后也能结束旧等待状态', async () => {
  const h = harness(), requestA = h.request(), requestB = h.request()
  const a = h.callbacks.loadList(false, true)
  const b = h.callbacks.loadList(true, true)
  requestB.resolve({ list: [{ id: 'B' }] }); await b
  expect(h.state.loading).toBe(false)
  requestA.resolve({ list: [{ id: 'A' }] }); await a
  expect(h.state.list).toEqual([{ id: 'B' }])
})

test('旧查询中的点赞失败，不回滚已显示的新搜索结果', async () => {
  const h = harness(), like = deferred(), request = h.request()
  h.sandbox.likePublicFoodLibraryItem.mockReturnValue(like.promise)
  const mutation = h.callbacks.handleLike(h.sandbox.list[0])
  const search = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '牛肉' })
  request.resolve({ list: [{ id: 'B' }] }); await search
  like.reject(new Error('旧点赞失败')); await mutation
  expect(h.state.list).toEqual([{ id: 'B' }])
  expect(h.sandbox.saveToCache).toHaveBeenLastCalledWith([{ id: 'B' }], expect.objectContaining({ searchMerchant: '牛肉' }))
  expect(h.sandbox.showUnifiedApiError).not.toHaveBeenCalled()
})

test('地点分页返回晚于新搜索时，不覆盖或关闭新搜索等待状态', async () => {
  const h = harness(), requestA = h.request(), requestB = h.request()
  const a = h.callbacks.loadSpotDishes({ key: 'spot', title: '食堂', foodCount: 2 }, [{ id: 'first' }])
  h.sandbox.spotDishRequestRef.current += 1
  const b = h.callbacks.refreshList({ sortBy: 'latest', searchMerchant: '牛肉' })
  requestA.resolve({ list: [{ id: 'old' }] }); await a
  expect(h.state.spot.items).toEqual([{ id: 'first' }])
  expect(h.state.loading).toBe(true)
  requestB.resolve({ list: [{ id: 'B' }] }); await b
  expect(h.state.list).toEqual([{ id: 'B' }])
})
