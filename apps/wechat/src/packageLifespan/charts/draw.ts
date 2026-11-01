// Canvas 2D drawing for the predictor screens (no chart library, to keep the subpackage small).
import type { Curves, Person } from '../engine/engine'
import { atAge, axisEndAge, type Branch, type ParallelLives } from '../model/predictor'

export type Ctx = CanvasRenderingContext2D

export interface Palette {
  a: string
  b: string
  c: string
  ink: string
  muted: string
  line: string
  surface: string
}

export const LIGHT_PALETTE: Palette = { a: '#5f8193', b: '#00a56e', c: '#e2683f', ink: '#123d30', muted: '#8a9e95', line: 'rgba(18,61,48,0.11)', surface: '#ffffff' }
export const DARK_PALETTE: Palette = { a: '#8fb3c4', b: '#1fd494', c: '#ff8b63', ink: '#e2eee8', muted: '#6f8a7f', line: 'rgba(255,255,255,0.10)', surface: '#16231e' }

/** Colours on the deep-green hero band, the same in both themes. */
export const HERO = { ink: '#f1faf5', dim: 'rgba(241,250,245,0.62)', line: 'rgba(241,250,245,0.14)', a: '#a9c8d6', b: '#45eaa9', c: '#ff9b74' }
const HERO_COLORS = [HERO.a, HERO.b, HERO.c]

