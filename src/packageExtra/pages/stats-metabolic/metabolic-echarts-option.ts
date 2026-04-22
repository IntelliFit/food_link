/**
 * 当日代谢曲线：Apache ECharts 5 配置（https://echarts.apache.org）
 * 与旧版手写 Canvas 使用相同的采样步长与坐标语义（x：0–1440 分钟，y：kcal/分）
 */
import type { EChartsCoreOption } from 'echarts/core'

/** 与 `MetabolicSimResult` 字段一致，独立声明以避免与主模块循环依赖 */
export interface MetabolicSimSeriesInput {
  absorbPerMin: Float64Array
  outPerMin: Float64Array
  refOutPerMin: Float64Array
}

const MINUTES_PER_DAY = 1440

function sampleSeries(arr: Float64Array, step: number): number[] {
  const out: number[] = []
  for (let i = 0; i < arr.length; i += step) out.push(arr[i])
  const lastIdx = arr.length - 1
  if (out.length === 0) return [arr[lastIdx] ?? 0]
  if (lastIdx % step !== 0 && out[out.length - 1] !== arr[lastIdx]) {
    out.push(arr[lastIdx])
  }
  return out
}

function pad2(n: number): string {
  return `${Math.floor(n)}`.padStart(2, '0')
}

/** 分钟数 → 当日时钟文案（用于轴标签 / tooltip） */
function formatMinuteOfDay(m: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(m)))
  const h = Math.floor(clamped / 60)
  const mi = clamped % 60
  return `${h}:${pad2(mi)}`
}

export function buildMetabolicFluxChartOption(
  sim: MetabolicSimSeriesInput,
  nowMinute: number,
  mealMinutesOfDay: number[],
  sampleStepMin: number,
): EChartsCoreOption {
  const absorbS = sampleSeries(sim.absorbPerMin, sampleStepMin)
  const outS = sampleSeries(sim.outPerMin, sampleStepMin)
  const refS = sampleSeries(sim.refOutPerMin, sampleStepMin)
  const n = absorbS.length

  let yMax = 0.0001
  for (let i = 0; i < n; i++) {
    yMax = Math.max(yMax, absorbS[i], outS[i], refS[i])
  }
  yMax *= 1.12
  yMax = Math.max(yMax, 0.35)

  const toPoints = (values: number[]): [number, number][] => {
    const pts: [number, number][] = []
    for (let i = 0; i < values.length; i++) {
      const minute = Math.min(MINUTES_PER_DAY - 1, i * sampleStepMin)
      pts.push([minute, values[i]])
    }
    return pts
  }

  const absorbPts = toPoints(absorbS)
  const outPts = toPoints(outS)
  const refPts = toPoints(refS)

  const clampedNow = Math.max(0, Math.min(MINUTES_PER_DAY - 1, nowMinute))

  const mealMarkData = mealMinutesOfDay.map((m) => ({
    xAxis: Math.max(0, Math.min(MINUTES_PER_DAY - 1, m)),
    lineStyle: {
      color: 'rgba(240, 152, 92, 0.95)',
      width: 1.5,
      type: 'dashed' as const,
    },
  }))

  return {
    backgroundColor: '#f8fafc',
    animation: false,
    grid: {
      left: 46,
      right: 14,
      top: 20,
      bottom: 26,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'line', lineStyle: { color: '#94a3b8', width: 1 } },
      formatter: (params: unknown): string => {
        const arr = params as { axisValue: number; marker: string; seriesName: string; data: [number, number] }[]
        if (!arr?.length) return ''
        const minute = arr[0].data[0]
        const head = `${formatMinuteOfDay(minute)}`
        const lines = arr.map((p) => `${p.marker}${p.seriesName}: ${Math.round(p.data[1] * 1000) / 1000} kcal/分`)
        return [head, ...lines].join('\n')
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: MINUTES_PER_DAY - 1,
      splitNumber: 6,
      axisLine: { lineStyle: { color: 'rgba(15, 23, 42, 0.12)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: string | number): string => formatMinuteOfDay(Number(v)),
      },
      splitLine: { lineStyle: { color: 'rgba(15, 23, 42, 0.06)' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: yMax,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: string | number): string => `${Number(v).toFixed(2)}`,
      },
      splitLine: { lineStyle: { color: 'rgba(15, 23, 42, 0.06)' } },
    },
    series: [
      {
        name: '参考消耗',
        type: 'line',
        smooth: 0.35,
        symbol: 'none',
        lineStyle: {
          color: 'rgba(100, 116, 139, 0.75)',
          width: 1.25,
          type: 'dashed',
        },
        data: refPts,
        z: 1,
      },
      {
        name: '吸收',
        type: 'line',
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: 'rgb(92, 184, 150)', width: 2 },
        areaStyle: { color: 'rgba(92, 184, 150, 0.24)' },
        data: absorbPts,
        z: 2,
      },
      {
        name: '实际消耗',
        type: 'line',
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: 'rgb(92, 158, 212)', width: 2 },
        areaStyle: { color: 'rgba(92, 158, 212, 0.2)' },
        data: outPts,
        z: 3,
        markLine: {
          symbol: 'none',
          animation: false,
          data: [
            {
              xAxis: clampedNow,
              lineStyle: { color: 'rgba(92, 184, 150, 0.45)', width: 1.25, type: 'solid' },
            },
            ...mealMarkData,
          ],
        },
      },
    ],
  }
}
