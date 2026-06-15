import type { AnalysisTask } from '@food-link/core'

export const demoFoodImageUrl = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900'

export function createDemoAnalysisTask(): AnalysisTask {
  const now = new Date().toISOString()
  return {
    id: `mobile-demo-${Date.now()}`,
    user_id: 'mobile-demo-user',
    task_type: 'food',
    status: 'done',
    image_url: demoFoodImageUrl,
    result: {
      description: '鸡胸肉沙拉和米饭，适合保存前按实际食用比例调整。',
      insight: '这餐蛋白质充足，碳水适中；如果是多人分食，可以先按人数分摊再保存。',
      pfc_ratio_comment: '蛋白质占比较高，适合训练日或控脂期。',
      absorption_notes: '先吃蔬菜和蛋白质，再吃主食，有助于餐后血糖更平稳。',
      context_advice: '示例结果仅用于本地开发验证，不会触发真实 AI 分析。',
      total_calories: 560,
      total_protein: 42,
      total_carbs: 58,
      total_fat: 18,
      total_weight_grams: 420,
      items: [
        {
          name: '鸡胸肉沙拉',
          estimatedWeightGrams: 260,
          originalWeightGrams: 260,
          suggestedRatio: 50,
          suggestedRatioReason: '看起来像多人分享的大份沙拉',
          suggestedRatioSource: 'ai',
          nutrients: {
            calories: 320,
            protein: 36,
            carbs: 18,
            fat: 12,
            fiber: 5,
            sugar: 4,
          },
        },
        {
          name: '米饭',
          estimatedWeightGrams: 160,
          originalWeightGrams: 160,
          nutrients: {
            calories: 240,
            protein: 6,
            carbs: 40,
            fat: 6,
            fiber: 1,
            sugar: 0.5,
          },
        },
      ],
    },
    created_at: now,
    updated_at: now,
  }
}
