/**
 * 首页记录菜单等：调试入口统一跳转（不依赖拍照分析页本地状态）。
 * 图片使用 `dev-debug-storage` 中预置的测试 URL（可选）；营养等为 `dev-debug-mock` 编造数据。
 */
import Taro from '@tarojs/taro'
import { foodRecordFromAnalyzeResponse } from './dev-record-preview'
import { buildRandomDebugAnalyzeResponse } from './dev-debug-mock'
import { getDevDebugUiTestImagePaths } from './dev-debug-storage'

function applyPresetImagesToAnalyzeStorage(): void {
  const paths = getDevDebugUiTestImagePaths()
  if (paths.length === 0) {
    Taro.setStorageSync('analyzeImagePath', '')
    Taro.setStorageSync('analyzeImagePaths', [])
  } else {
    Taro.setStorageSync('analyzeImagePath', paths[0])
    Taro.setStorageSync('analyzeImagePaths', paths)
  }
}

/** 随机样本 → 分析结果页；头图使用预置测试 URL（若有） */
export function openDebugResultPageFromMenu(): void {
  const mockResult = buildRandomDebugAnalyzeResponse()
  applyPresetImagesToAnalyzeStorage()
  Taro.setStorageSync('analyzeResult', JSON.stringify(mockResult))
  Taro.setStorageSync('analyzeMealType', 'breakfast')
  Taro.setStorageSync('analyzeDietGoal', 'none')
  Taro.setStorageSync('analyzeActivityTiming', 'none')
  Taro.setStorageSync('analyzeSourceTaskId', 'debug-task-id')
  Taro.setStorageSync('analyzeTaskType', 'food')
  Taro.setStorageSync('analyzeCompareMode', false)
  Taro.setStorageSync('analyzeExecutionMode', 'standard')
  Taro.setStorageSync('analyzeDebugPreview', '1')
  Taro.navigateTo({ url: '/pages/result/index' })
}

/** 进入 analyze-loading 调试态；若有预置图则带入 loading 展示 */
export function openDebugAnalyzeLoadingFromMenu(): void {
  Taro.setStorageSync('analyzeExecutionMode', 'standard')
  Taro.setStorageSync('analyzeTaskType', 'food')
  applyPresetImagesToAnalyzeStorage()
  Taro.navigateTo({
    url: `/pages/analyze-loading/index?task_id=debug-task-${Date.now()}&execution_mode=standard&task_type=food`
  })
}

/** 随机样本 → 记录详情（调分享海报，不请求后端）；头图用预置 URL */
export function openDebugRecordDetailPosterFromMenu(): void {
  const mock = buildRandomDebugAnalyzeResponse()
  const uid = String(Taro.getStorageSync('user_id') || 'debug-local')
  const rec = foodRecordFromAnalyzeResponse(mock, {
    mealType: 'breakfast',
    dietGoal: 'none',
    activityTiming: 'none',
    imagePaths: getDevDebugUiTestImagePaths(),
    userId: uid,
  })
  Taro.setStorageSync('recordDetail', rec)
  Taro.navigateTo({ url: '/pages/record-detail/index' })
}

/** 进入拍照分析页（实拍流程，与菜单调试数据无关） */
export function openAnalyzePageFromMenu(): void {
  Taro.navigateTo({ url: '/pages/analyze/index' })
}
