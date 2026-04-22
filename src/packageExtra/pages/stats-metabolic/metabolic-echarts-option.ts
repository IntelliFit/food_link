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
  /** 每分钟示意脂肪增量（g），用于累计曲线（急性缓冲池满后的 P-ratio 模型） */
  fatDeltaGramsPerMin: Float64Array
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

  const cumFatByMinute = new Float64Array(MINUTES_PER_DAY)
  let fatRun = 0
  for (let t = 0; t < MINUTES_PER_DAY; t++) {
    fatRun += sim.fatDeltaGramsPerMin[t] ?? 0
    cumFatByMinute[t] = fatRun
  }
  const fatCumPts: [number, number][] = absorbPts.map(([min]) => {
    const m = Math.min(MINUTES_PER_DAY - 1, Math.round(min))
    return [min, Math.round(cumFatByMinute[m] * 1000) / 1000]
  })
  let fatYMax = 0.0001
  for (let i = 0; i < fatCumPts.length; i++) {
    fatYMax = Math.max(fatYMax, fatCumPts[i][1])
  }
  fatYMax *= 1.18
  fatYMax = Math.max(fatYMax, 0.02)

  const clampedNow = Math.max(0, Math.min(MINUTES_PER_DAY - 1, nowMinute))

  /** 与首页主色同系，饱和度适中便于读图 */
  const C_ABS_LINE = '#5cb896'
  const C_ABS_FILL = 'rgba(92, 184, 150, 0.22)'
  const C_OUT_LINE = '#5c9ed4'
  const C_OUT_FILL = 'rgba(92, 158, 212, 0.2)'
  const C_REF_LINE = 'rgba(100, 116, 139, 0.62)'
  const C_FAT_LINE = '#e57373'
  const C_FAT_FILL = 'rgba(229, 115, 115, 0.2)'
  const C_NOW_LINE = 'rgba(92, 184, 150, 0.55)'
  const C_FAT_AXIS = '#c45c5c'

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
      axisPointer: { type: 'line', lineStyle: { color: '#94a3b8', width: 1 } },
      formatter: (params: unknown): string => {
        const arr = params as { axisValue: number; marker: string; seriesName: string; data: [number, number] }[]
        if (!arr?.length) return ''
        const minute = arr[0].data[0]
        const head = `${formatMinuteOfDay(minute)}`
        const lines = arr.map((p) => {
          const v = Math.round(p.data[1] * 1000) / 1000
          if (p.seriesName === '累计脂肪淤积') {
            return `${p.marker}${p.seriesName}: ${v} g（示意累计）`
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
      axisLine: { lineStyle: { color: 'rgba(15, 23, 42, 0.12)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: string | number): string => formatMinuteOfDay(Number(v)),
      },
      splitLine: { lineStyle: { color: 'rgba(15, 23, 42, 0.06)' } },
    },
    yAxis: [
      {
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
          formatter: (v: string | number): string => `${Number(v).toFixed(2)}`,
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
        name: '累计脂肪淤积',
        type: 'line',
        yAxisIndex: 1,
        smooth: 0.35,
        symbol: 'none',
        lineStyle: { color: C_FAT_LINE, width: 2 },
        areaStyle: { color: C_FAT_FILL },
        data: fatCumPts,
        z: 4,
      },
    ],
  }
}
