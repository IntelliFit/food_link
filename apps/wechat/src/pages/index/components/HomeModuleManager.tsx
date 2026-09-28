import { Button, ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState, type ReactNode } from 'react'
import { HOME_MODULES, defaultHomeModuleLayout, isHomeModuleVisible, moveHomeModule, type HomeModuleId, type HomeModuleLayout, type HomeModuleLocks } from '../utils/home-module-layout'
import './HomeModuleManager.scss'

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
      <View className='home-organizer__heading'><Text>整理首页</Text><Button onClick={onClose}>取消</Button></View>
      <Text className='home-organizer__hint'>拖动左侧手柄排序，开关控制显示。日期始终留在顶部。</Text>
      <ScrollView scrollY={!dragging} className='home-organizer__list'>
        {draft.order.map((id, index) => {
          const item = HOME_MODULES.find(module => module.id === id)!
          const lock = locks[id]
          return <View key={id} className={`home-organizer__row${dragging === id ? ' is-dragging' : ''}`}>
            <View className='home-organizer__handle' role='button' aria-label={`拖动${item.label}排序`} catchMove
              onTouchStart={event => { const y = touchY(event); if (y != null) { drag.current = { id, y }; setDragging(id) } }}
              onTouchMove={event => {
                const current = drag.current; const y = touchY(event)
                if (!current || y == null) return
                const rowHeight = Taro.getSystemInfoSync().windowWidth / 750 * 112
                const delta = y - current.y
                if (Math.abs(delta) >= rowHeight * .65) { move(current.id, delta > 0 ? 1 : -1); current.y = y }
              }} onTouchEnd={stop} onTouchCancel={stop}
            >≡</View>
            <View className='home-organizer__copy'><Text className='home-organizer__title'>{item.label}</Text><Text className='home-organizer__description'>{lock || item.description}</Text></View>
            <View className='home-organizer__arrows'><Button disabled={index === 0} aria-label={`上移${item.label}`} onClick={() => move(id, -1)}>↑</Button><Button disabled={index === draft.order.length - 1} aria-label={`下移${item.label}`} onClick={() => move(id, 1)}>↓</Button></View>
            <Switch checked={isHomeModuleVisible(draft, id, locks)} disabled={Boolean(lock)} color='#0fb47c' aria-label={`显示${item.label}`} onChange={event => setDraft(previous => ({ ...previous, hidden: event.detail.value ? previous.hidden.filter(key => key !== id) : [...previous.hidden.filter(key => key !== id), id] }))} />
          </View>
        })}
      </ScrollView>
      <View className='home-organizer__footer'><Button className='home-organizer__reset' onClick={() => setDraft(defaultHomeModuleLayout())}>恢复默认</Button><Button className='home-organizer__save' onClick={() => onSave(draft)}>完成</Button></View>
    </View>
  </View>
}
