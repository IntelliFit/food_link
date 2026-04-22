/**
 * 当日代谢：分钟级模拟算法 + Apache ECharts 5 曲线（独立模块；视觉对齐首页浅色卡片）
 * 图表库：https://echarts.apache.org
 */
import { View, Text, Canvas } from '@tarojs/components'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import Taro from '@tarojs/taro'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts } from 'echarts/core'
import { buildMetabolicFluxChartOption } from './metabolic-echarts-option'
import { patchWxCanvasNodeForEcharts } from './metabolic-echarts-wx-polyfill'
import { installWxZrenderTextMeasure } from './metabolic-echarts-wx-zrender-platform'
import { Backdrop, Popup } from '@taroify/core'
import '@taroify/core/backdrop/style'
import '@taroify/core/popup/style'
import {
  getExerciseDailyCalories,
  getFoodRecordList,
  getUserProfile,
  type FoodRecord,
  type UserInfo,
} from '../../../utils/api'
import {
  isMetabolicProfileComplete,
  loadLocalMetabolicProfile,
  mergeUserWithLocalProfile,
  MetabolicProfileSheet,
} from './metabolic-profile-sheet'
import './metabolic-dynamics-report.scss'

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])
installWxZrenderTextMeasure()

const MINUTES_PER_DAY = 1440
const SAMPLE_STEP_MIN = 6

/**
 * 急性缓冲池（示意，非生理糖原全量）。
 * 若使用 900→1600 kcal 全身糖原模型：单餐分钟级盈余会先长期填池，脂肪淤积需「池满后仍每分钟有盈余」才出现，
 * 在只吃一餐、全天 TDEE 仍高时几乎恒为 0。缩小池容量后，餐后吸收峰更易体现「相对当时消耗」的示意淤积。
 */
const ACUTE_BUFFER_MAX_KCAL = 200
const ACUTE_BUFFER_START_KCAL = 55
const CANVAS_HEIGHT_RPX = 360

/** 与统计页卡片左右边距（32rpx）+ 图形容器边距（24rpx）对齐，得到可靠像素宽，避免 2D Canvas 查询宽高为 0 */
function computeMetabolicCanvasPx(): { w: number; h: number } {
  try {
    const win = Taro.getSystemInfoSync().windowWidth || 375
    const horizontalInsetRpx = (32 + 24) * 2
    const w = Math.max(200, Math.floor(win - (horizontalInsetRpx * win) / 750))
    const h = Math.max(160, Math.floor((CANVAS_HEIGHT_RPX * win) / 750))
    return { w, h }
  } catch {
    return { w: 300, h: 200 }
  }
}

/** 餐次事件（分钟级模拟输入） */
interface MealEvent {
  tMin: number
  kcal: number
  carbs: number
  protein: number
  fat: number
}

interface PhysiologyResolved {
  heightCm: number
  weightKg: number
  age: number
  male: boolean
  pal: number
  bmrMifflin: number
  tdeeKcal: number
  pRatio: number
  refBmrMifflin: number
}

export interface MetabolicSimResult {
  absorbPerMin: Float64Array
  outPerMin: Float64Array
  refOutPerMin: Float64Array
  fatDeltaGramsPerMin: Float64Array
  fatGramsAccumulated: number
  /** 各分钟 max(0, 吸收−消耗) 之和，表征餐后相对当时代谢功率的「过剩」累计（kcal，示意） */
  acuteSurplusIntegralKcal: number
  proteinAbsorbPerMin: Float64Array
}

export interface MetabolicDynamicsReportProps {
  /** 报告日 YYYY-MM-DD，默认本地当天 */
  reportDate?: string
}

/** 中国时区自然日 YYYY-MM-DD（与后端 `record_time` 落日一致） */
function chinaWallYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** 解析 `record_time`（ISO/时间戳/空格日期）为中国时区的日历日与 0–1439 分钟 */
function recordTimeToChinaYmdAndMinute(recordTime: unknown): { ymd: string; minuteOfDay: number } | null {
  let d: Date
  if (typeof recordTime === 'number' && Number.isFinite(recordTime)) {
    d = new Date(recordTime)
  } else if (typeof recordTime === 'string') {
    const s = recordTime.trim()
    if (!s) return null
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    d = new Date(normalized)
  } else {
    return null
  }
  if (Number.isNaN(d.getTime())) return null

  const ymd = chinaWallYmd(d)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return { ymd, minuteOfDay: hour * 60 + minute }
}

