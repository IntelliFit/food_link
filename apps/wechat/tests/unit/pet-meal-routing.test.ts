import { answerAsksQuestion, isFreeMealAcknowledgement, mealAcknowledgementKind, releasesVenueLimit, requestsOtherVenue } from '../../src/packageExtra/pages/pet-chat/meal-routing'
import { activeDietRecommendationContext, classifyDietRecommendationIntent } from '../../src/packageExtra/pages/pet-chat/index'

// These sentences mirror backend/internal/health/service/meal_chat_acknowledgement_test.go.
// The server decides how a turn is answered; the page only shows what the turn costs and
// which card the conversation is about, so both sides must agree.
describe('pet chat acknowledgement mirror', () => {
  it('knows the acknowledgements the server answers for free', () => {
    const kinds: Record<string, string> = {
      '谢谢，我知道了': 'thanks', 谢谢你: 'thanks', 多谢: 'thanks',
      你好呀: 'greeting', 在吗: 'greeting',
      再见: 'farewell', 晚安: 'farewell',
      你真棒: 'praise', 不错: 'praise',
      就这个吧: 'decision', 那我就选第二个: 'decision', '好的，就这个吧': 'decision',
      我去吃饭了: 'going', 那我先去吃了: 'going', '好的，我去吃饭了': 'going',
      好的: 'ack', 嗯嗯: 'ack', 收到: 'ack',
      // emoji, full-width or non-breaking spaces and odd punctuation are ignored on both sides
      '谢谢😊': 'thanks', '收到👍': 'ack', '谢谢👍🏻': 'thanks', '好的👌': 'ack', '就这个吧😋': 'decision',
      '谢谢^_^': 'thanks', '谢谢〜': 'thanks', '「就这个吧」': 'decision', '谢谢❤️': 'thanks',
      '好的　谢谢': 'thanks', '好的 谢谢': 'thanks',
      // anything with content is not an acknowledgement
      '好的，预算再低一点': '', '谢谢，那换一批吧': '', 我最近蛋白质摄入够吗: '', 你是谁: '', 有汤吗: '',
      我就是需要附近商家的呀: '', 你给我点呗: '', 换一批: '', 第二个在几楼: '',
    }
    for (const [question, kind] of Object.entries(kinds)) {
      expect([question, mealAcknowledgementKind(question)]).toEqual([question, kind])
    }
  })

  it('does not swallow a bare agreement that answers a question just asked', () => {
    const asked = answerAsksQuestion('搭配好了，需要换成清淡一点的吗？ ')
    expect(asked).toBe(true)
    expect(isFreeMealAcknowledgement('好的', asked)).toBe(false)
    expect(isFreeMealAcknowledgement('谢谢', asked)).toBe(true)
    expect(isFreeMealAcknowledgement('就这个吧', asked)).toBe(true)
    expect(isFreeMealAcknowledgement('好的', answerAsksQuestion('搭配好了'))).toBe(true)
  })
})

// Mirrors mealRequestsOtherVenue and the venue-release clause of campusDietAgentContextualQuestion.
describe('pet chat venue-change mirror', () => {
  it('treats asking for another venue or any venue as a meal turn', () => {
    for (const question of ['换家店', '换个商家', '推荐其他食堂', '其他食堂呢', '我心情不好，换家店']) {
      expect([question, requestsOtherVenue(question)]).toEqual([question, true])
      expect([question, classifyDietRecommendationIntent(question, true)]).not.toEqual([question, null])
    }
    for (const question of ['附近都可以', '所有食堂都行', '不限定食堂了']) {
      expect([question, releasesVenueLimit(question)]).toEqual([question, true])
      expect([question, classifyDietRecommendationIntent(question, true)]).not.toEqual([question, null])
    }
    for (const question of ['不要推荐其他食堂', '别换商家', '我心情不好']) {
      expect([question, requestsOtherVenue(question)]).toEqual([question, false])
    }
    expect(classifyDietRecommendationIntent('换家店', false)).toBe('initial')
  })
})

