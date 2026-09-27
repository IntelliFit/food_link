import { Image, Text, View } from '@tarojs/components'
import React from 'react'
import { useInkWellness } from './InkWellness'
import { useBalancedTheme } from './BalancedThemeContext'
import { type BalancedThemeId, getBalancedThemeDefinition } from '../utils/balanced-theme'

import './BalancedThemeExperience.scss'
import clarityFood from '../assets/wellness/food-scan-banner.jpg'

export type BalancedThemeSurface = 'home' | 'stats' | 'community' | 'profile'

const SURFACE_LABELS: Record<BalancedThemeSurface, string> = {
  home: '今日',
  stats: '观测',
  community: '相遇',
  profile: '收藏',
}

type SurfaceStory = {
  index: string
  title: string
  subtitle: string
  action: string
  tags: [string, string, string]
  stages: [string, string, string]
}

const THEME_SURFACE_STORIES: Record<BalancedThemeId, Record<BalancedThemeSurface, SurfaceStory>> = {
  'clarity-order': {
    home: { index: '01', title: '好好吃饭\n是更好的自己', subtitle: '清晰选择，让每一餐靠近理想的生活。', action: '记录饮食', tags: ['摄入', '目标', '建议'], stages: ['先看今天', '聚焦一餐', '开始记录'] },
    stats: { index: '02', title: '本周趋势', subtitle: '让变化一目了然', action: '查看', tags: ['周', '构成', '趋势'], stages: ['总览变化', '拆解构成', '找到重点'] },
    community: { index: '03', title: '饮食故事', subtitle: '真实分享，理性讨论', action: '阅读', tags: ['推荐', '关注', '话题'], stages: ['浏览故事', '聚焦作者', '参与讨论'] },
    profile: { index: '04', title: '个人档案', subtitle: '把记录归入秩序', action: '整理', tags: ['记录', '收藏', '设置'], stages: ['查看档案', '整理收藏', '管理偏好'] },
  },
  'natural-symbiosis': {
    home: { index: '01', title: '今日生长', subtitle: '每一餐，都是新的一圈', action: '种下一餐', tags: ['饮食叶', '饮水芽', '步行枝'], stages: ['萌芽', '舒展', '共生'] },
    stats: { index: '02', title: '季节年轮', subtitle: '看见饮食与生活的自然节奏', action: '看年轮', tags: ['春启', '夏长', '秋收'], stages: ['辨认纹理', '顺应节律', '持续生长'] },
    community: { index: '03', title: '自然手记', subtitle: '交换餐桌上的风景', action: '翻手记', tags: ['时令', '餐桌', '共生'], stages: ['采集风景', '写下观察', '分享生长'] },
    profile: { index: '04', title: '我的标本册', subtitle: '收藏自然馈赠，也收藏改变', action: '开标本册', tags: ['足迹', '收藏', '偏好'], stages: ['拾起一叶', '压进册页', '留住时光'] },
  },
  'eastern-salon': {
    home: { index: '壹', title: '今日膳事', subtitle: '知味 · 知量 · 知己', action: '记一膳', tags: ['时令', '清供', '膳心'], stages: ['一餐一世界', '食有节，心有度', '烟火亦清欢'] },
    stats: { index: '贰', title: '山水食序', subtitle: '以食为线，见山河', action: '观食序', tags: ['清浊', '浓淡', '起伏'], stages: ['循水而观', '见其起伏', '顺势而食'] },
    community: { index: '叁', title: '雅集同游', subtitle: '谈饮食，也谈生活', action: '赴雅集', tags: ['题跋', '同游', '清谈'], stages: ['以食会友', '以文记味', '相与同游'] },
    profile: { index: '肆', title: '我的清供', subtitle: '食养身心，自有清供', action: '启屉柜', tags: ['记录', '收藏', '计划'], stages: ['归置日常', '收藏知味', '自有节奏'] },
  },
  'modern-gallery': {
    home: { index: '01', title: '今日作品', subtitle: '每一餐都在创造生活', action: '创作', tags: ['食物', '构成', '瞬间'], stages: ['选择素材', '重组画面', '完成作品'] },
    stats: { index: '02', title: '数据展厅', subtitle: '把变化挂上墙', action: '观展', tags: ['趋势', '比例', '评价'], stages: ['进入展厅', '移动视点', '看见关系'] },
    community: { index: '03', title: '公共展场', subtitle: '和更多热爱生活的人相遇', action: '入场', tags: ['作者', '作品', '讨论'], stages: ['发现作品', '阅读展签', '留下回应'] },
    profile: { index: '04', title: '个人典藏', subtitle: '关于我，也关于选择的生活', action: '开档案匣', tags: ['记录', '收藏', '设置'], stages: ['建立档案', '选择典藏', '持续策展'] },
  },
  'miniature-world': {
    home: { index: '01', title: '饮食花园', subtitle: '从一餐出发', action: '进入花园', tags: ['温室', '河流', '果园'], stages: ['打开地图', '走进花园', '记录发现'] },
    stats: { index: '02', title: '营养河流', subtitle: '看见一周的流动', action: '沿河探索', tags: ['上游', '汇流', '河口'], stages: ['从上游出发', '经过七日', '抵达汇流'] },
    community: { index: '03', title: '邻里广场', subtitle: '好食物让人相遇', action: '逛广场', tags: ['市集', '长桌', '公告'], stages: ['走进广场', '遇见邻里', '分享故事'] },
    profile: { index: '04', title: '旅行者档案', subtitle: '收藏生活的每一次改变', action: '打开行囊', tags: ['足迹', '收藏', '手记'], stages: ['整理足迹', '收进行囊', '继续探索'] },
  },
  'picturebook-companion': {
    home: { index: '第一章', title: '今天这一章', subtitle: '平凡的一天，也有好味道', action: '记录这一餐', tags: ['早餐', '午餐', '晚餐'], stages: ['晨光开篇', '午后转场', '夜色收束'] },
    stats: { index: '第二章', title: '七日片段', subtitle: '一周三餐，拼成更好的自己', action: '播放片段', tags: ['清晨', '午间', '夜晚'], stages: ['翻看胶片', '停在一刻', '读懂一周'] },
    community: { index: '第三章', title: '一起走过', subtitle: '不同的食光，不同的自己', action: '读故事', tags: ['相遇', '同行', '回声'], stages: ['遇见一页', '走进故事', '留下回声'] },
    profile: { index: '第四章', title: '我的故事', subtitle: '记录不是完成，而是记得', action: '翻开目录', tags: ['章节', '收藏', '尾声'], stages: ['写下日常', '收藏片段', '继续下一章'] },
  },
  'clear-care': {
    home: { index: '01', title: '今天吃什么', subtitle: '简单选择，吃得健康', action: '开始', tags: ['推荐', '记录一餐', '查看今日'], stages: ['先做一件事', '文字看清楚', '操作更直接'] },
    stats: { index: '02', title: '本周变化', subtitle: '一眼看懂，吃得更好', action: '听一听', tags: ['本周', '比上周', '建议'], stages: ['先看结论', '再看变化', '最后看建议'] },
    community: { index: '03', title: '朋友分享', subtitle: '看大家怎么吃，互相鼓励', action: '看分享', tags: ['一屏一帖', '大图', '大按钮'], stages: ['看清作者', '读完内容', '轻松互动'] },
    profile: { index: '04', title: '我的设置', subtitle: '简单清晰，用得安心', action: '打开设置', tags: ['家人联系', '隐私安全', '使用设置'], stages: ['找到分类', '确认选项', '安心使用'] },
  },
  'way-of-water': {
    home: { index: '01', title: '今日流动', subtitle: '每一口，都在扩散', action: '点入水面', tags: ['饮食', '运动', '身心'], stages: ['水无定形', '因势而行', '汇入日常'] },
    stats: { index: '02', title: '一周汇流', subtitle: '点滴汇聚，生长新我', action: '观其流变', tags: ['水滴', '波形', '汇流'], stages: ['看见一滴', '追随波动', '理解汇流'] },
    community: { index: '03', title: '相遇成河', subtitle: '不同选择，也有同响', action: '进入静水', tags: ['相遇', '涟漪', '同响'], stages: ['一念入水', '涟漪相遇', '汇流成河'] },
    profile: { index: '04', title: '我的路径', subtitle: '随形而行，方能长久', action: '沿流而下', tags: ['数据', '收藏', '圈子'], stages: ['辨认来处', '经过当下', '继续流动'] },
  },
}