export function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha.toFixed(3)})`
}

function polyline(ctx: Ctx, points: Array<[number, number]>): void {
  ctx.beginPath()
  points.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
}

function dot(ctx: Ctx, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, dash: number[] = []): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

function text(ctx: Ctx, value: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', size = 10): void {
  ctx.fillStyle = color
  ctx.font = `${size}px sans-serif`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, x, y)
}

function ageTicks(from: number, to: number): number[] {
  const step = to - from > 50 ? 15 : 10
  const ticks: number[] = []
  for (let age = Math.ceil(from / step) * step; age <= to; age += step) ticks.push(age)
  return ticks
}

/** Illustrative person whose body width follows BMI; drawn in a 64 x 86 box. */
export function drawFigure(ctx: Ctx, cx: number, top: number, scale: number, bmi: number, color: string, alpha: number): void {
  const t = Math.max(-2, Math.min(12, bmi - 20))
  const shoulder = (11 + t * 0.25) * scale
  const waist = (7.5 + t * 0.9) * scale
  const hip = (8.5 + t * 0.55) * scale
  const leg = (4.5 + t * 0.25) * scale
  const y = (value: number) => top + value * scale
  ctx.save()
  ctx.globalAlpha = 0.25 + 0.75 * alpha
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(cx, y(11), 8.5 * scale, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - shoulder, y(24))
  ctx.quadraticCurveTo(cx - shoulder - scale, y(22), cx - shoulder + 5 * scale, y(22))
  ctx.lineTo(cx + shoulder - 5 * scale, y(22))
  ctx.quadraticCurveTo(cx + shoulder + scale, y(22), cx + shoulder, y(24))
  ctx.quadraticCurveTo(cx + waist + 3 * scale, y(36), cx + waist, y(46))
  ctx.lineTo(cx + hip, y(56))
  ctx.lineTo(cx - hip, y(56))
  ctx.lineTo(cx - waist, y(46))
  ctx.quadraticCurveTo(cx - waist - 3 * scale, y(36), cx - shoulder, y(24))
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(cx - hip + 0.5 * scale, y(54), leg + 1.5 * scale, 29 * scale)
  ctx.fillRect(cx + hip - leg - 2 * scale, y(54), leg + 1.5 * scale, 29 * scale)
  ctx.lineWidth = 4.5 * scale
  ctx.lineCap = 'round'
  ;[-1, 1].forEach((side) => {
    ctx.beginPath()
    ctx.moveTo(cx + side * shoulder, y(25))
    ctx.quadraticCurveTo(cx + side * (shoulder + 5 * scale), y(38), cx + side * (shoulder + 3 * scale), y(50))
    ctx.stroke()
  })
  ctx.restore()
}

export function drawTrioFigures(ctx: Ctx, width: number, height: number, person: Person, branches: Branch[], age: number): void {
  const scale = height / 86
  branches.forEach((branch, index) => {
    const at = atAge(person, branch, age)
    drawFigure(ctx, width * (2 * index + 1) / 6, 0, scale, at.bmi, HERO_COLORS[index], at.alive)
  })
}

/** Three weight paths leaving one point; line opacity is the chance of reaching that age. */
export function drawFork(ctx: Ctx, width: number, height: number, person: Person, branches: Branch[], cursorAge: number | null): void {
  const left = 6
  const right = 66
  const top = 10
  const bottom = 22
  const end = axisEndAge(person)
  const x = (age: number) => left + (age - person.age) / (end - person.age) * (width - left - right)
  const weights = branches.flatMap(branch => branch.W.slice(0, end - person.age + 1))
  const low = Math.min(...weights) - 3
  const high = Math.max(...weights) + 3
  const y = (weight: number) => top + (1 - (weight - low) / (high - low)) * (height - top - bottom)

  ageTicks(person.age, end).forEach((age) => {
    line(ctx, x(age), top, x(age), height - bottom, HERO.line)
    // A tick at the very start of the axis would be cut off if it were centred.
    text(ctx, `${age} 岁`, x(age), height - 6, HERO.dim, x(age) < 20 ? 'left' : 'center')
  })
  branches.forEach((branch, index) => {
    const color = HERO_COLORS[index]
    const gradient = ctx.createLinearGradient(x(person.age), 0, x(end), 0)
    for (let age = person.age; age <= end; age += 4) {
      gradient.addColorStop((age - person.age) / (end - person.age), withAlpha(color, 0.08 + 0.92 * atAge(person, branch, age).alive))
    }
    const points: Array<[number, number]> = []
    for (let age = person.age; age <= end; age += 1) points.push([x(age), y(atAge(person, branch, age).weight)])
    ctx.strokeStyle = gradient
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    polyline(ctx, points)
    ctx.stroke()
    const mean = Math.min(end, Math.round(branch.le.mean))
    dot(ctx, x(mean), y(atAge(person, branch, mean).weight), 3.4, color)
  })
  const labels = branches
    .map((branch, index) => ({ branch, color: HERO_COLORS[index], at: y(atAge(person, branch, end).weight) + 4 }))
    .sort((p, q) => p.at - q.at)
  labels.reduce((previous, label) => {
    const at = Math.max(label.at, previous + 13)
    text(ctx, `${label.branch.short} ${label.branch.le.mean.toFixed(1)}`, x(end) + 6, at, label.color, 'left', 11)
    return at
  }, -Infinity)
  dot(ctx, x(person.age), y(person.weight_kg), 4.4, HERO.ink)
  if (cursorAge !== null) line(ctx, x(cursorAge), top, x(cursorAge), height - bottom, HERO.dim, [3, 3])
}

interface ChartFrame {
  x: (age: number) => number
  y: (value: number) => number
  bottom: number
  top: number
}

function chartFrame(ctx: Ctx, width: number, height: number, person: Person, maxValue: number, palette: Palette): ChartFrame {
  const left = 34
  const right = 8
  const top = 8
  const bottomPad = 22
  const end = Math.min(110, axisEndAge(person) + 6)
  const x = (age: number) => left + (age - person.age) / (end - person.age) * (width - left - right)
  const y = (value: number) => top + (1 - value / maxValue) * (height - top - bottomPad)
  ;[0, 0.25, 0.5, 0.75, 1].forEach((fraction) => {
    const value = fraction * maxValue
    line(ctx, left, y(value), width - right, y(value), palette.line)
    text(ctx, `${Math.round(value * 100)}%`, left - 5, y(value) + 3, palette.muted, 'right')
  })
  ageTicks(person.age, end).forEach(age => text(ctx, String(age), x(age), height - 7, palette.muted, 'center'))
  return { x, y, bottom: height - bottomPad, top }
}

/** One line per future from a per-year series: all-cause survival or survival without major disease. */
export function drawSurvival(ctx: Ctx, width: number, height: number, person: Person, series: number[][], age: number, palette: Palette): void {
  const frame = chartFrame(ctx, width, height, person, 1, palette)
  const colors = [palette.a, palette.b, palette.c]
  const end = Math.min(110, axisEndAge(person) + 6)
  const at = Math.max(0, Math.min(Math.round(age - person.age), series[0].length - 1))
  series.forEach((values, index) => {
    const points = values.map((value, i): [number, number] => [frame.x(person.age + i), frame.y(value)]).slice(0, end - person.age + 1)
    ctx.strokeStyle = colors[index]
    ctx.lineWidth = 2.2
    polyline(ctx, points)
    ctx.stroke()
  })
  line(ctx, frame.x(age), frame.top, frame.x(age), frame.bottom, palette.ink, [3, 3])
  series.forEach((values, index) => dot(ctx, frame.x(age), frame.y(values[at]), 3.5, colors[index]))
}

export function drawDistribution(ctx: Ctx, width: number, height: number, person: Person, branches: Branch[], palette: Palette): void {
  const bins = branches.map((branch) => {
    const out: Array<[number, number]> = []
    for (let i = 0; i + 2 < branch.S.length; i += 2) out.push([person.age + i + 1, branch.S[i] - branch.S[i + 2]])
    return out
  })
  const peak = Math.max(...bins.flat().map(point => point[1]))
  const frame = chartFrame(ctx, width, height, person, Math.max(0.02, Math.ceil(peak * 50) / 50), palette)
  const colors = [palette.a, palette.b, palette.c]
  const end = Math.min(110, axisEndAge(person) + 6)
  branches.forEach((branch, index) => {
    const points = bins[index].filter(point => point[0] <= end).map(([age, value]): [number, number] => [frame.x(age), frame.y(value)])
    if (!points.length) return
    ctx.fillStyle = withAlpha(colors[index], 0.12)
    polyline(ctx, [[frame.x(person.age), frame.y(0)], ...points, [points[points.length - 1][0], frame.y(0)]])
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = colors[index]
    ctx.lineWidth = 2.2
    polyline(ctx, points)
    ctx.stroke()
    line(ctx, frame.x(branch.le.mean), frame.y(0), frame.x(branch.le.mean), frame.top + 6, colors[index], [2, 3])
  })
}

/** Survival today (dashed) against the tuned plan (solid), the gap filled. */
export function drawPlayCurve(ctx: Ctx, width: number, height: number, person: Person, today: Curves, tuned: Curves, gained: boolean): void {
  const left = 30
  const right = 10
  const top = 8
  const bottom = 20
  const end = axisEndAge(person)
  const color = gained ? HERO.b : HERO.c
  const x = (age: number) => left + (age - person.age) / (end - person.age) * (width - left - right)
  const y = (value: number) => top + (1 - value) * (height - top - bottom)
  const path = (curves: Curves): Array<[number, number]> => curves.S
    .slice(0, end - person.age + 1)
    .map((value, index) => [x(person.age + index), y(value)])
  ;[0, 0.5, 1].forEach((value) => {
    line(ctx, left, y(value), width - right, y(value), HERO.line)
    text(ctx, `${value * 100}%`, left - 4, y(value) + 3, HERO.dim, 'right')
  })
  ageTicks(person.age, end).forEach(age => text(ctx, `${age} 岁`, x(age), height - 5, HERO.dim, 'center'))
  const pathToday = path(today)
  const pathTuned = path(tuned)
  ctx.fillStyle = withAlpha(color, 0.18)
  polyline(ctx, [...pathTuned, ...pathToday.slice().reverse()])
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.strokeStyle = HERO.a
  ctx.lineWidth = 2
  ctx.setLineDash([4, 3])
  polyline(ctx, pathToday)
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  polyline(ctx, pathTuned)
  ctx.stroke()
  text(ctx, '虚线：照现在', width - right, top + 10, HERO.a, 'right')
  text(ctx, '实线：调完以后', width - right, top + 23, color, 'right')
}

/** Dot histogram: 100 random lives above the axis today, below it with the tuned plan. */
export function drawParallelLives(ctx: Ctx, width: number, height: number, person: Person, lives: ParallelLives, gained: boolean, palette: Palette): void {
  const left = 14
  const right = 10
  const middle = height / 2
  const end = 110
  const x = (age: number) => left + (age - person.age) / (end - person.age) * (width - left - right)
  const tunedColor = gained ? palette.b : palette.c
  const gap = Math.min(5.4, (middle - 16) / Math.max(1, lives.tallest))
  const center = (bin: number) => x(person.age + bin * lives.binYears + lives.binYears / 2)
  line(ctx, left, middle, width - right, middle, palette.line)
  lives.today.forEach((count, bin) => {
    for (let i = 0; i < count; i += 1) dot(ctx, center(bin), middle - 10 - i * gap, 2.4, palette.a)
  })
  lives.tuned.forEach((count, bin) => {
    for (let i = 0; i < count; i += 1) dot(ctx, center(bin), middle + 10 + i * gap, 2.4, tunedColor)
  })
  ageTicks(person.age, end).forEach(age => text(ctx, String(age), x(age), middle + 3.5, palette.muted, 'center'))
  if (person.age < 85) line(ctx, x(85), 4, x(85), height - 4, palette.ink, [2, 3])
  text(ctx, '照现在', left, 12, palette.a, 'left', 11)
  text(ctx, '调完以后', left, height - 4, tunedColor, 'left', 11)
}
