import { View, Text, Image } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAnalyzeTask,
  sanitizeUserFacingErrorMessage,
  showUnifiedApiError,
  type AnalysisTask,
  type AnalyzeResponse,
  type ExecutionMode,
  type ExerciseTaskResultPayload
} from '../../../utils/api'
import { IconExercise } from '../../../components/iconfont'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import { needsPrecisionUserAction } from '../../../utils/precision-mode'
import { normalizeAnalysisEngine } from '../../../utils/analysis-engine'
import './index.scss'

/** 与记运动页一致，用于完成后清除「待同步」状态 */
const EXERCISE_PENDING_TASK_KEY = 'exercise_pending_task_id'
const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'

// 健康小知识
const HEALTH_TIPS = [
  '吃饭顺序有讲究：先吃蔬菜，再吃蛋白质，最后吃碳水，可以有效平稳血糖。',
  '每一口食物咀嚼 20-30 次，不仅助消化，还能提升饱腹感，减少过量进食。',
  '餐前 30 分钟喝一杯水，可以激活新陈代谢，并自然减少正餐摄入量。',
  '早餐摄入约 30 克蛋白质（如鸡蛋、牛奶），可以防止午餐前的饥饿感和对甜食的渴望。',
  '深色蔬菜（如菠菜、紫甘蓝）通常比浅色蔬菜含有更多的抗氧化剂和微量元素。',
  '尽量在睡前 3 小时停止进食，让肠胃有充分的时间休息和修复。',
  '运动后 30 分钟内补充蛋白质+碳水，有助于肌肉恢复与合成。',
  '少食多餐有助于稳定血糖，避免暴饮暴食。',
  '减脂期的重点是"制造热量缺口"，而非盲目节食，保证基础代谢很重要。',
  '全谷物（如燕麦、糙米）含有更多膳食纤维，能提供更持久的能量和饱腹感。',
  '规律的阻力训练不仅能增加肌肉量，还能提高静息代谢率，让你"躺着也消耗热量"。',
  '睡眠不足会导致体内皮质醇水平升高，增加食欲并更容易囤积脂肪。',
  '选择健康的油脂（如橄榄油、牛油果、坚果），对心血管健康和吸收脂溶性维生素至关重要。',
  '喝黑咖啡能在一定程度上提高代谢，并在运动前提供额外的充沛精力。',
  '想要更出色的腹肌，光靠卷腹不够，还需要配合减脂和全身核心训练。',
  '水果虽好，但含有果糖，减脂期建议适量食用，并选择低升糖指数的水果如苹果、草莓。',
  '快走和慢跑都是极佳的低强度有氧运动，有助于改善心肺功能和加速脂肪燃烧。',
  '力量训练后的拉伸可以缓解肌肉酸痛，增加柔韧性，同时预防运动损伤。',
  '适量补充钙质及相关维生素，对骨骼健康和免疫系统有益，尤其在缺乏日照的冬季。',
  '晚餐尽量清淡易消化，减少高盐高油食物的摄入，以免影响睡眠质量。',
  '久坐一族每隔一小时最好起身活动 3-5 分钟，有助于改善血液循环。',
  '用白开水或淡茶代替含糖饮料，是减少每日无形热量摄入的最简单方法。',
  '保持良好的体态（如不驼背）能让呼吸更顺畅，也有助于调动核心肌群。',
  '偶尔吃一顿「放纵餐」可以帮助缓解心理压力，并可能利于打破减脂平台期。',
  '慢速进食不仅帮助大脑更好接收"吃饱了"的信号，还能让你更享受食物的美味。',
  '"少油少盐"不代表"无油无盐"，适量摄入盐分（钠）对维持身体水分平衡很重要。',
  '无氧运动和有氧运动结合，往往能达到最佳的减脂塑型效果。',
  '每周安排一两天的休息日，让身体有时间从运动疲劳中恢复。',
  '"局部减脂"是一个伪命题，脂肪的减少通常是全身性的。',
  '吃富含欧米伽三不饱和脂肪酸的食物（如三文鱼、亚麻籽），有助于抗炎和改善认知功能。',
  '压力过大容易引发情绪性进食，学会用运动或冥想来释放压力。',
  '重视每一顿饭的搭配：碳水提供能量，蛋白质修补身体，脂肪合成激素，缺一不可。',
  '运动时选择透气吸汗的装备，可以提升运动表现和带来更好的体验。',
  '对于初学者，掌握正确的动作发力比追求更大的重量重要得多。',
  '碳酸饮料即使是无糖的（代糖），也可能增加对甜食的渴望，建议适度饮用。',
  '更换小号的餐盘，可以在视觉上让你觉得吃得很多，帮助自然减少食量。',
  '酸奶是良好的益生菌来源，但购买时需警惕配料表中隐藏的添加糖。',
  '记录饮食习惯（如拍照或记笔记）能让你更直观地认识到自己的摄入情况，提高自控力。',
  '运动不仅改变身材，更分泌被称为"快乐荷尔蒙"的内啡肽，提升整体幸福感。',
  '冬季运动热身需要花更多时间，让关节和肌肉充分准备好以防拉伤。',
  '日常爬楼梯代替坐电梯，是增加日常非运动活动消耗的好方法。',
  '吃火锅时，先涮蔬菜和海鲜，最后吃肉类，可以减少整体油脂的摄入。',
  '正确的深蹲姿势应保持背部挺直，发力由臀部和腿部主导，避免膝盖受压过大。',
  '对于久盯屏幕的人，多做颈部和肩部的拉伸放松可以极大缓解疲劳。',
  '绿茶中含有的儿茶素能适度促进脂肪氧化，是减脂期优秀的饮品选择。',
  '饮食不能走极端，极低碳水或极低脂肪的饮食法都不利于长期的健康维持。',
  '饿的时候不要去逛超市，这会让你更容易买下高热量的零食。',
  '保持居家环境的光线充足和通风，有助于改善心情，让你更有动力去运动。',
  '测量腰围和体脂率比单看体重秤上的数字，更能真实反映你的减脂效果。',
  '最好的健身计划就是那份你能长期坚持下去的计划。'
]

const SHOWN_TIPS_KEY = 'analyze_shown_health_tips'

type WaitingInteractionCard =
  | {
      type: 'quiz'
      eyebrow: string
      title: string
      options: [string, string]
      answerIndex: 0 | 1
      reveal: string
    }
  | {
      type: 'fact'
      eyebrow: string
      title: string
      reveal: string
      actionText: string
    }