function parseAgeFromBirthday(birthday: string | null | undefined): number {
  if (!birthday || typeof birthday !== 'string') return 30
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday.trim())
  if (!m) return 30
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  if (![y, mo, da].every(Number.isFinite)) return 30
  const born = new Date(y, mo - 1, da)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const md = now.getMonth() - born.getMonth()
  if (md < 0 || (md === 0 && now.getDate() < born.getDate())) age -= 1
  return Math.max(18, Math.min(90, age))
}

function isMaleGender(g: string | null | undefined): boolean {
  if (!g) return true
  const s = `${g}`.toLowerCase()
  return s === 'male' || s === 'm' || s === '1' || g === '男'
}

function activityToPal(level: string | null | undefined): number {
  if (!level) return 1.375
  const s = `${level}`.toLowerCase()
  if (s.includes('久坐') || s.includes('sedentary')) return 1.2
  if (s.includes('轻度') || s.includes('light')) return 1.375
  if (s.includes('中等') || s.includes('moderate')) return 1.55
  if (s.includes('高度') || s.includes('active') && !s.includes('very')) return 1.725
  if (s.includes('极高') || s.includes('very')) return 1.9
  return 1.375
}

/** Mifflin-St Jeor（千卡/日） */
function mifflinStJeorKg(weightKg: number, heightCm: number, age: number, male: boolean): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return male ? base + 5 : base - 161
}

/** Deurenberg 风格体脂估算（%） */
function estimateBodyFatPercent(bmi: number, age: number, male: boolean): number {
  const bf = 1.2 * bmi + 0.23 * age - (male ? 16.2 : 5.4)
  return Math.max(8, Math.min(45, bf))
}

function pRatioFromBodyFat(bfPercent: number): number {
  return 2 / (3 * (bfPercent / 100 + 1))
}

function foodRecordsToMeals(records: FoodRecord[], dayYmd: string): MealEvent[] {
  const meals: MealEvent[] = []
  for (const r of records) {
    const wall = recordTimeToChinaYmdAndMinute(r.record_time as unknown)
    if (!wall || wall.ymd !== dayYmd) continue
    const tMin = wall.minuteOfDay
    let carbs = Math.max(0, r.total_carbs)
    let protein = Math.max(0, r.total_protein)
    let fat = Math.max(0, r.total_fat)
    const kcal = Math.max(0, r.total_calories)
    let kcalMacro = 4 * carbs + 4 * protein + 9 * fat
    if (kcalMacro > 10 && Math.abs(kcalMacro - kcal) > 80 && kcal > 0) {
      const s = kcal / kcalMacro
      carbs *= s
      protein *= s
      fat *= s
      kcalMacro = 4 * carbs + 4 * protein + 9 * fat
    }
    if (kcalMacro < 10 && kcal > 0) {
      carbs = kcal / 4
      protein = 0
      fat = 0
    }
    meals.push({ tMin, kcal, carbs, protein, fat })
  }
  return meals.sort((a, b) => a.tMin - b.tMin)
}

/** 昼夜节律：夜间 22:00–06:00 系数 0.9 */
function circadianFactorMinute(t: number): number {
  const h = Math.floor(t / 60)
  if (h >= 22 || h < 6) return 0.9
  return 1
}

function normalizedGaussianKernel(length: number, peakIdx: number, sigma: number): Float64Array {
  const k = new Float64Array(length)
  let sum = 0
  for (let i = 0; i < length; i++) {
    const v = Math.exp(-0.5 * Math.pow((i - peakIdx) / sigma, 2))
    k[i] = v
    sum += v
  }
  if (sum <= 0) {
    k[Math.min(peakIdx, length - 1)] = 1
    return k
  }
  for (let i = 0; i < length; i++) k[i] /= sum
  return k
}

