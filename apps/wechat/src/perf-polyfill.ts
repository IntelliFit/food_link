/**
 * 微信小程序真机部分基础库未挂载 global.performance，
 * 首页动画 hooks 使用 performance.now() 会抛 ReferenceError。
 */
const globalRef = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : {})

if (typeof (globalRef as { performance?: Performance }).performance === 'undefined') {
  ;(globalRef as { performance: { now: () => number } }).performance = {
    now: () => Date.now(),
  }
}
