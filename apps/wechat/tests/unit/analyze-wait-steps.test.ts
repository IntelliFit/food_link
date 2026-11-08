import { buildWaitSteps, waitStatusNote } from '../../src/packageExtra/pages/analyze-loading/wait-steps'

const states = (steps: ReturnType<typeof buildWaitSteps>) => steps.map(step => step.state)

describe('recognising page steps', () => {
  it('marks the photo as received and works on the foods while the task is queued or running', () => {
    for (const statusText of ['已提交', '排队中', '处理中', '网络重连中']) {
      const steps = buildWaitSteps({ taskType: 'food', isCorrection: false, statusText })
      expect(steps.map(step => step.label)).toEqual(['照片收到', '认出每样食物、估克重', '算热量和营养'])
      expect(states(steps)).toEqual(['done', 'active', 'todo'])
    }
  })

  it('moves to the nutrition step only when the backend is finishing or the result is ready', () => {
    expect(states(buildWaitSteps({ taskType: 'food', isCorrection: false, statusText: '收尾中' }))).toEqual(['done', 'done', 'active'])
    expect(states(buildWaitSteps({ taskType: 'food', isCorrection: false, statusText: '处理中', recognitionReady: true }))).toEqual(['done', 'done', 'active'])
  })

  it('uses wording that fits text records, exercise and corrections', () => {
    expect(buildWaitSteps({ taskType: 'food_text', isCorrection: false, statusText: '处理中' })[0].label).toBe('文字收到')
    expect(buildWaitSteps({ taskType: 'exercise', isCorrection: false, statusText: '处理中' })[2].label).toBe('算消耗的热量')
    expect(buildWaitSteps({ taskType: 'food', isCorrection: true, statusText: '已提交纠错' })[1].label).toBe('按你的修改重新识别')
  })

  it('only surfaces queue and network states under the steps', () => {
    expect(waitStatusNote('排队中')).toBe('排队中')
    expect(waitStatusNote('网络重连中')).toBe('网络重连中')
    expect(waitStatusNote('处理中')).toBe('')
    expect(waitStatusNote('已提交')).toBe('')
  })
})