function addKernelToSeries(target: Float64Array, t0: number, amountKcal: number, kernel: Float64Array): void {
  if (amountKcal <= 0) return
  for (let i = 0; i < kernel.length; i++) {
    const idx = t0 + i
    if (idx >= 0 && idx < MINUTES_PER_DAY) target[idx] += amountKcal * kernel[i]
  }
}

function buildExercisePerMinute(totalDayKcal: number): Float64Array {
  const ex = new Float64Array(MINUTES_PER_DAY)
  if (totalDayKcal <= 0) return ex
  const start = 6 * 60
  const end = 22 * 60
  const slots = Math.max(1, end - start)
  const per = totalDayKcal / slots
  for (let t = start; t < end; t++) ex[t] = per
  return ex
}

function resolvePhysiology(user: UserInfo): PhysiologyResolved {
  const heightCm = user.height && user.height > 0 ? user.height : 170
  const weightKg = user.weight && user.weight > 0 ? user.weight : 65
  const age = parseAgeFromBirthday(user.birthday)
  const male = isMaleGender(user.gender)
  const pal = activityToPal(user.activity_level)
  const bmrCalc = Math.max(800, mifflinStJeorKg(weightKg, heightCm, age, male))
  const bmrMifflin =
    user.bmr != null && Number.isFinite(Number(user.bmr)) && Number(user.bmr) > 0
      ? Number(user.bmr)
      : bmrCalc
  const tdeeKcal =
    user.tdee && user.tdee > 0 ? user.tdee : Math.max(bmrMifflin * pal, bmrMifflin * 1.2)
  const bmi = weightKg / Math.pow(heightCm / 100, 2)
  const bf = estimateBodyFatPercent(bmi, age, male)
  const pRatio = pRatioFromBodyFat(bf)
  const hM = heightCm / 100
  const refKg = 22 * hM * hM
  const refBmrMifflin = Math.max(600, mifflinStJeorKg(refKg, heightCm, age, male))
  return {
    heightCm,
    weightKg,
    age,
    male,
    pal,
    bmrMifflin,
    tdeeKcal,
    pRatio,
    refBmrMifflin,
  }
}

/**
 * 分钟级代谢模拟（同步；大数据量时由调用方分帧包裹）
 */
