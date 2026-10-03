import Taro from '@tarojs/taro'
import { getAnalyzeTask, submitTextAnalyzeTask, type AnalyzeResponse, type FoodItem } from './api'
import { getFoodCorrectionCreditCost } from './membership'

export async function confirmSingleItemRecalculation(name: string): Promise<boolean> {
  const { confirm } = await Taro.showModal({
    title: '重算这一项',
    content: `按当前重量重算「${name}」的营养，其他食物保持不变。消耗 ${getFoodCorrectionCreditCost('standard')} 积分；任务失败按现有规则退回。`,
    confirmText: '重算',
  })
  return confirm
}

// The returned target is applied by the editor only after the task succeeds.
// Polling does not touch global result storage or save a meal.
export async function recalculateSingleFoodItem(input: {
  previous: AnalyzeResponse
  index: number
  name: string
  weight: number
  sourceTaskId?: string
  isCurrent: () => boolean
}): Promise<FoodItem> {
  const submitted = await submitTextAnalyzeTask({
    text: `${input.name} ${input.weight}克`,
    execution_mode: 'standard',
    analysis_engine: 'db_first',
    previousResult: input.previous,
    correction_target_index: input.index,
    correctionItems: [{ name: input.name, weight: input.weight, nameEdited: true }],
    correction_source_task_id: input.sourceTaskId,
    suggest_ratio_enabled: false,
  })
  const deadline = Date.now() + 180000
  while (input.isCurrent() && Date.now() < deadline) {
    const task = await getAnalyzeTask(submitted.task_id)
    if (!input.isCurrent()) throw new Error('编辑已关闭，原数据保持不变')
    if (task.status === 'done') {
      const result = task.result
      const target = result?.items?.[input.index] as FoodItem | undefined
      if (result?.correctionTargetIndex !== input.index || result?.items?.length !== input.previous.items.length || !target?.nutrients) {
        throw new Error('未返回有效的单项重算结果，原数据保持不变')
      }
      return target
    }
    if (['failed', 'violated', 'timed_out', 'cancelled'].includes(task.status)) {
      throw new Error(task.error_message || '重算失败，原数据保持不变')
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error(input.isCurrent() ? '重算仍未完成，原数据保持不变，请稍后查看识别任务' : '编辑已关闭，原数据保持不变')
}
