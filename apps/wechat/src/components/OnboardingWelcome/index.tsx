import { View, Text, Image, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { experiments } from '../../utils/experiments'
import {
  getOnboardingStats,
  getOnboardingTrustConfig,
  type OnboardingStats,
  type OnboardingTrustConfig,
} from '../../utils/onboarding-api'
import { formatTrustCount, WELCOME_DONE_KEY, WELCOME_VISIBLE_KEY } from '../../utils/onboarding-v2'
import { HOME_BOTANICAL_BG_URL } from '../../utils/static-asset-cdn-url'
import { DEFAULT_PET_NAME } from '../../utils/pet-name'
import { TrustBadges } from '../TrustBadges'
import './index.scss'

const XIAOMAI = '/assets/pets/xiaomai-01.png'
const TRY_PAGE = '/packageOnboarding/pages/try/index'

const QUESTIONS = [
  { id: 'cut', text: '减脂期，晚饭怎么吃才不饿？', answer: '晚饭先吃一份鱼或鸡胸、一大份青菜，主食换成半碗杂粮饭。蛋白质和纤维都够，晚上不容易饿。告诉我你在哪吃，我直接挑能买到的。' },
  { id: 'campus', text: '我在学校，20 块以内吃什么？', answer: '告诉我是哪所学校，我从食堂菜单里挑 20 块以内、热量合适的两三道，告诉你在哪个窗口。' },
  { id: 'gym', text: '练完腿，晚饭怎么补蛋白？', answer: '练后这顿补 30g 左右蛋白，再配一份主食：比如牛肉面、鸡腿饭加个蛋。按你的体重我还能算得更准。' },
]

function markDone() {
  try { Taro.setStorageSync(WELCOME_DONE_KEY, '1') } catch { /* 下次打开可能再弹一次，不影响使用 */ }
}

/**
 * 注册新流程首屏（onboarding_v2 实验组）：盖在首页上，健文伙伴出场，先试后登。
 * 「先随便逛逛」直接回到首页，游客照常浏览。
 */
export function OnboardingWelcome({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<OnboardingTrustConfig>({ badges: [], source_lines: [], result_line: '' })
  const [stats, setStats] = useState<OnboardingStats | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    experiments.track('onboarding_welcome_view')
    void getOnboardingTrustConfig().then(setConfig)
    void getOnboardingStats().then(setStats)
    // 只写 storage，由 custom-tab-bar 的 updateHidden 隐藏底栏；自定义底栏下不能调 hideTabBar
    try { Taro.setStorageSync(WELCOME_VISIBLE_KEY, '1') } catch { /* 底栏留着也能用 */ }
    return () => { try { Taro.removeStorageSync(WELCOME_VISIBLE_KEY) } catch { /* 同上 */ } }
  }, [])

  const go = (sheet?: 'login') => {
    experiments.track('onboarding_welcome_try', { from: sheet ? 'ask' : 'photo' })
    markDone()
    Taro.navigateTo({ url: sheet ? `${TRY_PAGE}?sheet=login` : TRY_PAGE })
    onClose()
  }

  const browse = () => {
    experiments.track('onboarding_welcome_browse')
    markDone()
    onClose()
  }

  const answer = QUESTIONS.find((q) => q.id === picked)
  const showStats = stats && stats.standard_foods > 0

  return (
    <View className='ob-welcome'>
      <Image className='ob-welcome__bg' src={HOME_BOTANICAL_BG_URL} mode='aspectFill' />
      <View className='ob-welcome__body'>
        <Text className='ob-welcome__brand'>智健食探</Text>
        <Image className='ob-welcome__mascot' src={XIAOMAI} mode='aspectFit' />
        <View className='ob-welcome__bubble'>
          <Text>嗨，我是{DEFAULT_PET_NAME}～{'\n'}拍一下你眼前这顿，我马上告诉你吃了多少。</Text>
        </View>
        <Text className='ob-welcome__slogan'>下一顿吃什么，问食探。</Text>

        <Button className='ob-welcome__primary' onClick={() => go()}>拍一下这顿</Button>
        <Button className='ob-welcome__ghost' onClick={() => { setAskOpen(!askOpen); experiments.track('onboarding_welcome_ask') }}>不拍照，问我一句</Button>

        {askOpen && (
          <View className='ob-welcome__qs'>
            {QUESTIONS.map((q) => (
              <View key={q.id} className={`ob-welcome__q ${picked === q.id ? 'ob-welcome__q--on' : ''}`} onClick={() => setPicked(q.id)}>
                <Text>{q.text}</Text>
              </View>
            ))}
            {answer && (
              <View className='ob-welcome__answer'>
                <Text className='ob-welcome__answer-tag'>{DEFAULT_PET_NAME} · 示例回答</Text>
                <Text className='ob-welcome__answer-text'>{answer.answer}</Text>
                <View className='ob-welcome__answer-go' onClick={() => go('login')}><Text>按我的情况来 →</Text></View>
              </View>
            )}
          </View>
        )}

        {(showStats || config.badges.length > 0) && (
          <View className='ob-welcome__trust'>
            <TrustBadges badges={config.badges} />
            {showStats && stats && (
              <View className='ob-welcome__stats'>
                <View className='ob-welcome__stat'><Text className='ob-welcome__num'>{formatTrustCount(stats.standard_foods)}</Text><Text className='ob-welcome__label'>种食物{'\n'}营养数据</Text></View>
                <View className='ob-welcome__stat ob-welcome__stat--mid'><Text className='ob-welcome__num'>{formatTrustCount(stats.campus_dishes)}</Text><Text className='ob-welcome__label'>道已核实的{'\n'}高校食堂菜</Text></View>
                <View className='ob-welcome__stat'><Text className='ob-welcome__num'>{formatTrustCount(stats.food_records)}</Text><Text className='ob-welcome__label'>顿饭{'\n'}用户已记录</Text></View>
              </View>
            )}
            <View className='ob-welcome__src-toggle' onClick={() => setSourcesOpen(!sourcesOpen)}>
              <Text>数据从哪来？{sourcesOpen ? '收起' : ''}</Text>
            </View>
            {sourcesOpen && (
              <View className='ob-welcome__src'>
                {config.source_lines.map((line) => <Text key={line}>· {line}</Text>)}
                {stats && stats.authoritative_foods > 0 && <Text>· {formatTrustCount(stats.authoritative_foods)} 种来自美国农业部食物数据中心、中国疾控营养成分平台等公开权威数据</Text>}
                {stats && stats.campus_dishes > 0 && <Text>· {formatTrustCount(stats.campus_dishes)} 道菜来自 {stats.campus_schools} 所高校食堂的窗口实拍和菜单，人工核对后才上线</Text>}
                {stats && stats.packaged_foods > 0 && <Text>· {formatTrustCount(stats.packaged_foods)} 种包装食品，按包装上的营养成分表核对</Text>}
                <Text>· 识别出的每一样都写明依据，算错了一句话就能改</Text>
              </View>
            )}
          </View>
        )}

        <View className='ob-welcome__browse' onClick={browse}><Text>先随便逛逛</Text></View>
      </View>
    </View>
  )
}