const WAITING_INTERACTION_CARDS: WaitingInteractionCard[] = [
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '包装袋写 418 kJ，大约是多少 kcal？',
    options: ['约 100 kcal', '约 418 kcal'],
    answerIndex: 0,
    reveal: '约 100 kcal。换算关系是 1 kcal = 4.184 kJ，所以 kJ 数字除以 4.184 就是 kcal。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样 100g，哪个通常热量更高？',
    options: ['米饭', '油条'],
    answerIndex: 1,
    reveal: '油条更高。油炸会让食物吸入不少油脂，热量密度会明显上去。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃盖饭时，哪个小动作更利于控热量？',
    options: ['酱汁少浇一点', '先把饭拌匀'],
    answerIndex: 0,
    reveal: '少浇酱汁更稳。盖饭里的油、糖、盐常藏在酱汁里，先少放一半更容易控量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样一碗面，哪个选择通常更轻？',
    options: ['汤面少喝汤', '拌面多加酱'],
    answerIndex: 0,
    reveal: '汤面少喝汤通常更友好。拌面酱料油脂密度高，容易让热量悄悄上去。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃火锅时，哪个顺序更不容易吃超？',
    options: ['先蔬菜蛋白', '先主食丸子'],
    answerIndex: 0,
    reveal: '先蔬菜和蛋白质更稳。先垫一点饱腹感，后面主食、丸子和蘸料更容易自然少吃。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '奶茶想减负，优先改哪一项？',
    options: ['少糖少奶盖', '只换大杯'],
    answerIndex: 0,
    reveal: '少糖、少奶盖更有效。杯型变大通常只会让总摄入更多。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '减脂期吃肉，哪个做法通常更友好？',
    options: ['去皮少油', '裹粉油炸'],
    answerIndex: 0,
    reveal: '去皮少油更友好。蛋白质本身很好，额外裹粉和油炸会明显抬高热量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '米饭吃不完时，哪个处理更适合控量？',
    options: ['先分出半碗', '边吃边续饭'],
    answerIndex: 0,
    reveal: '先分出半碗更好。提前定量比吃到一半再判断更不容易超。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '早餐想更抗饿，优先补什么？',
    options: ['蛋白质', '纯甜饮'],
    answerIndex: 0,
    reveal: '蛋白质更抗饿。鸡蛋、牛奶、豆浆、瘦肉这类能让上午更稳定。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '沙拉热量容易高在哪里？',
    options: ['酱和坚果', '生菜本身'],
    answerIndex: 0,
    reveal: '主要常在酱和坚果。生菜热量低，但沙拉酱、培根碎、坚果一多就会变重。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '外卖备注哪个更实用？',
    options: ['少油少酱', '多放汤汁'],
    answerIndex: 0,
    reveal: '少油少酱更实用。很多外卖热量差异不在主菜，而在油和酱汁。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '晚餐很晚才吃，哪个选择更稳？',
    options: ['清淡少油', '重油重辣'],
    answerIndex: 0,
    reveal: '清淡少油更稳。太晚吃得重，容易影响睡眠和第二天食欲节奏。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃自助餐先拿什么更不容易失控？',
    options: ['蔬菜蛋白', '甜点炸物'],
    answerIndex: 0,
    reveal: '先拿蔬菜和蛋白质更好。先稳定饱腹感，再决定要不要吃高热量选择。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样是鸡蛋，哪个通常更轻？',
    options: ['水煮蛋', '煎蛋多油'],
    answerIndex: 0,
    reveal: '水煮蛋通常更轻。煎蛋吸油后热量会明显增加。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想减少隐形热量，先盯哪类？',
    options: ['饮料酱料', '绿叶菜'],
    answerIndex: 0,
    reveal: '饮料和酱料更值得先盯。它们不占胃，但很容易贡献不少热量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '运动后太饿，哪个组合更稳？',
    options: ['蛋白加主食', '只喝甜饮'],
    answerIndex: 0,
    reveal: '蛋白加主食更稳。这样更利于恢复，也不容易很快再次饿。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃烤肉时，哪个搭配更平衡？',
    options: ['肉配生菜', '肉配甜饮'],
    answerIndex: 0,
    reveal: '肉配生菜更平衡。生菜能增加体积和纤维，也能让油腻感下降。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '下午想吃零食，哪个更抗饿？',
    options: ['酸奶鸡蛋', '含糖饼干'],
    answerIndex: 0,
    reveal: '酸奶、鸡蛋这类更抗饿。只吃甜饼干容易血糖起伏，过会儿又想吃。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '主食不是不能吃，关键看什么？',
    options: ['总量和搭配', '完全不碰'],
    answerIndex: 0,
    reveal: '看总量和搭配。主食提供能量，和蛋白、蔬菜搭好，比完全不吃更可持续。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '炒菜出锅前，哪个习惯更友好？',
    options: ['少淋明油', '再加一勺油'],
    answerIndex: 0,
    reveal: '少淋明油更友好。最后那一圈油看着不多，热量密度却很高。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃粉面时，哪个加料更稳？',
    options: ['加蛋加青菜', '加油条炸串'],
    answerIndex: 0,
    reveal: '加蛋和青菜更稳。能补蛋白和纤维，比炸物加料更利于控制总热量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '一餐吃太咸，下一步更建议？',
    options: ['补水清淡', '继续重口'],
    answerIndex: 0,
    reveal: '补水并让下一餐清淡些更好。短期体重上浮可能只是水分变化。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想看一餐是否均衡，先看哪三样？',
    options: ['碳蛋脂', '只看辣度'],
    answerIndex: 0,
    reveal: '先看碳水、蛋白质、脂肪。它们决定这餐的大方向。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃粥时容易饿，通常缺什么？',
    options: ['蛋白质', '更多糖'],
    answerIndex: 0,
    reveal: '常见是蛋白质不够。粥配鸡蛋、豆制品或瘦肉，会比单喝粥更顶饿。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想降低餐后困，哪个更可能有帮助？',
    options: ['主食少一点', '甜饮加满'],
    answerIndex: 0,
    reveal: '主食适当少一点、搭配蛋白蔬菜，通常更不容易餐后发困。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '称体重更建议看什么？',
    options: ['多日趋势', '单天波动'],
    answerIndex: 0,
    reveal: '多日趋势更可靠。盐分、饮水、作息都会让单天体重上下波动。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样想吃甜，哪个更容易控量？',
    options: ['小份慢吃', '边看剧边吃'],
    answerIndex: 0,
    reveal: '小份慢吃更容易控量。边看剧边吃很容易忽略已经吃了多少。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '点轻食时，哪个细节要注意？',
    options: ['酱汁分装', '酱全拌入'],
    answerIndex: 0,
    reveal: '酱汁分装更好。先加一半，不够再补，通常就能少吃不少隐藏热量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '聚餐前很饿，哪个策略更稳？',
    options: ['先垫点蛋白', '空腹硬扛'],
    answerIndex: 0,
    reveal: '先垫点蛋白更稳。空腹到聚餐现场，往往更容易吃得太快太多。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '一餐蛋白质不足，哪个补法更方便？',
    options: ['加蛋或豆腐', '多加白饭'],
    answerIndex: 0,
    reveal: '加蛋、豆腐、鸡胸、鱼虾都方便。多加白饭主要补碳水，不补蛋白。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '减脂时最不建议长期做什么？',
    options: ['极端节食', '稳定记录'],
    answerIndex: 0,
    reveal: '极端节食最不可持续。稳定记录和小幅调整，往往比猛一下更有效。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想少吃油，哪个烹饪方式更友好？',
    options: ['蒸煮炖烤', '反复油炸'],
    answerIndex: 0,
    reveal: '蒸、煮、炖、烤通常更友好。油炸会大幅提高热量密度。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '记录饮食时，哪项最容易被漏掉？',
    options: ['蘸料饮料', '主菜名称'],
    answerIndex: 0,
    reveal: '蘸料和饮料很容易被漏掉。它们看似边角料，却常影响总热量判断。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让晚餐轻一点，优先减少什么？',
    options: ['油炸和甜饮', '绿叶蔬菜'],
    answerIndex: 0,
    reveal: '优先减少油炸和甜饮。绿叶蔬菜通常可以保留，甚至能提高饱腹感。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃包子馒头时，哪个搭配更稳？',
    options: ['配蛋和豆浆', '只配甜饮'],
    answerIndex: 0,
    reveal: '配蛋和豆浆更稳。纯主食加甜饮容易饿得快。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想减少夜宵影响，哪个做法更好？',
    options: ['提前吃够晚餐', '深夜硬加餐'],
    answerIndex: 0,
    reveal: '晚餐吃够蛋白和蔬菜更好。夜里饿到失控，常是白天或晚餐没吃稳。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样是坚果，关键要注意什么？',
    options: ['小把定量', '整袋随手吃'],
    answerIndex: 0,
    reveal: '坚果健康但热量密度高，小把定量更合适。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃寿司时，哪个组合更均衡？',
    options: ['鱼虾加蔬菜', '只点甜酱卷'],
    answerIndex: 0,
    reveal: '鱼虾加蔬菜更均衡。甜酱、蛋黄酱和炸物卷会让热量更高。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '饭后想活动，哪个更合适？',
    options: ['散步十分钟', '立刻剧烈跑'],
    answerIndex: 0,
    reveal: '饭后轻松散步更合适。刚吃完就剧烈运动，胃肠会很不舒服。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '午餐容易吃撑，先调整什么？',
    options: ['进食速度', '直接不吃'],
    answerIndex: 0,
    reveal: '先放慢速度更现实。大脑接收到饱腹信号需要时间。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃麻辣烫时，哪个选择更稳？',
    options: ['清汤少酱', '重油麻酱'],
    answerIndex: 0,
    reveal: '清汤少酱更稳。麻酱和红油都很好吃，但热量密度也高。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让饭后血糖更平稳，哪种顺序更友好？',
    options: ['先菜肉后主食', '先主食后菜肉'],
    answerIndex: 0,
    reveal: '先菜肉后主食通常更友好。蔬菜纤维和蛋白质能帮主食吸收节奏慢一点。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '减脂期更应该盯住哪个长期指标？',
    options: ['单餐完美', '周平均趋势'],
    answerIndex: 1,
    reveal: '周平均趋势更重要。偶尔一餐波动正常，长期能量平衡才决定方向。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '减脂餐里最该保留的饱腹来源是？',
    options: ['蛋白和纤维', '只剩清汤'],
    answerIndex: 0,
    reveal: '蛋白和纤维要保留。吃得太空，后面更容易报复性进食。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想估算一餐是否偏油，看哪里最直观？',
    options: ['盘底油光', '餐具颜色'],
    answerIndex: 0,
    reveal: '盘底油光很有参考。汤汁、盘底和酱料能透露不少油脂信息。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '控制热量时，哪个心态更可持续？',
    options: ['每餐微调', '一错全放弃'],
    answerIndex: 0,
    reveal: '每餐微调更可持续。一餐吃多了，下一餐回到正常节奏就好。'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '这次结果出来后，优先看什么？',
    reveal: '先看总热量是否离目标太远，再看蛋白质够不够。三大营养素比单个数字更有参考价值。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '饮料和酱料常是隐藏热量',
    reveal: '奶茶、果汁、沙拉酱、拌面酱这类东西体积不大，但很容易把一餐热量往上推。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '看到“健康”两个字也要看配料',
    reveal: '全麦、低脂、无糖都只是线索，最终还是要看配料和总量。健康标签不等于可以无限吃。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '拍照结果最该核对的是份量',
    reveal: '菜名识别对了还不够，份量才决定热量。结果出来后，先看看克重是否符合你眼前这份。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '菜汤拌饭会放大摄入',
    reveal: '菜汤里往往有油和盐，拌进饭里很香，但也会让主食不知不觉吃更多。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '“只吃菜”也可能热量高',
    reveal: '干锅、红烧、油焖这类做法，即使主角是蔬菜，也可能因为油多而热量不低。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '蛋白质不只看肉',
    reveal: '鸡蛋、牛奶、豆腐、鱼虾、瘦肉都能补蛋白。换着吃，比长期只靠一种更容易坚持。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '外食不用追求完美',
    reveal: '外食先做到少油少酱、主食定量、加一份蛋白或蔬菜，就已经能明显改善一餐结构。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '汤不一定等于低热量',
    reveal: '清汤通常没问题，但浓汤、奶油汤、肉汤和火锅汤底可能含有不少油脂。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '一餐里有“撑场面”的食物',
    reveal: '蔬菜、菌菇、海带这类体积大、能量密度低，能帮一餐更有满足感。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '别让周末抵消工作日',
    reveal: '很多人的热量差不是每天都大，而是周末两三餐拉开了差距。记录能帮你看见趋势。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '水果也有份量概念',
    reveal: '水果很好，但果汁、果盘和超大份水果会让糖分和热量上升。完整水果、小份吃更稳。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '吃得慢不是玄学',
    reveal: '放慢速度能给饱腹信号留时间。你可能不是意志力差，只是吃得太快了。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '高蛋白不等于随便吃',
    reveal: '蛋白质有帮助，但烹饪油、蘸料和份量仍然重要。烤鸡翅和水煮虾不是一个热量逻辑。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '“无糖”不代表无热量',
    reveal: '无糖饮料热量通常低，但无糖点心、无糖酸奶仍可能有脂肪、淀粉或总热量。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '复盘别只看超没超标',
    reveal: '还要看为什么超：主食多了、油多了、饮料多了，还是蛋白不够导致后面加餐。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '加餐可以提前设计',
    reveal: '如果下午总饿，可以准备酸奶、鸡蛋、豆制品或水果，别等饿急了再随机买。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '“半份主食”很实用',
    reveal: '外食时不一定要不吃主食，先吃半份，饭后状态更可控，也更容易坚持。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '记录不是为了审判自己',
    reveal: '记录是为了看清模式。知道哪类餐最容易超，下一次就能改一个小动作。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '睡眠会影响食欲',
    reveal: '睡少了，第二天更想吃高糖高油并不奇怪。饮食管理也需要把睡眠算进去。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '别忽略“尝几口”',
    reveal: '做饭试味、同事零食、孩子剩饭这些小口小口，累积起来也会影响一天总量。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '一餐里先找蛋白质',
    reveal: '结果出来后可以先问自己：这餐有没有稳定蛋白？没有的话，下餐补回来就行。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '粗粮也要看总量',
    reveal: '糙米、玉米、红薯比精制主食更有纤维，但它们仍然是主食，份量同样重要。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '低卡酱料也别倒太多',
    reveal: '单次热量低不代表无限量。能分装、能蘸着吃，就比全拌进去更容易控。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '别被“体积小”骗了',
    reveal: '坚果、巧克力、糕点、酱料体积都不大，但能量密度很高，最适合提前定量。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '今天吃多了不需要惩罚',
    reveal: '下一餐回到正常结构就好。过度补偿容易让饮食节奏更乱。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '“看起来清淡”也要看做法',
    reveal: '白色、浅色不一定低热量。比如奶油、椰浆、浓汤都可能看着清淡但脂肪不低。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '把目标拆成一餐动作',
    reveal: '比起“我要吃健康”，更好执行的是“今天午餐少半份饭，加一个蛋白”。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '餐后散步很划算',
    reveal: '不用很久，饭后轻松走一走，对血糖节奏和消化感受都更友好。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '拍照时把餐具也拍进去',
    reveal: '碗、盘、勺子能提供比例参照，份量判断会更稳。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '同一餐多图会更好判断',
    reveal: '如果菜被遮挡或容器很深，多角度能帮助识别食物和估算份量。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '蛋白质分散到每餐更舒服',
    reveal: '不用把蛋白都堆到晚餐。早餐和午餐各补一点，全天饱腹感会更稳定。',
    actionText: '再看一条'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃炒饭时，哪个做法更利于控量？',
    options: ['先装小碗', '整盘随便吃'],
    answerIndex: 0,
    reveal: '先装小碗更稳。炒饭油和主食都集中，提前定量比边吃边判断靠谱。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '点汉堡时，哪个组合通常更轻？',
    options: ['汉堡配无糖茶', '汉堡配薯条可乐'],
    answerIndex: 0,
    reveal: '汉堡配无糖茶通常更轻。薯条和含糖饮料会把套餐热量拉高不少。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃饺子时，哪个细节更值得注意？',
    options: ['蘸料少油', '红油倒满'],
    answerIndex: 0,
    reveal: '蘸料少油更稳。饺子本身有主食和馅料，红油蘸料很容易额外加热量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让早餐更均衡，哪个搭配更好？',
    options: ['包子加鸡蛋', '面包加奶茶'],
    answerIndex: 0,
    reveal: '包子加鸡蛋更均衡。主食配蛋白质，比主食配甜饮更抗饿。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃烧烤时，哪个选择更友好？',
    options: ['瘦肉蔬菜', '肥肉甜饮'],
    answerIndex: 0,
    reveal: '瘦肉和蔬菜更友好。烧烤的油、糖、酱料已经不少，甜饮会继续加码。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '一餐主食偏多，下一餐更建议？',
    options: ['正常吃清淡些', '完全不吃'],
    answerIndex: 0,
    reveal: '正常吃、清淡些更稳。完全不吃容易让后面更饿，节奏反而乱。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '喝咖啡想少摄入，优先选哪个？',
    options: ['美式拿铁少糖', '加糖奶盖咖啡'],
    answerIndex: 0,
    reveal: '美式或少糖拿铁更稳。奶盖、糖浆和奶油才是咖啡里的热量大头。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃拌饭时，哪个动作更聪明？',
    options: ['酱料分次加', '一次全倒入'],
    answerIndex: 0,
    reveal: '分次加更聪明。先加一半，通常味道已经够了，还能少吃很多酱。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想提高饱腹感，哪个更有帮助？',
    options: ['加蔬菜菌菇', '只喝甜饮'],
    answerIndex: 0,
    reveal: '蔬菜和菌菇更有帮助。它们增加体积和纤维，让一餐更扎实。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃炸鸡时，哪个小动作能减负？',
    options: ['少吃皮和酱', '蘸酱加倍'],
    answerIndex: 0,
    reveal: '少吃皮和酱会轻一些。炸皮和甜辣酱都是热量密度很高的部分。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '点麻辣香锅时，哪个备注更实用？',
    options: ['少油少盐', '多油多辣'],
    answerIndex: 0,
    reveal: '少油少盐更实用。香锅好吃的关键常是油和调料，备注能帮你留点余地。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想控制晚餐热量，先看哪一项？',
    options: ['油炸甜饮', '清炒蔬菜'],
    answerIndex: 0,
    reveal: '先看油炸和甜饮。它们最容易在晚餐里把热量悄悄推高。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃三明治时，哪个更可能偏高热量？',
    options: ['多酱培根款', '鸡蛋蔬菜款'],
    answerIndex: 0,
    reveal: '多酱培根款更容易偏高。三明治差异常在酱、培根、芝士和份量。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '一天总觉得饿，先检查什么？',
    options: ['蛋白是否够', '是不是太自律'],
    answerIndex: 0,
    reveal: '先看蛋白和纤维够不够。吃得太“空”，饥饿感会追着你跑。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃面包时，哪个搭配更稳？',
    options: ['配牛奶鸡蛋', '配含糖饮料'],
    answerIndex: 0,
    reveal: '配牛奶或鸡蛋更稳。纯面包加甜饮，通常饱得快也饿得快。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '点酸菜鱼时，哪个习惯更友好？',
    options: ['少喝汤汁', '汤汁拌饭'],
    answerIndex: 0,
    reveal: '少喝汤汁更友好。鱼肉是好蛋白，但汤里的油盐也很容易一起吃进去。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '水果什么时候吃更好控量？',
    options: ['提前分一份', '边刷手机边吃'],
    answerIndex: 0,
    reveal: '提前分一份更好控量。边刷手机边吃，很容易从一小份变成一大盘。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让午餐下午不犯困，哪个更值得试？',
    options: ['少油主食适量', '重油大份主食'],
    answerIndex: 0,
    reveal: '少油、主食适量更值得试。午餐太重，下午犯困往往更明显。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '饭局上想少喝酒，哪个方式更自然？',
    options: ['慢喝多补水', '空腹快喝'],
    answerIndex: 0,
    reveal: '慢喝、多补水更自然。酒精本身有热量，也会降低控食的判断力。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃早餐油条豆浆，怎么更平衡？',
    options: ['加个鸡蛋', '再来甜豆浆'],
    answerIndex: 0,
    reveal: '加个鸡蛋会更平衡。油条主要是油和碳水，补点蛋白更抗饿。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想减少外卖热量波动，哪个习惯有效？',
    options: ['固定几家店', '每天盲点'],
    answerIndex: 0,
    reveal: '固定几家靠谱店更有效。熟悉份量和口味后，记录和调整都更容易。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃豆制品时，哪个通常更轻？',
    options: ['清炖豆腐', '油炸豆泡'],
    answerIndex: 0,
    reveal: '清炖豆腐通常更轻。豆泡吸油能力强，热量密度会明显上去。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让一餐更像“正餐”，至少要有？',
    options: ['主食蛋白蔬菜', '只有零食'],
    answerIndex: 0,
    reveal: '主食、蛋白、蔬菜至少要尽量齐。只有零食很容易热量不低但不满足。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '吃汤粉时，哪个细节更影响热量？',
    options: ['油辣子和汤', '葱花香菜'],
    answerIndex: 0,
    reveal: '油辣子和汤更影响热量。葱花香菜主要是风味，热量通常很低。'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '同样热量，饱腹感可以差很多',
    reveal: '含蛋白、纤维和水分多的食物，通常比同热量的甜点饮料更顶饿。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '周末聚餐前别饿太久',
    reveal: '饿太久再去聚餐，往往会吃得更快更多。提前垫一点蛋白会更稳。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '识别结果不是考试卷',
    reveal: '如果份量或菜名不对，直接纠正它。越多真实反馈，后续记录越贴近你。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '别把“清淡”理解成没味道',
    reveal: '少油少糖不等于难吃。醋、蒜、香草、辣椒、胡椒都能增加风味。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '坚果适合当配角',
    reveal: '坚果营养不错，但更适合小把点缀。把它当主零食，很容易超量。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '先改最容易的一件事',
    reveal: '饮食调整不用一次全改。先从少一杯甜饮、少半份饭或多一个蛋开始。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '外卖照片也能帮复盘',
    reveal: '每次拍照记录，会慢慢看出哪类外卖最容易超标，下一次就更好选。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '别把运动当作无限额度',
    reveal: '运动很重要，但一杯高糖饮或一份炸物，可能很快抵消不少消耗。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '看趋势比看单次更温柔',
    reveal: '一餐吃多不代表失败。连续几天的平均趋势，才更接近真实状态。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '拍深碗食物时加个侧面',
    reveal: '粉、面、粥、盖饭这类深碗食物，侧面或俯拍结合更有利于判断份量。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '“低脂”也可能高糖',
    reveal: '低脂酸奶和低脂零食常用糖来补口感，买的时候最好顺手看下配料表。',
    actionText: '再看一条'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '身体反馈也是数据',
    reveal: '饭后困、很快饿、口渴、睡不好，都能反过来提示这餐结构可能要调整。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '小提醒',
    title: '先满足，再优化',
    reveal: '一餐吃得满足，才更容易长期坚持。健康饮食不是把快乐全部删掉。',
    actionText: '再看一条'
  }
]

