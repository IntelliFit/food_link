// Mirrors backend/internal/health/service/meal_chat_acknowledgement.go and the venue rules of
// meal_venue_scope.go / meal_requirement_updates.go. The server decides how a turn is answered;
// the page only shows what the turn costs and which card the conversation is about, so both
// sides must agree. The backend tests hold the same sentences (tests/unit/pet-meal-routing.test.ts
// repeats them).

// Before matching, both sides keep only Chinese characters, ASCII letters and digits, so emoji,
// full-width spaces and any punctuation are treated identically ("谢谢😊" = "好的　谢谢" style).
const NOT_KEPT = /[^㐀-鿿A-Za-z0-9]+/g

// A whole message made of acknowledgements and greetings only.
const SMALL_TALK = /^你?(?:谢谢|多谢|感谢|好的|好吧|好哒|好嘞|好|嗯|哦|行|收到|明白|懂了|我知道了|知道了|了解|你好|您好|嗨|哈喽|在吗|早安|晚安|再见|拜拜|哈哈|嘿嘿|厉害|不错|真棒|太棒了|赞|辛苦了|辛苦啦)+(?:呀|啊|啦|哈|吧|哦|呢|哒|你)*$/
// "就这个吧" / "那我就选第二个": a choice was made, nothing new is asked.
const DECISION = /^(?:好的|好吧|好|行|嗯嗯|嗯)?(?:那)?(?:我)?(?:就|选|要|吃|点)(?:吃|选|要|点)?(?:这个|这份|这道|这家|那个|那份|那道|它|第[一二三四五六七八九十\d]+(?:个|份|道|家))(?:吧|了|啦|好了|就行|就好|可以)*$/
// "我去吃饭了" / "那我先去吃了": the user is off to eat, nothing is asked.
const GOING_TO_EAT = /^(?:好的|好吧|好|行|嗯嗯|嗯)?(?:那)?我(?:先)?(?:就)?(?:去|要去)?吃(?:饭|了|这个|这份|这道|它)(?:了|吧|啦|咯)?$/

const THANKS = /谢|辛苦/
const FAREWELL = /再见|拜拜|晚安/
const GREETING = /你好|您好|嗨|哈喽|在吗|早安/
const PRAISE = /厉害|不错|真棒|太棒了|赞/

export type MealAcknowledgementKind = 'decision' | 'going' | 'thanks' | 'farewell' | 'greeting' | 'praise' | 'ack'

// The kind of acknowledgement a message is, or '' when it carries anything else. A question
// ("就这个？", "好吗") is never one; only "在吗" is a greeting.
export function mealAcknowledgementKind(question: string): MealAcknowledgementKind | '' {
  const compact = question.replace(NOT_KEPT, '')
  const asks = /[?？]/.test(question) || /[吗么嘛]$/.test(compact)
  if (asks && !compact.endsWith('在吗')) return ''
  if (DECISION.test(compact)) return 'decision'
  if (GOING_TO_EAT.test(compact)) return 'going'
  if (!SMALL_TALK.test(compact)) return ''
  if (THANKS.test(compact)) return 'thanks'
  if (FAREWELL.test(compact)) return 'farewell'
  if (GREETING.test(compact)) return 'greeting'
  if (PRAISE.test(compact)) return 'praise'
  return 'ack'
}

// True when an answer ends on a question; a bare "好的" right after it most likely answers it.
export function answerAsksQuestion(answer: string): boolean {
  return /[?？]$/.test(answer.trim())
}

// True for a message the server answers with a fixed free reply (no model, no credits)
// while the conversation's latest recommendation still has options.
export function isFreeMealAcknowledgement(question: string, lastAnswerAsksQuestion: boolean): boolean {
  const kind = mealAcknowledgementKind(question)
  if (!kind) return false
  return !(kind === 'ack' && lastAnswerAsksQuestion)
}

