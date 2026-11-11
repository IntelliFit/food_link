import Taro from '@tarojs/taro'
import * as fs from 'fs'
import * as path from 'path'
import * as vm from 'vm'
import * as ts from 'typescript'
import { AUTH_SESSION_CHANGED_EVENT, advanceAuthSession, captureAuthSession, isAuthSessionCurrent } from '../../src/utils/auth-session'

// Execute the production callback itself; avoid mounting unrelated Canvas,
// payment and native subcomponents for a retained-tab lifecycle regression.
const source = fs.readFileSync(path.join(__dirname, '../../src/pages/index/index.tsx'), 'utf8')
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function productionCallback(name: string): string {
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      result = node.initializer.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!result) throw new Error(`missing production callback ${name}`)
  return result
}
const resetSource = productionCallback('resetHomeForSession')
function authEffect(): string {
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'React.useEffect'
      && node.arguments[0]?.getText(ast).includes('const onAuthChanged')) {
      result = node.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!result) throw new Error('missing auth lifecycle effect')
  return result
}
function compileCallback(code: string, context: any): (...args: any[]) => any {
  vm.createContext(context)
  vm.runInContext(ts.transpileModule(`globalThis.callback = ${code}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  return context.callback
}

describe('retained home tab clears state on auth changes', () => {
  const storage = new Map<string, unknown>()
  function login(id: string) {
    storage.set('user_id', id)
    storage.set('access_token', id ? `token-${id}` : '')
    advanceAuthSession()
  }
  beforeEach(() => {
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
    login('A')
  })

  function homeHarness(selectedDate = '2026-11-08') {
    const writes: Record<string, unknown> = {}
    const context: any = {
      captureAuthSession, isAuthSessionCurrent, Date, clearTimeout,
      DEFAULT_INTAKE: { current: 0 }, DEFAULT_EXPIRY_SUMMARY: {}, DEFAULT_SUPPLEMENT_SUMMARY: {},
      getStoredBodyMetrics: () => ({ userId: storage.get('user_id'), weightEntries: [] }),
      createTargetForm: (value: unknown) => value,
      createWeekHeatmapCells: () => [],
      readAnalyzeTaskReminderState: () => ({ userId: storage.get('user_id'), taskId: '' }),
      readHomeModuleLayout: () => ['new owner layout'],
      homeLayoutOwner: () => storage.get('user_id'),
      clearHomeAuxiliaryTimers: jest.fn(),
      formatDateKey: () => '2026-11-10',
      homeSessionRef: { current: captureAuthSession() },
      selectedDateRef: { current: selectedDate },
      homeLastLoadRef: { current: { date: selectedDate, ts: Date.now(), session: captureAuthSession() } },
      homeDataStaleRef: { current: false },
      homeGuideTimerRef: { current: null },
    }
    for (const name of resetSource.matchAll(/\b(\w+)\.current/g)) {
      if (!context[name[1]]) context[name[1]] = { current: 1 }
    }
    for (const name of resetSource.matchAll(/\b(set\w+)\(/g)) {
      context[name[1]] = jest.fn(value => { writes[name[1]] = value })
    }
    context.commitSelectedDate = jest.fn(date => { context.selectedDateRef.current = date })
    const reset = compileCallback(resetSource, context)
    return { context, writes, reset }
  }

  it.each(['B', ''])('clears historical A meals and body data on transition to %s before a cache hit', next => {
    const { context, writes, reset } = homeHarness()
    login(next)
    expect(reset()).toBe(true)
    expect(writes.setMeals).toEqual([])
    expect(writes.setBodyMetrics).toEqual({ userId: next, weightEntries: [] })
    expect(context.homeLastLoadRef.current).toBeNull()
    expect(context.loadDashboardPendingRef.current).toBeNull()
    expect(context.syncDashboardPendingRef.current).toBeNull()
    expect(context.homeDataStaleRef.current).toBe(true)
    expect(context.selectedDateRef.current).toBe('2026-11-10')
    expect(writes.setShowRecordEditModal).toBe(false)
    expect(writes.setShowRecordPosterModal).toBe(false)
    expect(writes.setMealActionRecord).toBeNull()
    expect(context.mealPosterShareForAppMessageRef.current).toBeNull()
  })

  it('invalidates the old requests even after switching A -> B -> A', () => {
    const { context, reset } = homeHarness('2026-11-10')
    const old = context.homeSessionRef.current
    login('B'); login('A')
    expect(isAuthSessionCurrent(old)).toBe(false)
    expect(reset()).toBe(true)
    expect(context.loadDashboardSeqRef.current).toBe(2)
    expect(context.bodyMetricsSeqRef.current).toBe(2)
    expect(context.petSummarySeqRef.current).toBe(2)
  })

  it('keeps valid same-session cache state untouched', () => {
    const { context, writes, reset } = homeHarness()
    expect(reset()).toBe(false)
    expect(context.homeLastLoadRef.current).not.toBeNull()
    expect(Object.keys(writes)).toHaveLength(0)
  })

  it('handles auth events while hidden and reloads only when visible', () => {
    const { context, writes, reset } = homeHarness()
    const listeners = new Map<string, () => void>()
    context.Taro = { eventCenter: {
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    } }
    context.AUTH_SESSION_CHANGED_EVENT = AUTH_SESSION_CHANGED_EVENT
    context.resetHomeForSession = reset
    context.homeVisibleRef = { current: false }
    context.loadDashboard = jest.fn()
    const cleanup = compileCallback(authEffect(), context)()
    login('')
    listeners.get(AUTH_SESSION_CHANGED_EVENT)!()
    expect(writes.setMeals).toEqual([])
    expect(context.loadDashboard).not.toHaveBeenCalled()
    context.homeVisibleRef.current = true
    login('B')
    listeners.get(AUTH_SESSION_CHANGED_EVENT)!()
    expect(context.loadDashboard).toHaveBeenCalledWith('2026-11-10', false, true)
    cleanup()
    expect(listeners.size).toBe(0)
  })

  it('drops an old dashboard response even before a missed auth event is handled', async () => {
    const { context, writes } = homeHarness()
    context.loadDashboardPendingRef.current = null
    context.getAccessToken = () => storage.get('access_token')
    let resolve!: (value: unknown) => void
    context.getHomeDashboard = () => new Promise(yes => { resolve = yes })
    context.saveHomeDashboardSnapshot = jest.fn()
    const load = compileCallback(productionCallback('loadDashboard'), context)
    const pending = load('2026-11-08')
    login('B')
    resolve({ intakeData: { current: 1234 }, meals: [{ name: 'A private meal' }] })
    await pending
    expect(writes.setMeals).toBeUndefined()
    expect(context.saveHomeDashboardSnapshot).not.toHaveBeenCalled()
  })

  it('does not persist A body data when React applies the state updater after login B', async () => {
    const { context } = homeHarness()
    context.getAccessToken = () => storage.get('access_token')
    context.getBodyMetricsSummary = async () => ({ weight_entries: [{ value: 70 }] })
    context.saveBodyMetrics = jest.fn()
    context.applyCloudBodyMetrics = jest.fn()
    let updater!: (previous: any) => any
    context.setBodyMetrics = (update: any) => { updater = update }
    await compileCallback(productionCallback('refreshBodyMetrics'), context)()
    login('B')
    const bMetrics = { userId: 'B', weightEntries: [] }
    expect(updater(bMetrics)).toBe(bMetrics)
    expect(context.applyCloudBodyMetrics).not.toHaveBeenCalled()
    expect(context.saveBodyMetrics).not.toHaveBeenCalled()
  })
})
