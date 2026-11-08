import { Text, View } from '@tarojs/components'

export interface HowToStep {
  title: string
  desc: string
}

/** 一张编号步骤卡：告诉人这一页先做什么、再做什么。 */
export function HowTo({ title, steps }: { title: string; steps: HowToStep[] }) {
  return (
    <View className='rw-card cc-howto'>
      <Text className='rw-card__title'>{title}</Text>
      {steps.map((step, index) => (
        <View key={step.title} className='cc-howto__step'>
          <Text className='cc-howto__index'>{index + 1}</Text>
          <View className='cc-howto__copy'>
            <Text className='cc-howto__title'>{step.title}</Text>
            <Text className='cc-howto__desc'>{step.desc}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

export const JOIN_STEPS: HowToStep[] = [
  { title: '拿到加入码', desc: '找社团负责人要 6 位加入码，或者直接点社团群里转发的小程序卡片。' },
  { title: '加入活动', desc: '输入加入码，选你有没有食物秤，点「同意并加入」。' },
  { title: '开始记录', desc: '有秤的用秤称；没秤的拍照记，记完回到活动页把这一餐挂到食堂的菜上。' },
]

export const MEMBER_STEPS: HowToStep[] = [
  { title: '有食物秤：点「用秤记一顿」', desc: '先拍整顿饭，再把每个碗或盒子放上秤拍读数，数字会自动填好，提交后几秒自动审核。' },
  { title: '没有秤：点「拍照记一顿」', desc: '像平时一样拍照记一餐、保存，再回到这里，在「今天的拍照记录」里点「挂到食堂菜」，选是哪道菜。' },
  { title: '社团办称重日时', desc: '按通知的时间地点端着饭去，点「今天的称重日」里的「去称重」，用社团的秤称一下。' },
]

export const LEADER_STEPS: HowToStep[] = [
  { title: '把活动发给成员', desc: '点下面的「转发活动卡片给成员」发到社团群，或把加入码发给大家。' },
  { title: '勾核心成员', desc: '在成员列表里点「设为核心」，勾上的人自动开通标准版会员（能用精准模式），活动结束自动到期。' },
  { title: '建称重日', desc: '定好时间地点建一个称重日，成员当天在活动页就能看到「去称重」。' },
]
