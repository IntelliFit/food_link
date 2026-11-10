/** Copy and pacing for the pet that keeps people company on the recognition wait page. */

export interface WaitingStageInput {
  elapsedSeconds: number
  taskType: string
  isCorrection: boolean
  isPrecision: boolean
  recognitionReady: boolean
}

export interface WaitingStageLine {
  key: string
  text: string
}

export interface PetSnack {
  id: string
  emoji: string
  label: string
  fact: string
}

export const PET_SNACKS: readonly PetSnack[] = [
  { id: 'apple', emoji: '🍎', label: '苹果', fact: '嘎嘣脆！一个中等苹果约 100 千卡。' },
  { id: 'egg', emoji: '🥚', label: '鸡蛋', fact: '好香！一个鸡蛋约 6 克蛋白质。' },
  { id: 'broccoli', emoji: '🥦', label: '西兰花', fact: '绿绿的！每 100 克西兰花只有约 35 千卡。' },
  { id: 'milk', emoji: '🥛', label: '牛奶', fact: '咕嘟咕嘟！一杯 250 毫升牛奶约 8 克蛋白质。' },
  { id: 'strawberry', emoji: '🍓', label: '草莓', fact: '草莓小帽子摘掉，酸酸甜甜一口吃！' },
  { id: 'banana', emoji: '🍌', label: '香蕉', fact: '剥开一根小香蕉，今天也是元气满满！' },
  { id: 'carrot', emoji: '🥕', label: '胡萝卜', fact: '咔嚓咔嚓，听见胡萝卜的声音了吗？' },
  { id: 'orange', emoji: '🍊', label: '橘子', fact: '一瓣给我，一瓣留给你～' },
  { id: 'grapes', emoji: '🍇', label: '葡萄', fact: '葡萄排排队，一个一个慢慢吃。' },
  { id: 'corn', emoji: '🌽', label: '玉米', fact: '抱着小玉米，啃得整整齐齐！' },
  { id: 'sweet-potato', emoji: '🍠', label: '红薯', fact: '热乎乎的红薯，先吹一吹再吃～' },
  { id: 'bread', emoji: '🍞', label: '面包', fact: '面包软软的，快乐也软乎乎！' },
  { id: 'watermelon', emoji: '🍉', label: '西瓜', fact: '抱住小西瓜，夏天的快乐藏在里面。' },
  { id: 'rice', emoji: '🍙', label: '饭团', fact: '饭团小小一个，捧在手里刚刚好！' },
  { id: 'pear', emoji: '🍐', label: '梨', fact: '梨子脆脆的，嘴巴忙起来了！' },
  { id: 'peach', emoji: '🍑', label: '桃子', fact: '收到一颗小桃子，心情也甜起来了。' },
]

export const PET_SNACK_TRAY_SIZE = 4
export const PET_MAX_SNACKS = 5
export const PET_FULL_LINE = '吃饱啦，打个嗝～剩下的留给你这顿！'

function randomIndex(length: number, random: () => number): number {
  const value = random()
  return Math.min(length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * length)))
}

/** Each wait gets a small shuffled tray, rather than the same four foods. */
export function createPetSnackTray(random: () => number = Math.random): PetSnack[] {
  const shuffled = [...PET_SNACKS]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const other = randomIndex(i + 1, random)
    ;[shuffled[i], shuffled[other]] = [shuffled[other], shuffled[i]]
  }
  return shuffled.slice(0, PET_SNACK_TRAY_SIZE)
}

/** Replace only the eaten food; the next tray never duplicates a visible food. */
export function replacePetSnack(
  tray: readonly PetSnack[],
  eatenId: string,
  random: () => number = Math.random,
): PetSnack[] {
  if (!tray.some(snack => snack.id === eatenId)) return [...tray]
  const visible = new Set(tray.map(snack => snack.id))
  const candidates = PET_SNACKS.filter(snack => !visible.has(snack.id))
  if (candidates.length === 0) return [...tray]
  const next = candidates[randomIndex(candidates.length, random)]
  return tray.map(snack => snack.id === eatenId ? next : snack)
}

const TAP_LINES = ['嘿嘿，痒痒的～', '我在认真干活呢！', '再摸摸，我看得更快！', '好啦好啦，别分我心～']
const TAP_COMBO_LINE = '你也太喜欢我了吧！'
const TAP_COMBO_EVERY = 6

interface StageStep {
  from: number
  text: string
}

const PHOTO_STEPS: readonly StageStep[] = [
  { from: 0, text: '照片收到！让我凑近瞧瞧～' },
  { from: 5, text: '我在一样一样认这顿吃了什么…' },
  { from: 12, text: '正在估每样有多少克，别急～' },
  { from: 25, text: '这顿有点丰富，我再仔细看看！' },
  { from: 60, text: '还在努力。你可以先去忙，好了我叫你！' },
]

const PRECISION_STEPS: readonly StageStep[] = [
  { from: 0, text: '精准模式启动！我要拿放大镜了～' },
  { from: 10, text: '正在把每样食物分开细看…' },
  { from: 30, text: '一样一样估重量，这步最费功夫。' },
  { from: 60, text: '快了快了，你可以先去忙，好了我叫你！' },
]

const TEXT_STEPS: readonly StageStep[] = [
  { from: 0, text: '你说的我都记下了！' },
  { from: 5, text: '正在翻翻这些吃的有多少营养…' },
  { from: 20, text: '再核对一下，马上就好～' },
]

const EXERCISE_STEPS: readonly StageStep[] = [
  { from: 0, text: '动起来了？真棒！' },
  { from: 5, text: '正在算你消耗了多少热量…' },
  { from: 20, text: '再核对一下，马上就好～' },
]

const CORRECTION_STEPS: readonly StageStep[] = [
  { from: 0, text: '收到你的纠正，这次我记牢！' },
  { from: 8, text: '正在按你说的重新算一遍…' },
  { from: 30, text: '再核对一下，你也可以先去忙～' },
]

function stepsFor(input: WaitingStageInput): readonly StageStep[] {
  if (input.isCorrection) return CORRECTION_STEPS
  if (input.taskType === 'exercise') return EXERCISE_STEPS
  if (input.taskType === 'food_text') return TEXT_STEPS
  return input.isPrecision ? PRECISION_STEPS : PHOTO_STEPS
}

export function pickWaitingStageLine(input: WaitingStageInput): WaitingStageLine {
  if (input.recognitionReady) {
    return { key: 'ready', text: '我看好啦！等你答完就出结果～' }
  }
  const steps = stepsFor(input)
  const elapsed = Math.max(0, input.elapsedSeconds)
  const index = steps.reduce((found, step, i) => (elapsed >= step.from ? i : found), 0)
  return { key: `${input.taskType}:${input.isCorrection}:${input.isPrecision}:${index}`, text: steps[index].text }
}

/** count is the running tap total, starting at 1. */
export function petTapLine(count: number): string {
  if (count > 0 && count % TAP_COMBO_EVERY === 0) return TAP_COMBO_LINE
  return TAP_LINES[Math.max(0, count - 1) % TAP_LINES.length]
}

export function petQuizLine(correct: boolean): string {
  return correct ? '答对啦！你比我还懂！' : '差一点点，看看下面的解释～'
}

export function petSnackLine(snack: PetSnack, eatenBefore: number): string {
  if (eatenBefore >= PET_MAX_SNACKS) return PET_FULL_LINE
  return eatenBefore % 2 === 0 ? snack.fact : `${snack.label}我收下啦！谢谢投喂，继续陪你等结果～`
}
