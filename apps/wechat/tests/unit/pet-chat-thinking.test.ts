import { appendThinkingStep, chatThinkingSteps } from '../../src/packageExtra/pages/pet-chat/thinking-steps'
import { petChatFailureText, savedAnswerFor } from '../../src/packageExtra/pages/pet-chat/chat-failure'
import type { PetChatHistoryMessage } from '../../src/utils/api'

describe('伙伴聊天等回答时的步骤', () => {
  it('says something before the first step arrives and keeps only the last three', () => {
    expect(chatThinkingSteps(undefined)).toEqual(['在想…'])
    expect(chatThinkingSteps([], '在比哪份最适合你…')).toEqual(['在比哪份最适合你…'])
    expect(chatThinkingSteps(['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd'])
  })

  it('does not repeat the same step and keeps the list short', () => {
    expect(appendThinkingStep(['a'], 'a')).toEqual(['a'])
    expect(appendThinkingStep(undefined, '  ')).toEqual([])
    const many = Array.from({ length: 12 }, (_, i) => `step ${i}`).reduce<string[]>((list, step) => appendThinkingStep(list, step), [])
    expect(many).toHaveLength(8)
    expect(many[7]).toBe('step 11')
  })
})

describe('when the answer does not arrive', () => {
  it('talks about the meal, not about reading records', () => {
    const meal = petChatFailureText({ petName: '健文伙伴', mealTurn: true, keptOptions: false })
    expect(meal).toContain('没挑完这一餐')
    expect(meal).toContain('重试')
    expect(meal).not.toContain('读完记录')
    expect(meal).not.toContain('7 天')
    expect(petChatFailureText({ petName: '豆豆', mealTurn: true, keptOptions: true })).toContain('先看这几份')
    expect(petChatFailureText({ petName: '豆豆', mealTurn: false, keptOptions: false })).toBe('豆豆这次没答完，你的问题还在。点「重试」再问一次。')
  })

  it('finds an answer the server saved after the connection dropped', () => {
    const asked: PetChatHistoryMessage = { id: 'u1', role: 'user', content: '晚上吃什么好？' }
    const answered: PetChatHistoryMessage = { id: 'a1', role: 'assistant', content: '这三份可以', message_type: 'diet_recommendation' }
    expect(savedAnswerFor([asked, answered], '晚上吃什么好？')).toBe(true)
    expect(savedAnswerFor([asked], '晚上吃什么好？')).toBe(false)
    expect(savedAnswerFor([asked, answered], '早饭吃什么')).toBe(false)
    expect(savedAnswerFor([answered, asked], '晚上吃什么好？')).toBe(false)
  })
})
