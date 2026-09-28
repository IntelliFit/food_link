import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import * as React from 'react'
import { useInkWellness } from './InkWellness'
import { useBalancedTheme } from './BalancedThemeContext'
import { getBalancedThemeDefinition } from '../utils/balanced-theme'
import { extraPkgUrl } from '../utils/subpackage-extra'
import clarityFood from '../assets/balanced-themes/clarity-food.webp'
import easternLandscape from '../assets/balanced-themes/eastern-landscape.webp'
import waterDrop from '../assets/balanced-themes/water-drop-v6.webp'
import { BALANCED_SCENES, loadBalancedScenes } from '../utils/balanced-theme-scenes'
import './BalancedThemeExperience.scss'

export type BalancedThemeSurface = 'home' | 'stats' | 'community' | 'profile'
export type BalancedThemeHomeData = {
  date: string; mealCount: number; waterMl: number; calories: number
  authenticated: boolean; loading: boolean
}
type Props = {
  surface: BalancedThemeSurface; home?: BalancedThemeHomeData
  children?: React.ReactNode
  onRecord?: () => void; onWater?: () => void; onMeals?: () => void; onPublish?: () => void
}
const TITLES = {
  'clarity-order': ['好好吃饭\n是更好的自己', '本周趋势', '饮食故事', '个人档案'],
  'natural-symbiosis': ['今日生长', '季节年轮', '自然手记', '我的标本册'],
  'eastern-salon': ['今日膳事', '山水食序', '雅集同游', '我的清供'],
  'modern-gallery': ['今日作品', '数据展厅', '公共展场', '个人典藏'],
  'miniature-world': ['饮食花园', '营养河流', '邻里广场', '旅行者档案'],
  'picturebook-companion': ['今天这一章', '七日片段', '一起走过', '我的故事'],
  'clear-care': ['照顾自己', '本周变化', '朋友分享', '我的设置'],
  'way-of-water': ['今日流动', '一周汇流', '相遇成河', '我的路径'],
}
const PHILOSOPHY = {
  'clarity-order': '清晰选择，让每一餐靠近理想的生活。',
  'natural-symbiosis': '微小的选择，汇聚更大的改变。',
  'eastern-salon': '知味 · 知量 · 知己',
  'modern-gallery': '好好吃饭，也是在创造生活。',
  'miniature-world': '一餐一世界，让平衡自然发生。',
  'picturebook-companion': '平凡的一天，也有好味道。',
  'clear-care': '吃得明白，生活更从容。',
  'way-of-water': '随形而行，方能长久。',
}
const SURFACE_INDEX = { home: 0, stats: 1, community: 2, profile: 3 } as const
const SURFACE_NAME = { home: '首页', stats: '分析', community: '圈子', profile: '我的' }

