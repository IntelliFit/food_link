import { View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import { MetabolicDynamicsReport } from './metabolic-dynamics-report'

import './index.scss'

function StatsMetabolicPage() {
  const router = useRouter()
  const reportDate = (router.params?.date || '').trim() || undefined
  return (
    <View className='stats-metabolic-page stats-metabolic-page--bleed'>
      {/* 用占位块替代页面 padding-top：部分基础库下根节点 padding 会导致 type=2d Canvas 原生层与 DOM 纵向错位 */}
      <View className='stats-metabolic-page__top-spacer' />
      <MetabolicDynamicsReport reportDate={reportDate} layout='page' />
      {/* 微信自定义 tabBar 组件；与 app.json custom tabBar 同源 */}
      {/* @ts-expect-error 原生自定义组件，非 Taro 内置标签 */}
      <custom-tab-bar />
    </View>
  )
}

export default withAuth(StatsMetabolicPage)
