/**
 * 当日代谢曲线：Apache ECharts 5 配置（https://echarts.apache.org）
 * 与旧版手写 Canvas 使用相同的采样步长与坐标语义（x：0–1440 分钟；左轴 kcal/分，右轴 %）
 */
import type { EChartsCoreOption } from 'echarts/core'

/** 与 `MetabolicSimResult` 字段一致，独立声明以避免与主模块循环依赖 */
export interface MetabolicSimSeriesInput {
  absorbPerMin: Float64Array
  outPerMin: Float64Array
  refOutPerMin: Float64Array
  /** 每分钟转向脂肪堆积的能量，相对“当天吸收峰值”的百分比（%） */
  fatStoragePctOfPeakAbsorbPerMin: Float64Array
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
  sampleStepMin: number,
  isDark = false,
): EChartsCoreOption {
  const absorbS = sampleSeries(sim.absorbPerMin, sampleStepMin)
  const outS = sampleSeries(sim.outPerMin, sampleStepMin)
  const refS = sampleSeries(sim.refOutPerMin, sampleStepMin)

  let yMax = 0.0001
  for (let i = 0; i < absorbS.length; i++) {
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

  const fatPctPts: [number, number][] = absorbPts.map(([min]) => {
    const m = Math.min(MINUTES_PER_DAY - 1, Math.round(min))
    return [min, Math.round((sim.fatStoragePctOfPeakAbsorbPerMin[m] ?? 0) * 100) / 100]
  })
  let fatYMax = 0.0001
  for (let i = 0; i < fatPctPts.length; i++) {
    fatYMax = Math.max(fatYMax, fatPctPts[i][1])
  }
  fatYMax *= 1.18
  fatYMax = Math.max(fatYMax, 5)

  const clampedNow = Math.max(0, Math.min(MINUTES_PER_DAY - 1, nowMinute))

  /** 与首页主色同系，饱和度适中便于读图；深色下提高亮度与对比度 */
  const C_ABS_LINE = isDark ? '#7dd3b0' : '#5cb896'
  const C_ABS_FILL = isDark ? 'rgba(125, 211, 176, 0.18)' : 'rgba(92, 184, 150, 0.22)'
  const C_OUT_LINE = isDark ? '#7eb8e8' : '#5c9ed4'
  const C_OUT_FILL = isDark ? 'rgba(126, 184, 232, 0.16)' : 'rgba(92, 158, 212, 0.2)'
  const C_REF_LINE = isDark ? 'rgba(156, 163, 175, 0.55)' : 'rgba(100, 116, 139, 0.62)'
  const C_FAT_LINE = isDark ? '#f87171' : '#e57373'
  const C_FAT_FILL = isDark ? 'rgba(248, 113, 113, 0.18)' : 'rgba(229, 115, 115, 0.2)'
  const C_NOW_LINE = isDark ? 'rgba(125, 211, 176, 0.45)' : 'rgba(92, 184, 150, 0.55)'
  const C_FAT_AXIS = isDark ? '#f87171' : '#c45c5c'

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: {
      left: 36,
      right: 34,
      top: 18,
      bottom: 24,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: isDark ? 'rgba(20, 24, 23, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderColor: isDark ? 'rgba(92, 184, 150, 0.25)' : 'rgba(148, 163, 184, 0.25)',
      textStyle: { color: isDark ? '#e8ece9' : '#1f2937', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: isDark ? 'rgba(255,255,255,0.2)' : '#94a3b8', width: 1 } },
      formatter: (params: unknown): string => {
        const arr = params as { axisValue: number; marker: string; seriesName: string; data: [number, number] }[]
        if (!arr?.length) return ''
        const minute = arr[0].data[0]
        const head = `${formatMinuteOfDay(minute)}`
        const lines = arr.map((p) => {
          const v = Math.round(p.data[1] * 1000) / 1000
          if (p.seriesName === '转脂占峰值吸收') {
            return `${p.marker}${p.seriesName}: ${v}%`
          }
          return `${p.marker}${p.seriesName}: ${v} kcal/分`
        })
        return [head, ...lines].join('\n')
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: MINUTES_PER_DAY - 1,
      splitNumber: 6,
      axisLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.12)' } },
      axisTick: { show: false },
      axisLabel: {
        color: isDark ? '#9ca3af' : '#64748b',
        fontSize: 10,
        formatter: (v: string | number): string => formatMinuteOfDay(Number(v)),
      },
      splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15, 23, 42, 0.06)' } },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: yMax,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: isDark ? '#9ca3af' : '#64748b',
          fontSize: 10,
          formatter: (v: string | number): string => `${Number(v).toFixed(2)}`,
        },
        splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15, 23, 42, 0.06)' } },
      },
      {
        type: 'value',
        min: 0,
        max: fatYMax,
        position: 'right',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: C_FAT_AXIS,
          fontSize: 10,
          formatter: (v: string | number): string => `${Number(v).toFixed(0)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '参考消耗',
        type: 'line',
        yAxisIndex: 0,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: {
          color: C_REF_LINE,
          width: 1.25,
          type: 'dashed',
        },
        data: refPts,
        z: 1,
      },
      {
        name: '吸收',
        type: 'line',
        yAxisIndex: 0,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: C_ABS_LINE, width: 2 },
        areaStyle: { color: C_ABS_FILL },
        data: absorbPts,
        z: 2,
      },
      {
        name: '实际消耗',
        type: 'line',
        yAxisIndex: 0,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: C_OUT_LINE, width: 2 },
        areaStyle: { color: C_OUT_FILL },
        data: outPts,
        z: 3,
        markLine: {
          symbol: 'none',
          animation: false,
          data: [
            {
              xAxis: clampedNow,
              lineStyle: { color: C_NOW_LINE, width: 1.25, type: 'solid' },
            },
          ],
        },
      },
      {
        name: '转脂占峰值吸收',
        type: 'line',
        yAxisIndex: 1,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: C_FAT_LINE, width: 2 },
        areaStyle: { color: C_FAT_FILL },
        data: fatPctPts,
        z: 4,
      },
    ],
  }
}