const SHOWN_INTERACTION_CARDS_KEY = 'analyze_shown_interaction_cards'

const getNextInteractionIndex = (current?: number) => {
  try {
    let shown: number[] = Taro.getStorageSync(SHOWN_INTERACTION_CARDS_KEY) || []
    if (shown.length >= WAITING_INTERACTION_CARDS.length) {
      shown = current !== undefined ? [current] : []
    }
    let available = WAITING_INTERACTION_CARDS.map((_, i) => i).filter(i => !shown.includes(i))
    if (current !== undefined && available.length > 1) {
      available = available.filter(i => i !== current)
    }
    if (available.length === 0) {
      available = WAITING_INTERACTION_CARDS.map((_, i) => i).filter(i => i !== current)
    }
    if (available.length === 0) available = WAITING_INTERACTION_CARDS.map((_, i) => i)

    const nextIdx = available[Math.floor(Math.random() * available.length)]
    Taro.setStorageSync(SHOWN_INTERACTION_CARDS_KEY, [...shown, nextIdx])
    return nextIdx
  } catch (e) {
    if (WAITING_INTERACTION_CARDS.length <= 1) return 0
    let nextIdx = Math.floor(Math.random() * WAITING_INTERACTION_CARDS.length)
    if (current !== undefined) {
      while (nextIdx === current) {
        nextIdx = Math.floor(Math.random() * WAITING_INTERACTION_CARDS.length)
      }
    }
    return nextIdx
  }
}