export function runMetabolicSimulation(params: {
  meals: MealEvent[]
  physiology: PhysiologyResolved
  exerciseDayKcal: number
}): MetabolicSimResult {
  const { meals, physiology, exerciseDayKcal } = params
  const carbK = normalizedGaussianKernel(120, 52, 22)
  const protK = normalizedGaussianKernel(240, 105, 42)
  const fatK = normalizedGaussianKernel(380, 145, 65)

  const carbAbs = new Float64Array(MINUTES_PER_DAY)
  const protAbs = new Float64Array(MINUTES_PER_DAY)
  const fatAbs = new Float64Array(MINUTES_PER_DAY)

  for (const m of meals) {
    const ck = Math.max(0, 4 * m.carbs)
    const pk = Math.max(0, 4 * m.protein)
    const fk = Math.max(0, 9 * m.fat)
    const t0 = Math.max(0, Math.min(MINUTES_PER_DAY - 1, m.tMin))
    addKernelToSeries(carbAbs, t0, ck, carbK)
    addKernelToSeries(protAbs, t0, pk, protK)
    addKernelToSeries(fatAbs, t0, fk, fatK)
  }

  const absorbPerMin = new Float64Array(MINUTES_PER_DAY)
  const proteinAbsorbPerMin = new Float64Array(MINUTES_PER_DAY)
  for (let t = 0; t < MINUTES_PER_DAY; t++) {
    absorbPerMin[t] = carbAbs[t] + protAbs[t] + fatAbs[t]
    proteinAbsorbPerMin[t] = protAbs[t]
  }

  const exPer = buildExercisePerMinute(exerciseDayKcal)
  const bmrBasePerMin = physiology.bmrMifflin / MINUTES_PER_DAY
  const tdeeBasePerMin = physiology.tdeeKcal / MINUTES_PER_DAY
  const refBmrPerMin = physiology.refBmrMifflin / MINUTES_PER_DAY

  const outPerMin = new Float64Array(MINUTES_PER_DAY)
  const refOutPerMin = new Float64Array(MINUTES_PER_DAY)

  for (let t = 0; t < MINUTES_PER_DAY; t++) {
    const circ = circadianFactorMinute(t)
    const tef = 0.25 * proteinAbsorbPerMin[t]
    const palFactor = physiology.bmrMifflin > 0 ? physiology.tdeeKcal / physiology.bmrMifflin : physiology.pal
    const baseOut = bmrBasePerMin * palFactor * circ
    outPerMin[t] = baseOut + tef + exPer[t]
    refOutPerMin[t] = refBmrPerMin * 1.2 * circ
  }

  const fatDeltaGramsPerMin = new Float64Array(MINUTES_PER_DAY)
  let acuteBuffer = ACUTE_BUFFER_START_KCAL
  let fatGrams = 0
  let acuteSurplusIntegralKcal = 0

  for (let t = 0; t < MINUTES_PER_DAY; t++) {
    const intake = absorbPerMin[t]
    const out = outPerMin[t]
    const delta = intake - out
    if (delta > 0) {
      acuteSurplusIntegralKcal += delta
      const room = Math.max(0, ACUTE_BUFFER_MAX_KCAL - acuteBuffer)
      const fill = Math.min(delta, room)
      acuteBuffer += fill
      const remainder = delta - fill
      const fatKcal = remainder * physiology.pRatio
      const g = fatKcal / 9
      fatGrams += g
      fatDeltaGramsPerMin[t] = g
    } else {
      const need = -delta
      const take = Math.min(need, acuteBuffer)
      acuteBuffer -= take
    }
  }

  return {
    absorbPerMin,
    outPerMin,
    refOutPerMin,
    fatDeltaGramsPerMin,
    fatGramsAccumulated: fatGrams,
    acuteSurplusIntegralKcal,
    proteinAbsorbPerMin,
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(() => resolve(), 0)
    }
  })
}

const CANVAS_ID = 'metabolicFluxCanvas'

/** 须高于 `custom-tab-bar`（z-index:999）及页面内浮层；面板略高于遮罩 */
const METABOLIC_PHYS_BACKDROP_Z = 200000
const METABOLIC_PHYS_PANEL_Z = 200010

/** 微信小程序：自定义组件内节点需跨组件选择器或 page.in，否则 node 一直为空 */
function createCanvasSelectorQuery(): ReturnType<typeof Taro.createSelectorQuery> {
  const base = Taro.createSelectorQuery()
  const page = Taro.getCurrentInstance()?.page
  if (page && typeof base.in === 'function') {
    try {
      return base.in(page)
    } catch {
      return base
    }
  }
  return base
}

function pickCanvasNode(res: unknown): (HTMLCanvasElement & { getContext: (t: '2d') => CanvasRenderingContext2D | null }) | null {
  const raw = res as { node?: HTMLCanvasElement & { getContext: (t: '2d') => CanvasRenderingContext2D | null } } | undefined
  return raw?.node ?? null
}

function formatGenderLabel(g: string | null | undefined): string {
  if (!g || !String(g).trim()) return '—'
  const s = `${g}`.toLowerCase()
  if (s === 'female' || s === 'f' || g === '女') return '女'
  if (s === 'male' || s === 'm' || g === '男') return '男'
  return String(g)
}

/** 营养相关展示：保留一位小数 */
function formatNutritionOneDecimal(n: number): string {
  return `${Math.round(n * 10) / 10}`
}

interface MetabolicPhysiologyPopupProps {
  open: boolean
  onClose: () => void
  physiology: PhysiologyResolved
  user: UserInfo
}

