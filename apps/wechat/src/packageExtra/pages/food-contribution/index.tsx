import { Text, View } from '@tarojs/components'
import { useRef } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import './index.scss'

const TYPES = [
  { key: 'standard', icon: 'icon-shiwu', title: '标准食物', desc: '米饭、鸡蛋、土豆等每100g营养数据' },
  { key: 'packaged', icon: 'icon-picture', title: '包装食品', desc: '拍包装正面、营养成分表和配料表' },
  { key: 'public', icon: 'icon-foodshop', title: '公共餐食', desc: '普通餐食或校园食堂真实菜品' },
] as const

export default function FoodContributionPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const focusHandledRef = useRef(false)

  const openType = async (key: typeof TYPES[number]['key']) => {
    if (key === 'standard') {
      Taro.navigateTo({ url: extraPkgUrl('/pages/standard-food-contribution/index') })
      return
    }
    if (key === 'packaged') {
      Taro.navigateTo({ url: extraPkgUrl('/pages/packaged-food-edit/index?task_mode=reward_center') })
      return
    }
    try {
      const result = await Taro.showActionSheet({ itemList: ['普通公共餐食', '校园餐食'] })
      Taro.navigateTo({
        url: result.tapIndex === 1
          ? extraPkgUrl('/pages/campus-food-share/index?task_mode=contribution')
          : extraPkgUrl('/pages/food-library-share/index?task_mode=contribution'),
      })
    } catch {
      // 用户取消类型选择时留在贡献首页。
    }
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    if (focusHandledRef.current) return
    const focus = router.params?.focus
    if (focus !== 'standard' && focus !== 'packaged' && focus !== 'public') return
    focusHandledRef.current = true
    setTimeout(() => void openType(focus), 0)
  })

  return (
    <View className={`food-contribution-page ${scheme === 'dark' ? 'food-contribution-page--dark' : ''}`}>
      <View className='contribution-hero'>
        <Text className='contribution-hero__eyebrow'>共建食物数据库</Text>
        <Text className='contribution-hero__title'>贡献食物数据</Text>
        <Text className='contribution-hero__desc'>选择你要补充的数据类型。日常记录仍从首页底部入口完成。</Text>
      </View>
      <View className='contribution-types'>
        {TYPES.map((item) => (
          <View key={item.key} className='contribution-type' onClick={() => void openType(item.key)}>
            <View className='contribution-type__icon'><Text className={`iconfont ${item.icon}`} /></View>
            <View className='contribution-type__copy'>
              <Text className='contribution-type__title'>{item.title}</Text>
              <Text className='contribution-type__desc'>{item.desc}</Text>
            </View>
            <Text className='contribution-type__arrow'>›</Text>
          </View>
        ))}
      </View>
      <View className='contribution-note'>
        <Text>标准食物与包装食品审核通过后奖励1积分；公共餐食按现有奖励规则执行。</Text>
      </View>
    </View>
  )
}