// "换家店" / "推荐其他食堂": asking for another venue (mealRequestsOtherVenue).
const OTHER_VENUE = /(?:推荐|看看|换(?:个|一个|家|一家|到)?|想去|去|找|给我)(?:一下|给我)?(?:其他|别的|另一个|另一家)(?:的)?(?:食堂|餐厅|地方|商家|店|餐馆)|换(?:个|一个|家|一家)(?:食堂|餐厅|商家|店|餐馆)|换(?:个|一个|家|一家)?(?:商家|餐馆)/g
const OTHER_VENUE_ONLY = /^(?:那|还有)?(?:其他|别的)(?:的)?(?:食堂|餐厅)(?:呢|怎么样|有没有|有什么|吗)?[？?。！!]*$/
const OTHER_VENUE_NEGATED = /(?:不要|别|不用|不想|不需要|不是)(?:再|给我|帮我|让你|叫你|要你|你)?$/

export function requestsOtherVenue(question: string): boolean {
  const q = question.replace(/\s+/g, '')
  if (OTHER_VENUE_ONLY.test(q)) return true
  OTHER_VENUE.lastIndex = 0
  for (let match = OTHER_VENUE.exec(q); match; match = OTHER_VENUE.exec(q)) {
    if (!OTHER_VENUE_NEGATED.test(q.slice(0, match.index))) return true
  }
  return false
}

// "附近都可以" / "所有食堂都行": lifting the venue limit (mealCanteenRelease plus the place word
// campusDietAgentContextualQuestion requires).
const CANTEEN_RELEASE = /不限(?:定)?(?:食堂|地点|餐厅|社区|桃李|紫荆|清芬|清青)|不(?:再)?(?:限制|限定|锁定)(?:在)?(?:食堂|地点|餐厅|社区|范围|桃李|紫荆|清芬|清青)|(?:取消|解除)(?:食堂|地点|就餐地点)(?:限制|限定)?|所有食堂|全校食堂|(?:^|[，。；,;])(?:也|可以)?(?:看看|换到|去|推荐)其他食堂|^不限定(?:了)?[。！!]*$|附近都(?:行|可以)/

export function releasesVenueLimit(question: string): boolean {
  return CANTEEN_RELEASE.test(question) && /食堂|地点|范围|附近|园|社区/.test(question)
}

// Mirrors mealCompoundFollowUp (meal_feedback.go): two requests in one message ("便宜一点，20元以内",
// "我一会要去健身，再推荐一下"), a stated workout timing, or a short question about the dishes on
// screen ("有汤吗", "能打包吗"). Questions about the user's own eating ("我需要多吃蛋白质吗") are not.
const FOLLOW_UP_ADJUST = /(?:便宜|实惠|清淡|少油|低脂|高蛋白|减脂|增肌|辣|不辣|甜|咸|量大|管饱)(?:一点|一些|点|些)|太贵|贵了|再推荐|重新推荐|再来一份|再选|换一个|换一份|换几个/
const FOLLOW_UP_SHORT_ASK = /^(?:有没有|有|能不能|能|可以|可不可以|这个|那个|这份|这道|它|那)[^，。？！,;!?]{0,6}(?:汤|饭|面|菜|粥|主食|素|辣|甜|咸|打包|外带|堂食|饮料|配菜)[^，。？！,;!?]{0,4}(?:吗|么|嘛|呢)[?？]*$/
// campusDietAgentExplicitPriceLimit / campusDietAgentExplicitCalorieLimit
const PRICE_LIMIT = /(?:预算|最多|不超过|控制在)\s*(?:(?:还是|仍是|只有|就只有|就|一共|总共|提高到|增加到|降低到|降到|改为|改成|调整到|是|为|大概|约)\s*)?(?:[¥￥]\s*)?(\d{1,4}(?:\.\d+)?)|(?:[¥￥]\s*)?(\d{1,4}(?:\.\d+)?)\s*(?:元|块)(?:钱)?\s*(?:以内|以下|之内|左右|上下|封顶)|^\s*(?:[¥￥]\s*)?(\d{1,4}(?:\.\d+)?)\s*(?:元|块)(?:钱)?[。！!?？]?\s*$/i
const CALORIE_LIMIT = /(\d{2,4}(?:\.\d+)?)\s*(?:千卡|大卡|卡路里|kcal|卡)\s*(?:以内|以下|之内)?|(\d{3,4}(?:\.\d+)?)\s*(?:以内|以下|之内)/i

