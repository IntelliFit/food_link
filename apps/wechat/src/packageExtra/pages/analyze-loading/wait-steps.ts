/** 识别中页面的三步进度：跟着真实任务状态走，不按时间假装前进。 */
export type WaitStepState = 'done' | 'active' | 'todo'

export interface WaitStep {
  label: string
  state: WaitStepState
}

export interface WaitStepsInput {
  taskType: string
  isCorrection: boolean
  /** 页面上的任务状态文案：已提交 / 已提交纠错 / 排队中 / 处理中 / 收尾中 / 网络重连中 */
  statusText: string
  /** 识别结果已出，正在等用户在食堂卡片里选完 */
  recognitionReady?: boolean
}

function stepLabels(taskType: string, isCorrection: boolean): [string, string, string] {
  if (isCorrection) return ['修改收到', '按你的修改重新识别', '重算热量和营养']
  if (taskType === 'exercise') return ['描述收到', '估算运动强度和时长', '算消耗的热量']
  if (taskType === 'food_text') return ['文字收到', '拆出每样食物、估份量', '算热量和营养']
  return ['照片收到', '认出每样食物、估克重', '算热量和营养']
}

export function buildWaitSteps(input: WaitStepsInput): WaitStep[] {
  const labels = stepLabels(input.taskType, input.isCorrection)
  const finishing = input.recognitionReady === true || input.statusText.includes('收尾')
  const activeIndex = finishing ? 2 : 1
  return labels.map((label, index) => ({
    label,
    state: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo',
  }))
}

/** 进度卡底部的小字：排队、网络重连这类需要用户知道的状态才显示。 */
export function waitStatusNote(statusText: string): string {
  if (statusText.includes('排队')) return '排队中'
  if (statusText.includes('重连')) return '网络重连中'
  return ''
}
