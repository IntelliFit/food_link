export type HealthMetricKind = 'weight' | 'water' | 'exercise'

export interface HealthMetricsData {
  date: string
  weight?: { value: number; date: string } | null
  waterMl: number
  waterGoalMl: number
  exerciseKcal: number
  busy?: boolean
  guest?: boolean
}

const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

export function getHealthMetricReadings(data: HealthMetricsData) {
  const hidden = Boolean(data.busy || data.guest)
  const hasWeight = Boolean(data.weight && Number.isFinite(data.weight.value) && data.weight.value > 0)
  const water = nonnegative(data.waterMl)
  const goal = nonnegative(data.waterGoalMl)
  const waterPercent = !hidden && goal > 0 ? water / goal * 100 : null
  return {
    waterPercent,
    waterVisualProgress: waterPercent === null ? 0 : Math.min(1, waterPercent / 100),
    metrics: [
      {
        kind: 'weight' as const, title: '体重', unit: 'kg', icon: 'icon-weight-scale',
        value: hidden || !hasWeight ? '--' : data.weight!.value.toFixed(1),
        hint: hidden ? '' : hasWeight ? data.weight!.date === data.date ? '当天记录' : `最近 ${data.weight!.date.slice(5)}` : '尚未记录',
        detail: data.guest ? '登录后记录' : '',
      },
      {
        kind: 'water' as const, title: '喝水', unit: 'ml', icon: 'icon-drink',
        value: hidden ? '--' : String(Math.round(water)),
        hint: hidden ? '' : goal > 0 ? `目标 ${Math.round(goal)} ml` : '今日饮水',
        detail: data.guest ? '登录后记录' : waterPercent === null ? '' : `已达 ${Math.round(waterPercent)}%`,
      },
      {
        kind: 'exercise' as const, title: '运动', unit: 'kcal', icon: 'icon-dumbbell',
        value: hidden ? '--' : String(Math.round(nonnegative(data.exerciseKcal))),
        hint: hidden ? '' : '当日消耗', detail: data.guest ? '登录后记录' : '',
      },
    ],
  }
}

function point(radius: number, angle: number) {
  const radians = angle * Math.PI / 180
  return `${(260 + radius * Math.cos(radians)).toFixed(2)} ${(260 + radius * Math.sin(radians)).toFixed(2)}`
}

function sector(start: number) {
  return `M260 260L${point(250, start)}A250 250 0 0 1 ${point(250, start + 114)}Z`
}

/** Equal category sectors, not proportions of incompatible kg/ml/kcal values. */
export function buildHealthWheelSvg(progress: number, dark = false, wellness = false): string {
  const colors = dark ? ['#243b32', '#243b49', '#45372d'] : wellness ? ['#e5eddd', '#e2edf1', '#f5e6d0'] : ['#e6f3e9', '#e5f2fa', '#fff0df']
  const surface = dark ? '#1f2724' : wellness ? '#fffbf3' : '#ffffff'
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  const arc = p > 0 ? `<path d="M${point(239, 273)}A239 239 0 0 1 ${point(239, 273 + 114 * p)}" fill="none" stroke="${dark ? '#85c8ed' : '#529dcd'}" stroke-width="7" stroke-linecap="round"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="520" viewBox="0 0 520 520"><path d="${sector(153)}" fill="${colors[0]}"/><path d="${sector(273)}" fill="${colors[1]}"/><path d="${sector(33)}" fill="${colors[2]}"/>${arc}<circle cx="260" cy="260" r="66" fill="${surface}"/></svg>`
}

/** Geometry SVG contains ASCII only; no browser-only btoa dependency. */
export function healthWheelSvgSource(svg: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let encoded = ''
  for (let index = 0; index < svg.length; index += 3) {
    const a = svg.charCodeAt(index), b = svg.charCodeAt(index + 1), c = svg.charCodeAt(index + 2)
    const bits = (a << 16) | ((b || 0) << 8) | (c || 0)
    encoded += alphabet[(bits >>> 18) & 63] + alphabet[(bits >>> 12) & 63]
      + (Number.isNaN(b) ? '=' : alphabet[(bits >>> 6) & 63]) + (Number.isNaN(c) ? '=' : alphabet[bits & 63])
  }
  return `data:image/svg+xml;base64,${encoded}`
}