describe('the meal conversation looks through a free acknowledgement', () => {
  const recommendation = { recommendations: [{ source: 'public_food_library', source_id: 'food-a', title: '牛肉饭' }] } as never
  const free = 'free_acknowledgement'
  const question = (text: string, billingStatus?: string) => ({ id: `u-${text}`, role: 'user' as const, text, billingStatus })
  const reply = (text: string, billingStatus?: string) => ({ id: `p-${text}`, role: 'pet' as const, kind: 'analysis' as const, text, billingStatus })
  const card = (text: string) => ({ id: `c-${text}`, role: 'pet' as const, kind: 'diet_recommendation' as const, text, recommendation })

  it('keeps the card active after a free thank-you and still treats the next follow-up as a meal turn', () => {
    const messages = [question('推荐点吃的'), card('搭配好了'), question('谢谢', free), reply('不客气～', free), question('好的，就这个吧', free), reply('好的，就这份～', free)]
    const context = activeDietRecommendationContext(messages)
    expect(context.latest).toBe(recommendation)
    expect(context.lastAnswer).toBe('搭配好了')
    expect(classifyDietRecommendationIntent('换一批', Boolean(context.latest))).toBe('more')
  })

  it('follows the server mark, not the wording: a thank-you the server charged ends the meal conversation', () => {
    // A session from before free replies existed: the ordinary chat answered and charged.
    const messages = [question('推荐点吃的'), card('搭配好了'), question('谢谢', 'actual_usage_metered'), reply('不客气，要不要我再帮你看看晚餐？', 'actual_usage_metered')]
    const context = activeDietRecommendationContext(messages)
    expect(context.latest).toBeUndefined()
    expect(answerAsksQuestion(context.lastAnswer)).toBe(true)
  })

  it('ends the meal conversation when other chat comes in between', () => {
    const messages = [question('推荐点吃的'), card('搭配好了'), question('我最近睡得不好'), reply('睡前少吃重口味。'), question('谢谢')]
    expect(activeDietRecommendationContext(messages).latest).toBeUndefined()
  })

  it('ignores turns the server never stored (a failed send and its local error)', () => {
    const messages = [
      question('推荐点吃的'), card('搭配好了'),
      { ...question('第二个在几楼'), unsent: true }, { id: 'err', role: 'pet' as const, kind: 'local' as const, text: '这次没能顺利读完记录' },
    ]
    const context = activeDietRecommendationContext(messages)
    expect(context.latest).toBe(recommendation)
    expect(context.lastAnswer).toBe('搭配好了')
  })

  it('does not treat a bare agreement after a question as an acknowledgement', () => {
    const messages = [question('推荐点吃的'), card('搭配好了，需要换成清淡一点的吗？'), question('好的')]
    const context = activeDietRecommendationContext(messages)
    expect(context.latest).toBeUndefined()
    expect(isFreeMealAcknowledgement('好的', answerAsksQuestion('搭配好了，需要换成清淡一点的吗？'))).toBe(false)
  })

  it('has nothing to look through without a recommendation', () => {
    const messages = [question('你好'), reply('你好呀'), question('谢谢')]
    expect(activeDietRecommendationContext(messages).latest).toBeUndefined()
  })
})

// Mirrors TestCompoundAndShortFollowUpsStayInTheMealConversation (live run 2026-10-18).
describe('compound and short follow-ups mirror', () => {
  it('keeps them in the meal conversation like the server', () => {
    for (const question of ['便宜一点，20元以内', '我一会要去健身，再推荐一下', '有汤吗', '能打包吗', '这个菜辣吗', '有素的吗', '再推荐一下', '清淡一点，不要辣']) {
      expect([question, classifyDietRecommendationIntent(question, true)]).not.toEqual([question, null])
    }
    for (const question of ['我需要多吃蛋白质吗', '我吃肉会胖吗', '我想洗澡，热水还是冷水？', '最近睡得不好怎么办']) {
      expect([question, classifyDietRecommendationIntent(question, true)]).toEqual([question, null])
    }
  })
})

// The server may route wording the page does not know ("这几个都太油了") to the meal Agent; the
// card it answers with keeps the meal conversation going on the page too.
describe('a card from the server always counts', () => {
  it('keeps the card even when the page rules did not recognise the question', () => {
    const recommendation = { recommendations: [{ source: 'public_food_library', source_id: 'food-b', title: '清汤牛肉面' }] } as never
    const messages = [
      { id: 'u1', role: 'user' as const, text: '推荐点吃的' },
      { id: 'c1', role: 'pet' as const, kind: 'diet_recommendation' as const, text: '搭配好了', recommendation: { recommendations: [{ source: 'public_food_library', source_id: 'food-a', title: '红烧肉' }] } as never },
      { id: 'u2', role: 'user' as const, text: '这几个都太油了' },
      { id: 'c2', role: 'pet' as const, kind: 'diet_recommendation' as const, text: '换成清淡的', recommendation },
    ]
    const context = activeDietRecommendationContext(messages)
    expect(context.latest).toBe(recommendation)
    expect(context.lastAnswer).toBe('换成清淡的')
  })
})