const getNextTipIndex = (current?: number) => {
  try {
    let shown: number[] = Taro.getStorageSync(SHOWN_TIPS_KEY) || []
    if (shown.length >= HEALTH_TIPS.length) {
      shown = current !== undefined ? [current] : []
    }
    let available = HEALTH_TIPS.map((_, i) => i).filter(i => !shown.includes(i))
    if (available.length === 0) available = HEALTH_TIPS.map((_, i) => i)

    const nextIdx = available[Math.floor(Math.random() * available.length)]
    shown.push(nextIdx)
    Taro.setStorageSync(SHOWN_TIPS_KEY, shown)
    return nextIdx
  } catch (e) {
    return Math.floor(Math.random() * HEALTH_TIPS.length)
  }
}

const POLL_INTERVAL = 2000
const POLL_RETRY_MAX_INTERVAL = 16000
const TIP_ROTATE_INTERVAL = 6000

const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; desc: string }> = {
  lite: {
    title: '普通模式',
    desc: '快速识别食物与份量。'
  },
  experimental: {
    title: '普通模式',
    desc: '快速识别食物与份量。'
  },
  standard_web_search: {
    title: '普通联网',
    desc: '结合低成本搜索证据校准包装规格与份量。'
  },
  fast: {
    title: '快速模式',
    desc: '使用 Qwen Flash 快速识别食物与份量。'
  },
  fast_web_search: {
    title: '快速联网',
    desc: '使用 Qwen Flash 原生联网搜索校准规格与份量。'
  },
  standard_packaged_experiment: {
    title: '零食库试验',
    desc: '用本地零食库规格校准包装食品重量。'
  },
  gemini35_flash: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物与份量。'
  },
  gemini35_flash_grouped: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物与份量。'
  },
  strict: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物与份量。'
  },
  strict_separate: {
    title: '精准分项',
    desc: '拆开混合食物，分别估计各成分份量。'
  },
  strict_web_search: {
    title: '精准联网',
    desc: '精准识别后结合搜索证据校准规格与重量。'
  },
  standard: {
    title: '普通模式',
    desc: '快速识别食物与份量。'
  }
}