function MetabolicPhysiologyPopup({
  open,
  onClose,
  physiology,
  user,
}: MetabolicPhysiologyPopupProps): ReactElement {
  return (
    <Popup
      open={open}
      placement='bottom'
      rounded
      onClose={onClose}
      className='metabolic-phys-popup__portal'
      style={{ zIndex: METABOLIC_PHYS_PANEL_Z }}
    >
      <Backdrop
        className='metabolic-phys-popup__backdrop'
        open={open}
        closeable
        lock
        style={{ zIndex: METABOLIC_PHYS_BACKDROP_Z }}
        onClose={() => onClose()}
      />
      <View className='metabolic-phys-popup' onClick={(e) => e.stopPropagation()}>
        <Text className='metabolic-phys-popup__title'>模拟所用基础数据</Text>
        <Text className='metabolic-phys-popup__hint'>与当日曲线计算一致；BMR 为档案基础代谢，TDEE 含活动系数。</Text>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>性别</Text>
          <Text className='metabolic-phys-popup__value'>{formatGenderLabel(user.gender)}</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>身高</Text>
          <Text className='metabolic-phys-popup__value'>{formatNutritionOneDecimal(physiology.heightCm)} cm</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>体重</Text>
          <Text className='metabolic-phys-popup__value'>{formatNutritionOneDecimal(physiology.weightKg)} kg</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>年龄</Text>
          <Text className='metabolic-phys-popup__value'>{physiology.age} 岁</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>BMR</Text>
          <Text className='metabolic-phys-popup__value'>{formatNutritionOneDecimal(physiology.bmrMifflin)} kcal/日</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>TDEE</Text>
          <Text className='metabolic-phys-popup__value'>{formatNutritionOneDecimal(physiology.tdeeKcal)} kcal/日</Text>
        </View>
        <View className='metabolic-phys-popup__row'>
          <Text className='metabolic-phys-popup__label'>活动系数 PAL</Text>
          <Text className='metabolic-phys-popup__value'>{formatNutritionOneDecimal(physiology.pal)}</Text>
        </View>
        <View className='metabolic-phys-popup__foot'>
          <View className='metabolic-phys-popup__close' onClick={onClose}>
            <Text className='metabolic-phys-popup__close-text'>知道了</Text>
          </View>
        </View>
      </View>
    </Popup>
  )
}

interface MetabolicReportHeadProps {
  showPhysBtn?: boolean
  onOpenPhys?: () => void
}

