import Taro from '@tarojs/taro'
import type { DietDecisionBasis, DietRecommendationOption, DietRecommendationResult } from './api'

/** Details stay off the home cards; only public references are copied. */
export async function showDietDecisionEvidence(basis: DietDecisionBasis, reason?: string, context?: { result: DietRecommendationResult; option: DietRecommendationOption }) {
  const nutrientNote = basis.nutrient_state
    ? '营养比较按适用的个人计划和数据覆盖计算；缺失含量保留未知，不等于没有摄入。'
    : ''
  const coverage = context?.result.catalog_coverage?.map(row => `${row.scope === 'nearby' ? `当前位置 ${row.radius_km || 5} 公里内` : row.school?.name || '指定范围'}：已核对 ${row.retrieved}/${row.total_matches} 条${row.status === 'complete' ? '已收录菜单' : '，本次检索未完成'}`).join('\n')
  const method = context?.result.selection_audit
    ? (context.result.selection_audit.method === 'model_validated' ? '规则筛选后，由大模型结合菜单文本终选，结果已复核。' : '本次采用规则终选；未使用大模型最终判断。')
    : ''
  const plan = context?.option.remaining_day_plan
  const mealLabels: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
  const plannedSteps = plan?.steps.slice(1).map(step => `${mealLabels[step.meal_type] || step.meal_type}：${step.candidate.title}`).join('；')
  const planNote = plannedSteps ? `假设本餐选择并吃完这份，后续搭配参考：${plannedSteps}。这是条件规划，不是已吃记录，不保证全天达标或当日供应。` : ''
  const content = [context?.option.selection_reason || reason || basis.actions[0], coverage, method, context?.option.evidence_issues?.join('；'), planNote, `目标依据：${basis.target_source}`, nutrientNote, basis.sources.map(source => source.title).join('、'), '餐食适配不等于身体健康分；记录或估算不能诊断营养缺乏。'].filter(Boolean).join('\n\n')
  const response = await Taro.showModal({ title: '推荐依据', content, confirmText: '复制来源', cancelText: '知道了' })
  if (response.confirm) {
    await Taro.setClipboardData({ data: basis.sources.map(source => `${source.title}\n${source.scope}\n${source.url}`).join('\n\n') })
  }
}