const normalizeExecutionMode = (value: unknown): ExecutionMode => {
  if (value === 'fast') return 'fast'
  if (value === 'fast_web_search') return 'fast_web_search'
  if (value === 'standard_web_search') return 'standard_web_search'
  if (value === 'standard_packaged_experiment') return 'standard_packaged_experiment'
  if (value === 'strict_separate') return 'strict_separate'
  if (value === 'strict_web_search') return 'strict_web_search'
  if (value === 'strict' || value === 'gemini35_flash' || value === 'gemini35_flash_grouped') return 'strict'
  return 'standard'
}

const normalizeTaskType = (value: unknown): 'food' | 'food_text' | 'exercise' => {
  if (value === 'food_text') return 'food_text'
  if (value === 'exercise') return 'exercise'
  return 'food'
}

const normalizeAnalyzeTaskErrorMessage = (value: unknown): string => {
  const raw = String(value || '').trim()
  if (!raw) return '识别失败，请稍后重试'
  const sanitized = sanitizeUserFacingErrorMessage(raw, '识别失败，请稍后重试')
  if (sanitized !== raw) return sanitized
  const lower = raw.toLowerCase()
  if (
    lower.includes('<html') ||
    lower.includes('<!doctype html') ||
    lower.includes('<head') ||
    lower.includes('<body')
  ) {
    return 'AI 服务返回异常网页，请检查模型 API 配置后重试'
  }
  if (
    lower.includes('toolnotopen') ||
    lower.includes('not activated web search') ||
    lower.includes('activate web search') ||
    lower.includes('web search tool not activated')
  ) {
    return 'AI 识别服务联网搜索配置异常，请联系管理员处理；你也可以先使用普通模式重试'
  }
  if (
    lower.includes('context deadline exceeded') ||
    lower.includes('client.timeout') ||
    lower.includes('timeout exceeded while awaiting headers') ||
    lower.includes('net/http: timeout') ||
    lower.includes('i/o timeout') ||
    lower.includes('tls handshake timeout')
  ) {
    return 'AI 识别服务响应超时，请稍后重试'
  }
  if (
    lower.includes('resource exhausted') ||
    lower.includes('doubao api error 429') ||
    lower.includes('ofoxai api error 429')
  ) {
    return 'AI 识别服务当前繁忙，请稍后重试'
  }
  if (
    lower.includes('incorrect api key') ||
    lower.includes('api key format is incorrect') ||
    lower.includes('authenticationerror') ||
    lower.includes('apikey-error') ||
    lower.includes('doubao responses api error 401') ||
    lower.includes('doubao api error 401') ||
    lower.includes('ofoxai api error 401')
  ) {
    return 'AI 识别服务配置异常，请联系管理员处理'
  }
  if (
    lower.includes('internalserviceerror') ||
    lower.includes('doubao api error 500') ||
    lower.includes('doubao api error 502') ||
    lower.includes('doubao api error 503') ||
    lower.includes('doubao api error 504') ||
    lower.includes('ofoxai api error 500') ||
    lower.includes('ofoxai api error 502') ||
    lower.includes('ofoxai api error 503') ||
    lower.includes('ofoxai api error 504')
  ) {
    return 'AI 识别服务暂时不可用，请稍后重试'
  }
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
}

const normalizeTaskTraceId = (value: unknown): string => {
  const text = String(value || '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (lower === 'no-trace-id' || lower === 'none' || lower === 'null' || lower === 'undefined') return ''
  return text
}

const pickAnalyzeTaskTraceId = (task: AnalysisTask): string => {
  const direct = normalizeTaskTraceId(task.trace_id || task.traceId)
  if (direct) return direct
  const payload = task.payload as Record<string, unknown> | undefined
  return normalizeTaskTraceId(payload?.trace_id || payload?.traceId)
}

const pickSourceTaskTypeFromTask = (task: AnalysisTask): 'food' | 'food_text' => {
  if (task.task_type === 'food_text') return 'food_text'
  const payload = task.payload as Record<string, unknown> | undefined
  return payload?.source_type === 'text' ? 'food_text' : 'food'
}

const persistResultImageFromTask = (task: AnalysisTask) => {
  const taskImagePaths = Array.isArray(task.image_paths)
    ? task.image_paths.filter((path) => typeof path === 'string' && path.trim())
    : []
  const taskImageUrl = typeof task.image_url === 'string' && task.image_url.trim()
    ? task.image_url.trim()
    : ''

  if (taskImagePaths.length > 0) {
    Taro.setStorageSync('analyzeImagePath', taskImagePaths[0])
    Taro.setStorageSync('analyzeImagePaths', taskImagePaths)
    return
  }

  if (taskImageUrl) {
    Taro.setStorageSync('analyzeImagePath', taskImageUrl)
    Taro.setStorageSync('analyzeImagePaths', [taskImageUrl])
  }
}

const persistAnalyzeContextFromPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.meal_type === 'string' && payload.meal_type.trim()) {
    Taro.setStorageSync('analyzeMealType', payload.meal_type)
  }
  if (typeof payload.diet_goal === 'string' && payload.diet_goal.trim()) {
    Taro.setStorageSync('analyzeDietGoal', payload.diet_goal)
  }
  if (typeof payload.activity_timing === 'string' && payload.activity_timing.trim()) {
    Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing)
  }
}