function MetabolicReportHead({ showPhysBtn, onOpenPhys }: MetabolicReportHeadProps): ReactElement {
  return (
    <View className='metabolic-report__head'>
      <View className='metabolic-report__head-row'>
        <View className='metabolic-report__title-row'>
          <Text className='iconfont icon-huore metabolic-report__title-icon' />
          <Text className='metabolic-report__title'>当日代谢</Text>
        </View>
        {showPhysBtn && onOpenPhys ? (
          <View className='metabolic-report__phys-btn' onClick={() => onOpenPhys()}>
            <Text className='metabolic-report__phys-btn-text'>基础</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function MetabolicDynamicsReport({ reportDate }: MetabolicDynamicsReportProps) {
  /** 与后端按中国日切分的记录一致；未传时按东八区当天 */
  const dayYmd = useMemo(() => reportDate || chinaWallYmd(), [reportDate])
  const [apiUser, setApiUser] = useState<UserInfo | null>(null)
  const [effectiveUser, setEffectiveUser] = useState<UserInfo | null>(null)
  const [profileReady, setProfileReady] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [physSheetOpen, setPhysSheetOpen] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [sim, setSim] = useState<MetabolicSimResult | null>(null)
  const [canvasPx, setCanvasPx] = useState<{ w: number; h: number }>(() => computeMetabolicCanvasPx())
  const [digestPct, setDigestPct] = useState(0)
  const [burnKcalPerMin, setBurnKcalPerMin] = useState(0)

  const simRef = useRef<MetabolicSimResult | null>(null)
  simRef.current = sim
  const mealMinutesRef = useRef<number[]>([])
  const loadedForDayRef = useRef<string | null>(null)
  const chartRef = useRef<ECharts | null>(null)

  const nowMinuteForDay = useCallback((): number => {
    if (chinaWallYmd() !== dayYmd) return MINUTES_PER_DAY - 1
    const d = new Date()
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  }, [dayYmd])

  const profileComplete = useMemo(
    () => isMetabolicProfileComplete(effectiveUser),
    [effectiveUser],
  )

  /** 与 `runMetabolicSimulation` 使用的 `resolvePhysiology` 一致，供「基础」弹层展示 */
  const physiologyForSim = useMemo((): PhysiologyResolved | null => {
    if (!effectiveUser || !isMetabolicProfileComplete(effectiveUser)) return null
    return resolvePhysiology(effectiveUser)
  }, [effectiveUser])

  const physiologyPopupEl =
    physiologyForSim && effectiveUser ? (
      <MetabolicPhysiologyPopup
        open={physSheetOpen}
        onClose={() => setPhysSheetOpen(false)}
        physiology={physiologyForSim}
        user={effectiveUser}
      />
    ) : null

  useEffect(() => {
    void (async () => {
      const token = Taro.getStorageSync('access_token')
      if (!token) {
        setProfileReady(true)
        return
      }
      try {
        const u = await getUserProfile()
        setApiUser(u)
        setEffectiveUser(mergeUserWithLocalProfile(u, loadLocalMetabolicProfile()))
      } catch (e) {
        console.error('MetabolicDynamicsReport profile load fail', e)
        const local = loadLocalMetabolicProfile()
        if (local) {
          const stub: UserInfo = {
            id: '',
            openid: '',
            nickname: '',
            avatar: '',
            height: local.height,
            weight: local.weight,
            gender: local.gender,
            birthday: local.birthday ?? null,
            bmr: local.bmr ?? null,
          }
          setApiUser(stub)
          setEffectiveUser(stub)
        }
      } finally {
        setProfileReady(true)
      }
    })()
  }, [])

  const loadAll = useCallback(async (): Promise<void> => {
    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setPhase('empty')
      return
    }
    if (!effectiveUser || !isMetabolicProfileComplete(effectiveUser)) {
      return
    }
    const needFullReload = loadedForDayRef.current !== dayYmd
    if (needFullReload) {
      setPhase('loading')
      setSim(null)
    }
    const nMin = nowMinuteForDay()
    try {
      const [foodRes, exRes] = await Promise.all([
        getFoodRecordList(dayYmd),
        getExerciseDailyCalories(dayYmd).catch(() => ({ total_calories_burned: 0 })),
      ])
      const phy = resolvePhysiology(effectiveUser)
      const meals = foodRecordsToMeals(foodRes.records || [], dayYmd)
      mealMinutesRef.current = [...meals.map((m) => m.tMin)].sort((a, b) => a - b)
      if (meals.length === 0) {
        setSim(null)
        setPhase('empty')
        loadedForDayRef.current = dayYmd
        return
      }
      await yieldToMain()
      const exerciseKcal = Math.max(0, Number(exRes.total_calories_burned) || 0)
      const result = runMetabolicSimulation({
        meals,
        physiology: phy,
        exerciseDayKcal: exerciseKcal,
      })
      setSim(result)

      let absorbedSoFar = 0
      let dayTotalAbsorb = 0
      for (let t = 0; t < MINUTES_PER_DAY; t++) dayTotalAbsorb += result.absorbPerMin[t]
      for (let t = 0; t <= nMin; t++) absorbedSoFar += result.absorbPerMin[t]
      const pct = dayTotalAbsorb > 0 ? Math.round((absorbedSoFar / dayTotalAbsorb) * 100) : 0
      setDigestPct(Math.max(0, Math.min(100, pct)))
      setBurnKcalPerMin(Math.round(result.outPerMin[nMin] * 10) / 10)

      setPhase('ready')
      loadedForDayRef.current = dayYmd
    } catch (e) {
      console.error('MetabolicDynamicsReport load fail', e)
      setPhase('error')
    }
  }, [dayYmd, nowMinuteForDay, effectiveUser])

  useEffect(() => {
    if (!profileReady) return
    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setPhase('empty')
      return
    }
    if (!effectiveUser || !isMetabolicProfileComplete(effectiveUser)) {
      return
    }
    void loadAll()
  }, [profileReady, effectiveUser, loadAll])

  useLayoutEffect(() => {
    setCanvasPx(computeMetabolicCanvasPx())
  }, [])

  const canvasPxRef = useRef(canvasPx)
  canvasPxRef.current = canvasPx

  const redraw = useCallback(() => {
    const s = simRef.current
    if (!s) return
    const { w, h } = canvasPxRef.current
    if (w < 8 || h < 8) return

    const doDraw = (canvas: HTMLCanvasElement & { getContext: (t: '2d') => CanvasRenderingContext2D | null }): void => {
      const dpr = Taro.getSystemInfoSync().pixelRatio || 2
      patchWxCanvasNodeForEcharts(canvas, w, h)
      let inst = chartRef.current
      if (!inst || inst.isDisposed()) {
        inst = echarts.init(canvas as unknown as HTMLElement, undefined, {
          width: w,
          height: h,
          devicePixelRatio: dpr,
        })
        chartRef.current = inst
      } else {
        inst.resize({ width: w, height: h, devicePixelRatio: dpr })
      }
      inst.setOption(
        buildMetabolicFluxChartOption(s, nowMinuteForDay(), mealMinutesRef.current, SAMPLE_STEP_MIN),
        { notMerge: true },
      )
    }

    const paint = (selector: string, fallback?: () => void): void => {
      createCanvasSelectorQuery()
        .select(selector)
        .fields({ node: true })
        .exec((res) => {
          const canvas = pickCanvasNode(res?.[0])
          if (canvas) {
            doDraw(canvas)
            return
          }
          fallback?.()
        })
    }

    const run = (): void => {
      paint(`.metabolic-report >>> #${CANVAS_ID}`, () => {
        paint(`#${CANVAS_ID}`, () => {
          createCanvasSelectorQuery()
            .select(`>>> #${CANVAS_ID}`)
            .fields({ node: true })
            .exec((res) => {
              const canvas = pickCanvasNode(res?.[0])
              if (canvas) doDraw(canvas)
            })
        })
      })
    }

    Taro.nextTick(run)
    requestAnimationFrame(run)
    setTimeout(run, 80)
    setTimeout(run, 320)
  }, [nowMinuteForDay])

  useEffect(() => {
    if (phase === 'ready' && sim) {
      redraw()
    }
  }, [phase, sim, redraw, canvasPx.w, canvasPx.h])

  /** 微信原生 Canvas 会浮在普通 View 之上；打开「基础」时卸载图表并 dispose，关闭后再 redraw */
  useEffect(() => {
    if (physSheetOpen) {
      chartRef.current?.dispose()
      chartRef.current = null
      return
    }
    if (phase === 'ready' && sim) {
      redraw()
    }
  }, [physSheetOpen, phase, sim, redraw])

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  if (!profileReady) {
    return (
      <View className='metabolic-report'>
        <MetabolicReportHead />
        <View className='metabolic-report__loading'>
          <View className='metabolic-report__spinner' />
        </View>
      </View>
    )
  }

  if (!Taro.getStorageSync('access_token')) {
    return null
  }

  if (!profileComplete) {
    return (
      <View className='metabolic-report metabolic-report--gated'>
        <MetabolicReportHead />
        <View className='metabolic-report__gate-body'>
          <View className='metabolic-report__ghost'>
            <View className='metabolic-report__gauges'>
              <View className='metabolic-report__gauge metabolic-report__gauge--ghost' />
              <View className='metabolic-report__gauge metabolic-report__gauge--ghost' />
            </View>
            <View className='metabolic-report__canvas-wrap metabolic-report__canvas-wrap--ghost' />
            <View className='metabolic-report__legend-row metabolic-report__legend-row--ghost'>
              <View className='metabolic-report__legend-pill' />
              <View className='metabolic-report__legend-pill' />
              <View className='metabolic-report__legend-pill' />
            </View>
          </View>
          <View className='metabolic-report__gate-mask' onClick={() => setSheetOpen(true)}>
            <Text className='metabolic-report__gate-title'>档案未完善</Text>
            <Text className='metabolic-report__gate-desc'>
              请先填写身高、体重、性别与基础代谢（BMR），保存至云端或本机后即可查看代谢示意。
            </Text>
            <Text className='metabolic-report__gate-cta'>点击填写</Text>
          </View>
        </View>
        <MetabolicProfileSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          initialUser={apiUser}
          onSaved={(u) => {
            setApiUser(u)
            setEffectiveUser(mergeUserWithLocalProfile(u, loadLocalMetabolicProfile()))
          }}
        />
      </View>
    )
  }

  if (phase === 'loading' && !sim) {
    return (
      <View className='metabolic-report'>
        <MetabolicReportHead
          showPhysBtn={!!physiologyForSim}
          onOpenPhys={() => setPhysSheetOpen(true)}
        />
        <View className='metabolic-report__loading'>
          <View className='metabolic-report__spinner' />
        </View>
        {physiologyPopupEl}
      </View>
    )
  }

  if (phase === 'error') {
    return (
      <View className='metabolic-report'>
        <MetabolicReportHead
          showPhysBtn={!!physiologyForSim}
          onOpenPhys={() => setPhysSheetOpen(true)}
        />
        <View className='metabolic-report__error'>
          <View className='metabolic-report__retry' onClick={() => void loadAll()}>
            <Text className='metabolic-report__retry-text'>重试</Text>
          </View>
        </View>
        {physiologyPopupEl}
      </View>
    )
  }

  if (!sim) {
    return null
  }

  return (
    <View className='metabolic-report'>
      <MetabolicReportHead
        showPhysBtn={!!physiologyForSim}
        onOpenPhys={() => setPhysSheetOpen(true)}
      />

      <View className='metabolic-report__gauges'>
        <View className='metabolic-report__gauge'>
          <Text className='metabolic-report__gauge-label'>当日吸收进度</Text>
          <Text className='metabolic-report__gauge-value'>{`${digestPct}%`}</Text>
        </View>
        <View className='metabolic-report__gauge'>
          <Text className='metabolic-report__gauge-label'>当前总消耗</Text>
          <Text className='metabolic-report__gauge-value'>
            {burnKcalPerMin}
            <Text className='metabolic-report__gauge-unit'> kcal/分</Text>
          </Text>
        </View>
      </View>

      <View className='metabolic-report__canvas-wrap'>
        {!physSheetOpen ? (
          <Canvas
            type='2d'
            id={CANVAS_ID}
            className='metabolic-report__canvas'
            style={{ width: `${canvasPx.w}px`, height: `${canvasPx.h}px` }}
          />
        ) : (
          <View
            className='metabolic-report__canvas-placeholder'
            style={{ width: '100%', height: `${canvasPx.h}px` }}
          />
        )}
      </View>

      <View className='metabolic-report__legend-row'>
        <View className='metabolic-report__legend-dot metabolic-report__legend-dot--absorb' />
        <Text className='metabolic-report__legend-txt'>吸收</Text>
        <View className='metabolic-report__legend-dot metabolic-report__legend-dot--burn' />
        <Text className='metabolic-report__legend-txt'>消耗</Text>
        <View className='metabolic-report__legend-dot metabolic-report__legend-dot--ref' />
        <Text className='metabolic-report__legend-txt'>参考</Text>
        <View className='metabolic-report__legend-dot metabolic-report__legend-dot--meal' />
        <Text className='metabolic-report__legend-txt'>用餐</Text>
      </View>

      <Text className='metabolic-report__footnote'>
        曲线由 Apache ECharts 绘制。餐后吸收相对当时消耗，累计过剩约 {Math.round(sim.acuteSurplusIntegralKcal)}{' '}
        kcal；示意淤积约 {Math.round(sim.fatGramsAccumulated * 100) / 100} g（非医疗结论）
      </Text>
      {physiologyPopupEl}
    </View>
  )
}
