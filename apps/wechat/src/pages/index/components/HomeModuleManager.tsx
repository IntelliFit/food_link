import { Button, ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState, type ReactNode } from 'react'
import {
  HOME_MODULES,
  HOME_QUICK_STATS,
  defaultHomeModuleLayout,
  isHomeModuleVisible,
  moveHomeModule,
  toggleHomeQuickStat,
  type HomeModuleId,
  type HomeLayoutDensity,
  type HomeModuleLayout,
  type HomeModuleLocks,
} from '../utils/home-module-layout'
import './HomeModuleManager.scss'

const DENSITY_OPTIONS: Array<{ id: HomeLayoutDensity; label: string }> = [
  { id: 'smart', label: '智能' },
  { id: 'comfortable', label: '舒展' },
  { id: 'compact', label: '紧凑' },
]

const MODULE_ICONS: Record<HomeModuleId, string> = {
  diet: 'icon-canciguanli',
  nextMeal: 'icon-a-144-lvye',
  body: 'icon-weight-scale',
  supplements: 'icon-danbaizhi',
  expiry: 'icon-kefulan',
  rewards: 'icon-picture',
  meals: 'icon-canciguanli',
  recap: 'icon-weibiaoti1',
}

const QUICK_ICONS = {
  weight: 'icon-weight-scale',
  water: 'icon-drink',
  exercise: 'icon-dumbbell',
  sleep: 'icon-a-144-lvye',
} as const

function touchY(event: unknown): number | null {
  return (event as { touches?: Array<{ clientY: number }> }).touches?.[0]?.clientY ?? null
}

export function HomeModule({ id, layout, locks, children }: { id: HomeModuleId; layout: HomeModuleLayout; locks: HomeModuleLocks; children: ReactNode }) {
  if (!isHomeModuleVisible(layout, id, locks)) return null
  return <View id={`home-module-${id}`} className='home-module' style={{ order: layout.order.indexOf(id) }}>{children}</View>
}