const pickExecutionModeFromTask = (task: AnalysisTask): ExecutionMode | null => {
  const taskAny = task as AnalysisTask & { execution_mode?: unknown }
  if (taskAny.execution_mode === 'fast') {
    return 'fast'
  }
  if (taskAny.execution_mode === 'fast_web_search') {
    return 'fast_web_search'
  }
  if (taskAny.execution_mode === 'standard_web_search') {
    return 'standard_web_search'
  }
  if (taskAny.execution_mode === 'standard_packaged_experiment') {
    return 'standard_packaged_experiment'
  }
  if (taskAny.execution_mode === 'strict_separate') {
    return 'strict_separate'
  }
  if (taskAny.execution_mode === 'strict_web_search') {
    return 'strict_web_search'
  }
  if (taskAny.execution_mode === 'strict' || taskAny.execution_mode === 'gemini35_flash' || taskAny.execution_mode === 'gemini35_flash_grouped') {
    return 'strict'
  }
  if (taskAny.execution_mode === 'standard') {
    return 'standard'
  }
  const payloadMode = (task.payload as Record<string, unknown> | undefined)?.execution_mode
  if (payloadMode === 'fast') {
    return 'fast'
  }
  if (payloadMode === 'fast_web_search') {
    return 'fast_web_search'
  }
  if (payloadMode === 'standard_web_search') {
    return 'standard_web_search'
  }
  if (payloadMode === 'standard_packaged_experiment') {
    return 'standard_packaged_experiment'
  }
  if (payloadMode === 'strict_separate') {
    return 'strict_separate'
  }
  if (payloadMode === 'strict_web_search') {
    return 'strict_web_search'
  }
  if (payloadMode === 'strict' || payloadMode === 'gemini35_flash' || payloadMode === 'gemini35_flash_grouped') {
    return 'strict'
  }
  if (payloadMode === 'standard') {
    return 'standard'
  }
  return null
}