export function BalancedThemeExperience({ surface }: { surface: BalancedThemeSurface }): React.ReactElement | null {
  const wellness = useInkWellness()
  const { theme } = useBalancedTheme()
  const definition = getBalancedThemeDefinition(theme)
  const story = THEME_SURFACE_STORIES[theme][surface]
  const [stage, setStage] = React.useState(0)

  React.useEffect(() => setStage(0), [surface, theme])
  if (wellness) return null

  const nextStage = () => setStage((value) => (value + 1) % 3)
  const label = SURFACE_LABELS[surface]
  const commonProps = {
    id: `balanced-theme-experience-${surface}`,
    role: 'button',
    'aria-label': `${definition.name}主题特色，${definition.interactionHint}`,
    onClick: nextStage,
  } as const

  if (theme === 'clarity-order') {
    const clarityBars = [54, 72, 48, 62, 58, 78, 66]
    return (
      <View {...commonProps} className={`bt-experience bt-experience--clarity bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-clarity__masthead'>
          <Text className='bt-clarity__brand'>食探</Text>
          <Text className='bt-clarity__promise'>{surface === 'home' ? '让食物回归清晰' : surface === 'stats' ? '数据，让选择更清晰' : surface === 'community' ? '真实分享，理性讨论' : '成为更清晰的自己'}</Text>
          <View className='bt-clarity__meta'><Text>FL / {story.index}</Text><Text>{label}</Text></View>
        </View>
        {surface === 'home' && (
          <>
            <View className='bt-clarity__composition'>
              <View className='bt-clarity__lead'>
                {story.title.split('\n').map((line) => <Text key={line} className='bt-clarity__headline'>{line}</Text>)}
                <Text className='bt-clarity__subtitle'>{story.subtitle}</Text>
              </View>
              <View className='bt-clarity__index-card'>
                <Text className='bt-clarity__focus'>{String(stage + 1).padStart(2, '0')}</Text>
                <Text>{story.tags[stage]}</Text>
                <Text>{story.stages[stage]}</Text>
              </View>
            </View>
            <View className='bt-clarity__food-frame'>
              <Image src={clarityFood} mode='aspectFill' />
              <View><Text>今日推荐</Text><Text>清爽谷物时蔬碗</Text></View>
            </View>
            <View className='bt-clarity__summary-strip'>
              <View><Text>饮食记录</Text><Text>清晰整理</Text></View>
              <View><Text>营养构成</Text><Text>一眼可见</Text></View>
              <View><Text>今日建议</Text><Text>专注一件事</Text></View>
            </View>
          </>
        )}

        {surface === 'stats' && (
          <View className='bt-clarity__surface-body bt-clarity__surface-body--stats'>
            <View className='bt-clarity__surface-title'><Text>{story.title}</Text><Text>{story.subtitle}</Text></View>
            <View className='bt-clarity__tabs'><Text className='is-active'>周</Text><Text>月</Text><Text>年</Text></View>
            <View className='bt-clarity__chart'>
              {clarityBars.map((height, index) => (
                <View key={height + index} className='bt-clarity__bar-column'>
                  <View className='bt-clarity__bar' style={{ height: `${height}%` }}><View /><View /><View /></View>
                  <Text>{index + 1}</Text>
                </View>
              ))}
            </View>
            <View className='bt-clarity__insight'><Text>本周趋势</Text><Text>规律正在形成，继续保持。</Text></View>
          </View>
        )}

        {surface === 'community' && (
          <View className='bt-clarity__surface-body bt-clarity__surface-body--community'>
            <View className='bt-clarity__surface-title'><Text>{story.title}</Text><Text>{story.subtitle}</Text></View>
            <View className='bt-clarity__tabs'><Text className='is-active'>推荐</Text><Text>关注</Text><Text>话题</Text></View>
            <View className='bt-clarity__story-card'>
              <Image src={clarityFood} mode='aspectFill' />
              <View className='bt-clarity__story-copy'><Text>一份简单而干净的午餐</Text><Text>食物连接生活，也连接有趣的人。</Text></View>
            </View>
          </View>
        )}

        {surface === 'profile' && (
          <View className='bt-clarity__surface-body bt-clarity__surface-body--profile'>
            <View className='bt-clarity__surface-title'><Text>{story.title}</Text><Text>{story.subtitle}</Text></View>
            <View className='bt-clarity__profile-card'>
              <View className='bt-clarity__avatar'>FL</View>
              <View><Text>我的饮食档案</Text><Text>把每一次认真生活收进这里</Text></View>
              <Text>→</Text>
            </View>
            <View className='bt-clarity__file-list'>
              <View><Text>饮食记录</Text><Text>查看每日整理 →</Text></View>
              <View><Text>收藏内容</Text><Text>继续探索灵感 →</Text></View>
              <View><Text>目标与偏好</Text><Text>管理个人选择 →</Text></View>
            </View>
          </View>
        )}
        <View className='bt-clarity__action'><Text>{story.action}</Text><Text>→</Text></View>
        <Text className='bt-experience__hint'>轻触切换重点</Text>
      </View>
    )
  }

  if (theme === 'natural-symbiosis') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--nature bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-nature__rings'><View /><View /><View /></View>
        <View className='bt-nature__stem'>
          <View className='bt-nature__leaf bt-nature__leaf--one' />
          <View className='bt-nature__leaf bt-nature__leaf--two' />
          <View className='bt-nature__leaf bt-nature__leaf--three' />
        </View>
        <View className='bt-nature__copy'><Text>{story.title}</Text><Text>{story.subtitle}</Text><Text className='bt-nature__tag'>{story.tags[stage]} · {story.stages[stage]}</Text></View>
        <Text className='bt-experience__hint'>轻触，让叶片生长</Text>
      </View>
    )
  }

  if (theme === 'eastern-salon') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--eastern bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-eastern__roller bt-eastern__roller--left' />
        <View className='bt-eastern__paper'>
          <View className='bt-eastern__title'><Text>{story.index}</Text><Text>{story.title}</Text></View>
          <Text className='bt-eastern__verse'>{story.stages[stage]}</Text>
          <Text className='bt-eastern__subtitle'>{story.subtitle}</Text>
          <View className='bt-eastern__seal'><Text>食探</Text></View>
        </View>
        <View className='bt-eastern__roller bt-eastern__roller--right' />
        <Text className='bt-experience__hint'>轻触展卷</Text>
      </View>
    )
  }

  if (theme === 'modern-gallery') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--gallery bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-gallery__blue'><Text>{story.index}</Text><Text>{label}</Text></View>
        <View className='bt-gallery__black'><Text>{story.tags[stage]}</Text></View>
        <View className='bt-gallery__paper'><Text>{story.title}</Text><Text>{story.subtitle}</Text></View>
        <View className='bt-gallery__red'><Text>{story.action}</Text></View>
        <View className='bt-gallery__yellow' />
        <Text className='bt-experience__hint'>轻触重组这幅作品</Text>
      </View>
    )
  }

  if (theme === 'miniature-world') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--miniature bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-miniature__sky'><Text>{story.title}</Text><Text>{story.subtitle}</Text></View>
        <View className='bt-miniature__island'>
          <View className='bt-miniature__river' />
          <View className='bt-miniature__path'><View /><View /><View /></View>
          <View className='bt-miniature__tree bt-miniature__tree--one' />
          <View className='bt-miniature__tree bt-miniature__tree--two' />
          <View className='bt-miniature__traveler'><Text>●</Text></View>
        </View>
        <View className='bt-miniature__signs'>{story.tags.map((tag, index) => <Text key={tag} className={index === stage ? 'is-active' : ''}>{tag}</Text>)}</View>
        <Text className='bt-experience__hint'>轻触移动旅行标记</Text>
      </View>
    )
  }

  if (theme === 'picturebook-companion') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--picturebook bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-picturebook__binding'><View /><View /><View /></View>
        <View className='bt-picturebook__page bt-picturebook__page--front'>
          <Text className='bt-picturebook__chapter'>{story.index}</Text>
          <Text className='bt-picturebook__title'>{story.title}</Text>
          <Text className='bt-picturebook__subtitle'>{story.subtitle}</Text>
          <View className='bt-picturebook__frame'><View className='bt-picturebook__sun' /><View className='bt-picturebook__road' /></View>
        </View>
        <View className='bt-picturebook__page bt-picturebook__page--back'><Text>{story.stages[stage]}。{story.action}。</Text></View>
        <Text className='bt-experience__hint'>轻触翻一页</Text>
      </View>
    )
  }

  if (theme === 'clear-care') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--care bt-experience--${surface} is-stage-${stage}`}>
        <View className='bt-care__brand'><Text>食探</Text><Text>清朗关怀</Text><Text>2026年 9月27日</Text></View>
        <View className='bt-care__number'><Text>{story.index}</Text></View>
        <View className='bt-care__copy'><Text>{story.title}</Text><Text>{story.stages[stage]}</Text><Text className='bt-care__tag'>{story.tags[stage]}</Text></View>
        <View className='bt-care__action'><Text>{story.action}</Text><Text>→</Text></View>
      </View>
    )
  }

  return (
    <View {...commonProps} className={`bt-experience bt-experience--water bt-experience--${surface} is-stage-${stage}`}>
      <View className='bt-water__pool'>
        <View className='bt-water__ripple bt-water__ripple--one' />
        <View className='bt-water__ripple bt-water__ripple--two' />
        <View className='bt-water__ripple bt-water__ripple--three' />
        <View className='bt-water__stone'><Text>{story.index}</Text></View>
      </View>
      <View className='bt-water__copy'><Text>{story.title}</Text><Text>{story.stages[stage]}</Text><Text>{story.subtitle}</Text></View>
      <Text className='bt-experience__hint'>轻触水面</Text>
    </View>
  )
}