function hasLimit(pattern: RegExp, question: string, max: number): boolean {
  const match = question.match(pattern)
  if (!match) return false
  const value = Number(match.slice(1).find((part) => part !== undefined))
  return value > 0 && value <= max
}

// Mirrors mealTrainingTiming (meal_training_context.go): only whether a timing is stated.
const TRAINING_ACTIVITY = '健身|撸铁|练腿|练胸|练背|练肩|练手|练臀|训练|力量|有氧|跑步|慢跑|游泳|打球|篮球|足球|羽毛球|乒乓球|网球|瑜伽|骑行|爬山|HIIT|运动'
const TRAINING_NOISE = /健身房|健身馆|健身中心|运动场|运动馆|运动中心|体育馆|体育场|游泳馆|游泳池|篮球场|足球场|羽毛球馆|训练营|运动鞋|运动服|运动裤|运动饮料|运动员|运动手环|运动会|打完?饭|打完?卡|打完?电话|打完?游戏|游戏|打完?针|旅游|练车|练字|练琴|练习|练歌|练舞|没(?:时间|空)(?:去)?(?:运动|健身|训练|锻炼|练)/g
const TRAINING_LATER = /(?:明早|明天|明晚|明日|后天|下周|周末|周[一二三四五六日]|星期[一二三四五六日天]|礼拜[一二三四五六日天])[^，。；！？,;!?]{0,8}/g
const TRAINING_CLEAR = /不(?:去)?(?:健身|训练|运动|练)了|今天不练|不练了|取消(?:训练|健身)/
const TRAINING_PAST = /昨天|昨晚|昨日|前天|上周|上个月/
const TRAINING_STATED = [
  new RegExp(`(?:刚|刚刚|才|已经)[^，。；！？,;!?]{0,4}(?:${TRAINING_ACTIVITY}|练|跑|游|打)[^，。；！？,;!?]{0,3}完|(?:${TRAINING_ACTIVITY}|练|跑|游)完了?|健完身|(?:打|踢)完(?:篮球|足球|羽毛球|乒乓球|网球|排球|球)|(?:${TRAINING_ACTIVITY}|锻炼|练)后`),
  new RegExp(`(?:一会儿?|等会儿?|待会儿?|等下|等一下|马上|稍后|(?:半|一|两|1|2)个?小时后)[^，。；！？,;!?]{0,6}?(?:要|去|准备|打算|想去|得去|会)?[^，。；！？,;!?]{0,4}?(?:${TRAINING_ACTIVITY}|练)`),
  new RegExp(`(?:下午|晚上|今晚|中午)[^，。；！？,;!?]{0,6}?(?:要|去|准备|打算|想去|得去)[^，。；！？,;!?]{0,4}?(?:${TRAINING_ACTIVITY}|练)`),
  new RegExp(`(?:${TRAINING_ACTIVITY})前`),
  new RegExp(`(?:准备|打算|马上要|就要|正要|要去|得去|想去)[^，。；！？,;!?]{0,2}(?:${TRAINING_ACTIVITY}|练)`),
]

export function statesTrainingTiming(question: string): boolean {
  const q = question.replace(TRAINING_NOISE, '').replace(TRAINING_LATER, '')
  if (TRAINING_CLEAR.test(q) || TRAINING_PAST.test(q)) return false
  return TRAINING_STATED.some((pattern) => pattern.test(q))
}

export function isCompoundMealFollowUp(question: string): boolean {
  const q = question.replace(/\s+/g, '')
  return hasLimit(PRICE_LIMIT, q, 1000) || hasLimit(CALORIE_LIMIT, q, 3000) || FOLLOW_UP_ADJUST.test(q) || FOLLOW_UP_SHORT_ASK.test(q) || statesTrainingTiming(q)
}