function AnalyzeLoadingPage() {
  const [taskId, setTaskId] = useState<string>('')
  const [taskType, setTaskType] = useState<string>(() =>
    normalizeTaskType(Taro.getCurrentInstance().router?.params?.task_type)
  )
  const [textRecordInput, setTextRecordInput] = useState<string>(() =>
    String(Taro.getStorageSync('analyzeTextInput') || '').trim()
  )
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [status, setStatus] = useState<'loading' | 'done' | 'failed' | 'violated'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [errorTraceId, setErrorTraceId] = useState<string>('')
  const [violationReason, setViolationReason] = useState<string>('')
  const [tipIndex, setTipIndex] = useState(() => getNextTipIndex())
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastTaskStatusText, setLastTaskStatusText] = useState('已提交')
  const [interactionIndex, setInteractionIndex] = useState(() => getNextInteractionIndex())
  const [selectedQuizOption, setSelectedQuizOption] = useState<number | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [isCorrectionMode, setIsCorrectionMode] = useState(() =>
    Taro.getCurrentInstance().router?.params?.correction === '1'
  )
  const [imagePath, setImagePath] = useState<string>('')
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollFnRef = useRef<(() => Promise<void>) | null>(null)
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollInFlightRef = useRef(false)
  const pollFailureCountRef = useRef(0)
  const startTimeRef = useRef<number>(Date.now())
  const routeSignatureRef = useRef<string>('')

  const syncImagePathFromStorage = useCallback(() => {
    try {
      // 仅以 URL task_type 为准：food_text = 文字链（占位图）；food / food_image 等 = 拍照或相册（用 storage 里的本地/远端预览）
      const type = normalizeTaskType(Taro.getCurrentInstance().router?.params?.task_type)
      if (type === 'food_text') {
        Taro.removeStorageSync('analyzeImagePath')
        Taro.removeStorageSync('analyzeImagePaths')
        setImagePath('')
        return
      }
      if (type === 'exercise') {
        setImagePath('')
        return
      }
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
        setImagePath(String(storedPaths[0] || ''))
      } else if (storedPath) {
        setImagePath(String(storedPath))
      } else {
        setImagePath('')
      }
    } catch (e) {
      console.error('获取图片路径失败:', e)
    }
  }, [])

  const syncTextRecordInputFromStorage = useCallback(() => {
    try {
      setTextRecordInput(String(Taro.getStorageSync('analyzeTextInput') || '').trim())
    } catch {
      setTextRecordInput('')
    }
  }, [])

  useEffect(() => {
    syncImagePathFromStorage()
    syncTextRecordInputFromStorage()
  }, [syncImagePathFromStorage, syncTextRecordInputFromStorage])

  const syncRouteTaskFromParams = useCallback(() => {
    const params = Taro.getCurrentInstance().router?.params
    const id = params?.task_id
    const type = normalizeTaskType(params?.task_type)
    const modeFromStorage = Taro.getStorageSync('analyzeExecutionMode')
    const mode = normalizeExecutionMode(params?.execution_mode || modeFromStorage)
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    const correctionMode = params?.correction === '1'
    const nextSignature = `${String(id || '')}|${type}|${mode}|${requestedAnalysisEngine}|${correctionMode ? 'correction' : 'normal'}`

    const isDebug = id?.startsWith('debug-') || false
    setIsDebugMode(isDebug)
    setIsCorrectionMode(correctionMode)

    if (!id) {
      void showUnifiedApiError(new Error('缺少任务 ID'), '缺少任务 ID')
      setTimeout(() => Taro.navigateBack(), 1500)
      return
    }
    if (routeSignatureRef.current !== nextSignature) {
      routeSignatureRef.current = nextSignature
      console.info('[analyze-loading] sync route task', {
        task_id: id,
        task_type: type,
        execution_mode: mode,
        analysis_engine: requestedAnalysisEngine || '(from storage)',
        correction: correctionMode,
      })
      setStatus('loading')
      setErrorMessage('')
      setErrorTraceId('')
      setViolationReason('')
      setElapsedSeconds(0)
      setLastTaskStatusText(correctionMode ? '已提交纠错' : '已提交')
      pollFailureCountRef.current = 0
      setInteractionIndex(prev => getNextInteractionIndex(prev))
      setSelectedQuizOption(null)
      setTipIndex(getNextTipIndex())
      startTimeRef.current = Date.now()
    }
    setTaskId(id)
    setTaskType(type)
    setExecutionMode(mode)
    Taro.setStorageSync('analyzeExecutionMode', mode)
    Taro.setStorageSync('analyzeTaskType', type)
    if (requestedAnalysisEngine) {
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, normalizeAnalysisEngine(requestedAnalysisEngine, mode))
    }
    if (correctionMode) {
      Taro.setNavigationBarTitle({ title: '纠错分析中' })
    } else if (type === 'exercise') {
      Taro.setNavigationBarTitle({ title: '分析中' })
    }

    if (isDebug) {
      Taro.showToast({
        title: '调试模式：停留在分析中',
        icon: 'none',
        duration: 2000
      })
    }
  }, [])

  useDidShow(() => {
    syncRouteTaskFromParams()
    syncImagePathFromStorage()
    syncTextRecordInputFromStorage()
    // 切后台再回前台：补一次任务拉取（与 setInterval 互补）
    void pollFnRef.current?.()
  })

  useEffect(() => {
    syncRouteTaskFromParams()
  }, [syncRouteTaskFromParams])

  useEffect(() => {
    if (status !== 'loading') return

    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000)))
    }, 1000)

    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
    }
  }, [status])

  useEffect(() => {
    if (!taskId || status !== 'loading') return

    if (isDebugMode) {
      console.log('[Debug Mode] 跳过真实轮询，保持分析中状态')
      return
    }

    let cancelled = false
    const scheduleNextPoll = (delay: number) => {
      if (cancelled) return
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      pollTimerRef.current = setTimeout(() => {
        void poll()
      }, delay)
    }

    async function poll() {
      if (cancelled) return
      if (pollInFlightRef.current) {
        // 当任务状态同步触发 effect 重建时，上一轮请求可能尚未结束；补排一次，
        // 避免旧 effect 清理后新 effect 因“请求进行中”而永久停止查询。
        scheduleNextPoll(POLL_INTERVAL)
        return
      }
      pollInFlightRef.current = true
      let settled = false
      try {
        const task: AnalysisTask = await getAnalyzeTask(taskId)
        pollFailureCountRef.current = 0
        setLastTaskStatusText(task.status === 'processing' ? '处理中' : task.status === 'pending' ? '排队中' : '收尾中')
        const taskMode = pickExecutionModeFromTask(task)
        const effectiveTaskType = pickSourceTaskTypeFromTask(task)
        if (taskMode) {
          setExecutionMode(taskMode)
          Taro.setStorageSync('analyzeExecutionMode', taskMode)
        }
        if (effectiveTaskType !== taskType) {
          setTaskType(effectiveTaskType)
          Taro.setStorageSync('analyzeTaskType', effectiveTaskType)
        }
        if (task.status === 'done' && task.result) {
          const exResult = task.result as unknown as ExerciseTaskResultPayload | undefined
          if (exResult?.exercise_log) {
            settled = true
            setStatus('done')
            if (pollTimerRef.current) {
              clearTimeout(pollTimerRef.current)
              pollTimerRef.current = null
            }
            if (elapsedTimerRef.current) {
              clearInterval(elapsedTimerRef.current)
              elapsedTimerRef.current = null
            }
            if (tipTimerRef.current) {
              clearInterval(tipTimerRef.current)
              tipTimerRef.current = null
            }
            Taro.removeStorageSync(EXERCISE_PENDING_TASK_KEY)
            const kcal = exResult.estimated_calories ?? exResult.exercise_log.calories_burned
            Taro.showToast({ title: `已记录 ${kcal} kcal`, icon: 'success' })
            const exerciseDate = persistRecordTargetDate(String(((task.payload as Record<string, unknown>)?.recorded_on as string) || ''))
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(exerciseDate)}` })
            return
          }

          const result = task.result as AnalyzeResponse
          if (result.redirectTaskId && result.redirectTaskId !== taskId) {
            settled = true
            setTaskId(result.redirectTaskId)
            return
          }
          const needsPrecisionAction = needsPrecisionUserAction(result)
          if (needsPrecisionAction) {
            settled = true
            setStatus('done')
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
            pollTimerRef.current = null
            elapsedTimerRef.current = null
            persistResultImageFromTask(task)
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            if (result.precisionSessionId) {
              Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
            }
            Taro.redirectTo({
              url: `${extraPkgUrl('/pages/precision-confirm/index')}?task_id=${encodeURIComponent(taskId)}`,
            })
            return
          }
          settled = true
          setStatus('done')
          if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current)
            pollTimerRef.current = null
          }

          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')
          const payload = task.payload || {}
          const targetDate = persistRecordTargetDate(String((payload.recorded_on as string) || getStoredRecordTargetDate()))
          const settledMode = taskMode || executionMode
          const settledAnalysisEngine = normalizeAnalysisEngine(
            result.analysis_engine || (payload as Record<string, unknown>).analysis_engine,
            settledMode,
          )
          Taro.setStorageSync('analyzeExecutionMode', settledMode)
          Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, settledAnalysisEngine)
          if (result.precisionSessionId) {
            Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
          } else {
            Taro.removeStorageSync('analyzePrecisionSessionId')
          }

          // 根据任务类型跳转到不同的结果页面
          if (effectiveTaskType === 'food_text') {
            // 文字分析：跳转到统一的结果页（复用图片分析页）
            // 必须同时清空单图和多图缓存，避免上一次拍照识别残留的图片混入本次纯文字结果。
            Taro.removeStorageSync('analyzeImagePath')
            Taro.removeStorageSync('analyzeImagePaths')
            Taro.setStorageSync('analyzeTextInput', task.text_input || '')
            setTextRecordInput(String(task.text_input || '').trim())
            Taro.setStorageSync('analyzeTextAdditionalContext', (payload.additionalContext as string) || '')
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            persistAnalyzeContextFromPayload(payload)
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food_text')
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/result/index')}?date=${encodeURIComponent(targetDate)}` })
          } else {
            Taro.removeStorageSync('analyzeTextInput')
            Taro.removeStorageSync('analyzeTextAdditionalContext')
            persistResultImageFromTask(task)
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            persistAnalyzeContextFromPayload(payload)
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food')
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/result/index')}?date=${encodeURIComponent(targetDate)}` })
          }
          return
        }
        if (task.status === 'failed' || task.status === 'timed_out') {
          settled = true
          setStatus('failed')
          setErrorTraceId(pickAnalyzeTaskTraceId(task))
          setErrorMessage(normalizeAnalyzeTaskErrorMessage(task.error_message || (task.status === 'timed_out' ? (isCorrectionMode ? '纠错分析超时，请重试' : '分析超时，请重试') : (isCorrectionMode ? '纠错失败' : '识别失败'))))
          if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current)
            pollTimerRef.current = null
          }

          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
        }
        if (task.status === 'violated' || task.is_violated) {
          settled = true
          setStatus('violated')
          setViolationReason(task.violation_reason || '内容违规')
          if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current)
            pollTimerRef.current = null
          }

          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
        }
      } catch (e: any) {
        console.error('轮询任务失败:', e)
        pollFailureCountRef.current += 1
        setLastTaskStatusText('网络重连中')
      } finally {
        pollInFlightRef.current = false
        if (!settled && !cancelled) {
          const retryCount = Math.min(pollFailureCountRef.current, 3)
          scheduleNextPoll(Math.min(POLL_RETRY_MAX_INTERVAL, POLL_INTERVAL * (2 ** retryCount)))
        }
      }
    }
    pollFnRef.current = poll
    void poll()
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
      pollFnRef.current = null
    }
  }, [taskId, taskType, status, executionMode, isDebugMode])

  useEffect(() => {
    if (status !== 'loading') return
    tipTimerRef.current = setInterval(() => {
      setTipIndex(i => getNextTipIndex(i))
    }, TIP_ROTATE_INTERVAL)
    return () => {
      if (tipTimerRef.current) clearInterval(tipTimerRef.current)
    }
  }, [status])

  const handleLeave = () => {
    if (taskType === 'exercise') {
      Taro.showModal({
        title: '稍后查看',
        content: '分析将在后台继续，完成后可回到「记运动」页面查看结果。',
        showCancel: true,
        confirmText: '去记运动',
        cancelText: '留在此页',
        success: res => {
          if (res.confirm) {
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(getStoredRecordTargetDate())}` })
          }
        }
      })
      return
    }
    Taro.showModal({
      title: '稍后查看',
      content: isCorrectionMode ? '纠错分析将在后台继续，完成后可在「我的」「识别记录」中查看结果。' : '分析将在后台继续，完成后可在「我的」「识别记录」中查看结果。',
      showCancel: true,
      confirmText: '去历史',
      success: res => {
        if (res.confirm) {
          Taro.redirectTo({ url: extraPkgUrl('/pages/analyze-history/index') })
        }
      }
    })
  }

  const handleGoHistory = () => {
    Taro.redirectTo({ url: extraPkgUrl('/pages/analyze-history/index') })
  }

  const handleNextInteraction = () => {
    setInteractionIndex(prev => getNextInteractionIndex(prev))
    setSelectedQuizOption(null)
  }

  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${minutes}m ${rest}s`
  }

  if (status === 'violated') {
    return (
      <View className='analyze-loading-page'>
        <View className='violated-wrap'>
          <View className='violated-icon-wrap'>
            <Text className='iconfont icon-nothing' style={{ fontSize: '80rpx', color: '#dc2626' }} />
          </View>
          <Text className='violated-title'>内容审核未通过</Text>
          <Text className='violated-reason'>{violationReason}</Text>
          <Text className='violated-hint'>您提交的内容不符合平台使用规范，请确保上传与食物相关的图片或文字描述。</Text>
          <Text className='btn-history' onClick={handleGoHistory}>返回识别记录</Text>
          <Text className='ai-notice'> 食探 - 您的智能健康管理助手</Text>
        </View>
      </View>
    )
  }

  if (status === 'failed') {
    return (
      <View className='analyze-loading-page'>
        <View className='error-wrap'>
          <Text className='error-msg'>
            {taskType === 'exercise' ? '分析失败：' : '识别失败：'}
            {errorMessage}
          </Text>
          {errorTraceId ? (
            <Text selectable className='error-trace'>traceId: {errorTraceId}</Text>
          ) : null}
          <Text
            className='btn-history'
            onClick={() =>
              taskType === 'exercise'
                ? Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(getStoredRecordTargetDate())}` })
                : handleGoHistory()
            }
          >
            {taskType === 'exercise' ? '返回记运动' : '去识别记录'}
          </Text>
          <Text className='ai-notice'> 食探 - 您的智能健康管理助手</Text>
        </View>
      </View>
    )
  }

  const isTextFoodTask = taskType === 'food_text'
  const textRecordPreview = textRecordInput || '文字记录，未提供实物照片'
  const interactionCard = WAITING_INTERACTION_CARDS[interactionIndex]
  const showPrecisionLongWaitNotice = taskType === 'food' && (executionMode === 'strict' || executionMode === 'strict_separate' || executionMode === 'strict_web_search') && !isCorrectionMode

  return (
    <View className='analyze-loading-page-v3'>
      {/* 全屏背景：拍照分析与结果头图一致；文字分析与结果页「无图占位」同一视觉 */}
      {isTextFoodTask ? (
        <View className='fullscreen-bg-text-record'>
          <View className='fullscreen-text-placeholder'>
            <View className='text-record-icon-wrap'>
              <Text className='iconfont icon-shiwu' style={{ fontSize: '120rpx', color: '#00bc7d' }} />
            </View>
            <Text className='text-record-placeholder-label'>{textRecordPreview}</Text>
          </View>
        </View>
      ) : imagePath ? (
        <Image className='fullscreen-bg-image' src={imagePath} mode='aspectFill' />
      ) : (
        <View className='fullscreen-bg-fallback' />
      )}

      {/* 底部渐变：仅衬托文字，不遮挡整图 */}
      <View className='loading-bottom-readability' />

      {/* 内容层 */}
      <View className='content-layer'>
        <View className='scanner-frame-container'>
          <View className='scanner-frame-v3'>
            {taskType === 'exercise' ? (
              <View className='frame-placeholder-v3'>
                <IconExercise size={64} color='#f97316' />
              </View>
            ) : isTextFoodTask ? (
              <View className='frame-placeholder-v3 frame-placeholder-text-record'>
                <View className='frame-text-record-icon-wrap'>
                  <Text className='iconfont icon-shiwu' style={{ fontSize: '64rpx', color: '#00bc7d' }} />
                </View>
                <Text className='frame-text-record-label'>{textRecordPreview}</Text>
              </View>
            ) : imagePath ? (
              <Image className='frame-image-v3' src={imagePath} mode='aspectFill' />
            ) : (
              <View className='frame-placeholder-v3'>
                <Text className='iconfont icon-shiwu' style={{ fontSize: '64rpx', color: '#00bc7d' }} />
              </View>
            )}
            <View className='scan-line-v3' />
            <View className='corner corner-tl' />
            <View className='corner corner-tr' />
            <View className='corner corner-bl' />
            <View className='corner corner-br' />
          </View>
        </View>

        <View className='game-tip-container'>
          <View className='game-tip-box'>
            <Text className='game-tip-label'>小贴士</Text>
            <Text className='game-tip-text'>{HEALTH_TIPS[tipIndex]}</Text>
          </View>
        </View>

        <View className='steps-panel'>
          <View className='stage-summary'>
            <View className='stage-summary-left'>
              <Text className='stage-summary-title'>
                {isCorrectionMode ? '纠错任务' : '任务'}{lastTaskStatusText}
              </Text>
              {taskType !== 'exercise' && (
                <View className={`mode-badge inline ${executionMode}`}>
                  <Text className='mode-badge-text'>
                    {isCorrectionMode ? '纠错分析' : EXECUTION_MODE_META[executionMode].title}
                  </Text>
                </View>
              )}
            </View>
            <Text className='stage-summary-time'>已等待 {formatElapsed(elapsedSeconds)}</Text>
          </View>
          {showPrecisionLongWaitNotice && (
            <Text className='precision-long-wait-notice'>
              精准模式会更细致识别食物和份量，可能需要更久；你可以先离开，完成后到识别记录查看。
            </Text>
          )}
        </View>

        <View className='waiting-interaction-card'>
          <View className='waiting-interaction-head'>
            <Text className='waiting-interaction-eyebrow'>{interactionCard.eyebrow}</Text>
            <Text className='waiting-interaction-skip' onClick={handleNextInteraction}>
              换一个
            </Text>
          </View>
          <Text className='waiting-interaction-title'>{interactionCard.title}</Text>
          {interactionCard.type === 'quiz' ? (
            <View className='waiting-quiz-options'>
              {interactionCard.options.map((option, index) => {
                const chosen = selectedQuizOption === index
                const correct = interactionCard.answerIndex === index
                const revealed = selectedQuizOption !== null
                return (
                  <View
                    key={option}
                    className={`waiting-quiz-option${chosen ? ' chosen' : ''}${revealed && correct ? ' correct' : ''}`}
                    onClick={() => setSelectedQuizOption(index)}
                  >
                    <Text className='waiting-quiz-option-text'>{option}</Text>
                  </View>
                )
              })}
              {selectedQuizOption !== null && (
                <Text className='waiting-interaction-reveal'>{interactionCard.reveal}</Text>
              )}
            </View>
          ) : (
            <View className='waiting-fact-body'>
              <Text className='waiting-interaction-reveal'>{interactionCard.reveal}</Text>
              <View className='waiting-fact-next' onClick={handleNextInteraction}>
                <Text className='waiting-fact-next-text'>{interactionCard.actionText}</Text>
              </View>
            </View>
          )}
        </View>

        <View className='bottom-actions'>
          <View className='btn-leave-v3' onClick={handleLeave}>
            <Text className='btn-leave-text-v3'>先离开，稍后查看</Text>
          </View>
          {isDebugMode && (
            <View className='btn-exit-debug-v3' onClick={() => Taro.navigateBack()}>
              <Text className='btn-exit-debug-text'>退出调试</Text>
            </View>
          )}
        </View>

        <Text className='brand-footer'>食探 · 智能饮食记录</Text>
      </View>
    </View>
  )
}

export default withAuth(AnalyzeLoadingPage)