export function HomeModuleManager({ layout, locks, onSave, onClose }: { layout: HomeModuleLayout; locks: HomeModuleLocks; onSave: (next: HomeModuleLayout) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(layout)
  const [dragging, setDragging] = useState<HomeModuleId | null>(null)
  const drag = useRef<{ id: HomeModuleId; y: number } | null>(null)
  const move = (id: HomeModuleId, steps: number) => setDraft(previous => moveHomeModule(previous, id, steps))
  const stop = () => { drag.current = null; setDragging(null) }
  return <View className='home-organizer' catchMove>
    <View className='home-organizer__mask' onClick={onClose} />
    <View className='home-organizer__sheet' role='dialog' aria-label='整理首页'>
      <View className='home-organizer__grabber' />
      <View className='home-organizer__heading'>
        <View><Text className='home-organizer__heading-title'>整理首页</Text><Text className='home-organizer__hint'>选择内容，拖动调整顺序</Text></View>
        <Button className='home-organizer__button home-organizer__close' aria-label='关闭整理首页' onClick={onClose}><Text className='iconfont icon-close' /></Button>
      </View>
      <View className='home-organizer__summary'>
        <Text className='iconfont icon-a-144-lvye home-organizer__summary-spark' />
        <Text>当前：{DENSITY_OPTIONS.find(item => item.id === draft.density)?.label}布局 · {draft.quickStats.length} 项快捷</Text>
      </View>
      <View className='home-organizer__density'>
        <Text className='home-organizer__section-label'>布局密度</Text>
        <View className='home-organizer__density-options'>
          {DENSITY_OPTIONS.map(item => (
            <View key={item.id} className={`home-organizer__density-option${draft.density === item.id ? ' is-selected' : ''}`} onClick={() => setDraft(previous => ({ ...previous, density: item.id }))}>
              {item.id === 'smart' ? <Text className='iconfont icon-a-144-lvye' /> : null}
              <Text>{item.label}</Text>
            </View>
          ))}
        </View>
        <Text className='home-organizer__density-hint'>{draft.density === 'smart' ? '内容多时自动使用横滑和紧凑列表' : draft.density === 'compact' ? '缩短模块间距，同屏查看更多内容' : '增加留白，阅读节奏更舒缓'}</Text>
      </View>
      <View className='home-organizer__quick'>
        <View className='home-organizer__quick-heading'>
          <View>
            <Text className='home-organizer__quick-title'>快捷数据卡</Text>
            <Text className='home-organizer__quick-description'>1–3 项一行铺满，4 项自动排成两行</Text>
          </View>
          <Text className='home-organizer__quick-count'>已选 {draft.quickStats.length}</Text>
        </View>
        <View className='home-organizer__quick-grid'>
          {HOME_QUICK_STATS.map(item => {
            const checked = draft.quickStats.includes(item.id)
            return <View key={item.id} className={`home-organizer__quick-item${checked ? ' is-selected' : ''}`}>
              <View className='home-organizer__quick-copy'><Text className={`iconfont ${QUICK_ICONS[item.id]}`} /><Text>{item.label}</Text></View>
              <Switch
                className='home-organizer__switch'
                checked={checked}
                color='#0fb47c'
                aria-label={`显示${item.label}`}
                onChange={event => setDraft(previous => toggleHomeQuickStat(previous, item.id, event.detail.value))}
              />
            </View>
          })}
        </View>
      </View>
      <ScrollView scrollY={!dragging} className='home-organizer__list'>
        {draft.order.map((id, index) => {
          const item = HOME_MODULES.find(module => module.id === id)!
          const lock = locks[id]
          const quickStatsRow = id === 'body'
          return <View key={id} className={`home-organizer__row${dragging === id ? ' is-dragging' : ''}`}>
            <View className='home-organizer__handle' role='button' aria-label={`拖动${item.label}排序`} catchMove
              onTouchStart={event => { const y = touchY(event); if (y != null) { drag.current = { id, y }; setDragging(id) } }}
              onTouchMove={event => {
                const current = drag.current; const y = touchY(event)
                if (!current || y == null) return
                const rowHeight = Taro.getSystemInfoSync().windowWidth / 750 * 100
                const delta = y - current.y
                if (Math.abs(delta) >= rowHeight * .65) { move(current.id, delta > 0 ? 1 : -1); current.y = y }
              }} onTouchEnd={stop} onTouchCancel={stop}
            ><Text className='iconfont icon-all' /></View>
            <View className='home-organizer__module-icon'><Text className={`iconfont ${MODULE_ICONS[id]}`} /></View>
            <View className='home-organizer__copy'><Text className='home-organizer__title'>{item.label}</Text><Text className='home-organizer__description'>{quickStatsRow ? `${draft.quickStats.length} 项快捷记录 · 在上方分别选择` : lock || item.description}</Text></View>
            <View className='home-organizer__arrows'><Button className='home-organizer__button' disabled={index === 0} aria-label={`上移${item.label}`} onClick={() => move(id, -1)}>↑</Button><Button className='home-organizer__button' disabled={index === draft.order.length - 1} aria-label={`下移${item.label}`} onClick={() => move(id, 1)}>↓</Button></View>
            {quickStatsRow
              ? <Text className='home-organizer__quick-row-count'>{draft.quickStats.length} 项</Text>
              : <Switch className='home-organizer__switch' checked={isHomeModuleVisible(draft, id, locks)} disabled={Boolean(lock)} color='#0fb47c' aria-label={`显示${item.label}`} onChange={event => setDraft(previous => ({ ...previous, hidden: event.detail.value ? previous.hidden.filter(key => key !== id) : [...previous.hidden.filter(key => key !== id), id] }))} />}
          </View>
        })}
      </ScrollView>
      <View className='home-organizer__footer'><Button className='home-organizer__button home-organizer__reset' onClick={() => setDraft(defaultHomeModuleLayout())}>恢复默认</Button><Button className='home-organizer__button home-organizer__save' onClick={() => onSave(draft)}>完成</Button></View>
    </View>
  </View>
}