/** Scene artwork is decorative. Metrics and actions belong to the live business page. */
export function BalancedThemeExperience({ surface, home, children, onRecord, onWater, onMeals, onPublish }: Props): React.ReactElement | null {
  const wellness = useInkWellness()
  const { theme } = useBalancedTheme()
  const [scenesReady, setScenesReady] = React.useState(false)
  const [sceneError, setSceneError] = React.useState(false)
  React.useEffect(() => {
    let active = true
    if (!wellness && theme !== 'clarity-order' && theme !== 'clear-care') {
      loadBalancedScenes().then(() => { if (active) { setScenesReady(true); setSceneError(false) } }).catch(() => { if (active) setSceneError(true) })
    }
    return () => { active = false }
  }, [theme, wellness])
  if (wellness) return children ? <>{children}</> : null
  const { miniatureGarden, miniatureDesk, miniatureSquare, picturebookDay, picturebookDesk, waterVessel, waterRock, naturalLeaves, easternSoup, galleryCollage } = scenesReady ? BALANCED_SCENES : {} as Partial<typeof BALANCED_SCENES>
  const retryScene = () => { setSceneError(false); loadBalancedScenes().then(() => setScenesReady(true)).catch(() => setSceneError(true)) }
  const sceneRetry = sceneError && <View className='bt-scene-retry' role='button' onClick={retryScene}>场景未能打开，轻触重试</View>
  const definition = getBalancedThemeDefinition(theme)
  const title = TITLES[theme][SURFACE_INDEX[surface]]
  const now = new Date()
  const date = home?.date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const value = (n: number | undefined, suffix: string) => !home?.authenticated ? '登录后记录' : home.loading ? '—' : `${Math.round(n || 0)}${suffix}`
  const record = onRecord || (() => Taro.switchTab({ url: '/pages/index/index' }))
  const meals = onMeals || record
  const water = onWater || record
  const stats = () => Taro.switchTab({ url: '/pages/stats/index' })
  const recipes = () => Taro.navigateTo({ url: extraPkgUrl('/pages/recipes/index') })
  const action = (id: string, text: string, detail: string, icon: string, onClick: () => void) => (
    <View id={`bt-action-${id}`} className={`bt-action bt-action--${id}`} role='button' aria-label={text} hoverClass='bt-action--pressed' onClick={onClick}>
      {theme === 'way-of-water' && <Image className='bt-action__water-drop' src={waterDrop} mode='aspectFit' />}
      <Text className={`iconfont ${icon} bt-action__icon`} />
      <View className='bt-action__copy'><Text>{text}</Text>{detail && <Text>{detail}</Text>}</View>
      <Text className='iconfont icon-right bt-action__arrow' />
    </View>
  )
  const masthead = <View className='bt-masthead'><View><Text className='bt-masthead__brand'>{theme !== 'way-of-water' && (surface !== 'home' || theme === 'modern-gallery') ? SURFACE_NAME[surface] : '食探'}</Text><Text className='bt-masthead__edition'>{definition.name}</Text></View><Text className='bt-masthead__date'>{date.replace(/-/g, '.')}</Text></View>
  const heading = <View className='bt-heading'><Text className='bt-heading__title'>{title}</Text><Text className='bt-heading__subtitle'>{PHILOSOPHY[theme]}</Text></View>
  const summary = <View className='bt-live-summary'>
    <View role='button' aria-label='查看当日餐食' onClick={meals}><Text>饮食记录</Text><Text>{value(home?.mealCount, ' 餐')}</Text></View>
    <View role='button' aria-label='记录饮水' onClick={water}><Text>饮水</Text><Text>{value(home?.waterMl, ' ml')}</Text></View>
    <View role='button' aria-label='查看营养分析' onClick={stats}><Text>今日摄入</Text><Text>{value(home?.calories, ' kcal')}</Text></View>
  </View>
  const rootClass = `bt-experience bt-experience--${theme} bt-experience--${surface}${children ? ' bt-experience--integrated' : ''}`
  if (surface !== 'home') {
    const art = theme === 'miniature-world' ? (surface === 'profile' ? miniatureDesk : surface === 'community' ? miniatureSquare : miniatureGarden)
      : theme === 'picturebook-companion' ? picturebookDesk : theme === 'natural-symbiosis' ? naturalLeaves
      : theme === 'eastern-salon' ? easternLandscape : theme === 'way-of-water' ? waterRock
      : theme === 'modern-gallery' ? galleryCollage : undefined
    return <View id={`balanced-theme-experience-${surface}`} className={rootClass}>
      {art && <Image className='bt-scene bt-scene--chapter' src={art} mode='aspectFill' />}
      <View className='bt-chapter-heading'>{masthead}{heading}</View>{sceneRetry}
      {theme === 'way-of-water' && <Text className='bt-water-chapter-verse'>{surface === 'stats' ? '点滴汇聚，看见自己的节奏。' : surface === 'community' ? '不同的选择，也有回响。' : '每一次照顾自己，都留下痕迹。'}</Text>}
      {children && <View className='bt-integrated-content'>{children}</View>}
      {surface === 'community' && onPublish && <View className='bt-publish'>{action('publish', '分享我的一餐', '', 'icon-paizhao-xianxing', onPublish)}</View>}
    </View>
  }
  return <View id='balanced-theme-experience-home' className={rootClass}>{sceneRetry}
    {theme === 'miniature-world' && <>
      {miniatureGarden && <Image className='bt-scene' src={miniatureGarden} mode='aspectFill' />}{masthead}{heading}
      <View className='bt-garden-sign bt-garden-sign--meals'>{action('meals', '饮食花园', value(home?.mealCount, ' 餐 · 查看记录'), 'icon-foodshop', meals)}</View>
      <View className='bt-garden-sign bt-garden-sign--water'>{action('water', '营养河流', value(home?.waterMl, ' ml · 记录饮水'), 'icon-drink', water)}</View>
      <View className='bt-scene-footer'>{action('record', '拍下这一餐', '记录此刻的生活', 'icon-paizhao-xianxing', record)}</View>
    </>}
    {theme === 'picturebook-companion' && <>
      {picturebookDay && <Image className='bt-scene' src={picturebookDay} mode='aspectFill' />}{masthead}{heading}
      <View className='bt-chapter-label bt-chapter-label--morning'><Text>晨光开篇</Text><Text>好好吃早餐，是对自己的温柔。</Text></View>
      <View className='bt-chapter-label bt-chapter-label--noon' role='button' onClick={meals}><Text>午间相遇</Text><Text>{value(home?.mealCount, ' 餐已记下')} · 查看</Text></View>
      <View className='bt-scene-footer'>{action('record', '记录这一餐', '把日常，写成自己的故事', 'icon-paizhao-xianxing', record)}</View>
    </>}
    {theme === 'way-of-water' && <>
      {waterVessel && <Image className='bt-scene' src={waterVessel} mode='aspectFill' />}{masthead}{heading}
      <View className='bt-water-today' role='button' aria-label='查看今日饮食记录' onClick={meals}><Text>今日食记</Text><Text>{value(home?.mealCount, ' 餐')}</Text><Text>{home?.authenticated ? '点此回看' : '从第一餐开始'}</Text></View>
      <Text className='bt-water-motto'>水无定形 · 因势而行</Text>
      <View className='bt-water-actions'>{action('record', '记录饮食', '', 'icon-paizhao-xianxing', record)}{action('water', '饮水', value(home?.waterMl, ' ml'), 'icon-drink', water)}{action('stats', '观其流变', '', 'icon-shangzhang', stats)}</View>
    </>}
    {theme === 'natural-symbiosis' && <>
      {naturalLeaves && <Image className='bt-scene' src={naturalLeaves} mode='aspectFill' />}{masthead}{heading}
      <View className='bt-leaf-note bt-leaf-note--meals'>{action('meals', '今日饮食', value(home?.mealCount, ' 餐'), 'icon-foodshop', meals)}</View>
      <View className='bt-leaf-note bt-leaf-note--water'>{action('water', '再来一杯', value(home?.waterMl, ' ml'), 'icon-drink', water)}</View>
      <View className='bt-scene-footer'>{action('record', '种下一餐', '让更好的自己慢慢生长', 'icon-paizhao-xianxing', record)}</View>
    </>}
    {theme === 'eastern-salon' && <>
      <Image className='bt-eastern-landscape' src={easternLandscape} mode='aspectFill' />{masthead}{heading}
      <View className='bt-scroll'><View className='bt-scroll__plate'>{easternSoup && <Image src={easternSoup} mode='aspectFill' />}<View><Text>一盏清汤</Text><Text>四时皆宜 · 日常有味</Text><Text className='bt-art-caption'>食物灵感</Text></View></View>{summary}<Text className='bt-scroll__verse'>食养身心 · 自有节奏</Text>{action('record', '记一膳', '', 'icon-paizhao-xianxing', record)}</View>
    </>}
    {theme === 'modern-gallery' && <>
      {galleryCollage && <Image className='bt-scene' src={galleryCollage} mode='aspectFill' />}{masthead}{heading}
      <View className='bt-gallery-caption'><Text>一餐，也是作品。</Text><Text>食物灵感 / 日常的创作</Text></View>
      <View className='bt-gallery-bottom'>{summary}{action('record', '记录这餐', '', 'icon-paizhao-xianxing', record)}</View>
    </>}
    {theme === 'clarity-order' && <>
      {masthead}{heading}<View className='bt-clarity-photo'><Image src={clarityFood} mode='aspectFill' /><Text>餐桌灵感 / 简单，也很美味。</Text></View>{summary}{action('record', '记录饮食', '', 'icon-paizhao-xianxing', record)}
    </>}
    {theme === 'clear-care' && <>
      {masthead}<View className='bt-care-greeting'><Text>今天，也好好吃饭。</Text><Text>{PHILOSOPHY[theme]}</Text></View>
      <View className='bt-care-actions'>{action('recipes', '今天吃什么', '浏览食谱，寻找灵感', 'icon-foodshop', recipes)}{action('record', '记录一餐', '拍照或手动记录', 'icon-paizhao-xianxing', record)}{action('meals', '查看今日', '看看今天吃了什么', 'icon-shangzhang', meals)}</View>
      <View className='bt-care-summary'><Text>今日小结</Text><Text>{value(home?.mealCount, ' 餐已记录')}</Text><Text>每一餐，都是对自己的照顾。</Text></View>
    </>}
  </View>
}
