import { readFileSync } from 'fs'
import { resolve } from 'path'

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../src', relativePath), 'utf8')
}

describe('exercise precision mode', () => {
  it('offers structured details while keeping the original description separate', () => {
    const page = readSource('packageExtra/pages/exercise-record/index.tsx')

    expect(page).toContain('精准估算')
    expect(page).toContain('整次总时长 *')
    expect(page).toContain('总时长只会用于整次训练，不会复制给每个动作')
    expect(page).toContain('平均心率（选填）')
    expect(page).toContain('动作时间或组次（选填）')
    expect(page).toContain('exercise_desc: content')
    expect(page).toContain('estimation_mode: estimationMode')
  })

  it('sends precision fields independently from the user text', () => {
    const api = readSource('utils/api.ts')

    expect(api).toContain("estimation_mode?: 'standard' | 'precision'")
    expect(api).toContain('total_duration_min?: number')
    expect(api).toContain('average_heart_rate?: number')
    expect(api).toContain('exercise_breakdown?: string')
  })

  it('does not expose internal exercise breakdown or reasoning in circle detail', () => {
    const detail = readSource('packageExtra/pages/interaction-feed-detail/index.tsx')

    expect(detail).not.toContain("feedItem.record.ai_reasoning || 'AI 已根据运动内容估算消耗'")
  })
})
