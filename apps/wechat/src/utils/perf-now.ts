/**
 * 与 requestAnimationFrame 时间轴兼容；无 performance 时回退 Date.now()
 */
export function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}
