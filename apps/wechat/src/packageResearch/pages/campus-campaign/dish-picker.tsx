import { Input, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { searchCampaignDishes, type CampaignDish } from '../../../utils/campus-campaign-api'

export interface PickedDish {
  catalogItemId: string
  name: string
}

interface DishPickerProps {
  campaignId: string
  onPick: (dish: PickedDish) => void
  onClose: () => void
}

const dishPlace = (dish: CampaignDish) =>
  [dish.canteen_name, dish.floor, dish.window_name].map((part) => String(part || '').trim()).filter(Boolean).join(' · ')

/** 在本校食堂的菜里搜一道；直接查食堂菜品库，选中的一定能计入活动。 */
export function DishPicker({ campaignId, onPick, onClose }: DishPickerProps) {
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<CampaignDish[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState('')
  const latest = useRef(0)

  useEffect(() => {
    const ticket = latest.current + 1
    latest.current = ticket
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const found = await searchCampaignDishes(campaignId, keyword)
        if (latest.current === ticket) {
          setItems(found)
          setFailed('')
        }
      } catch (error: any) {
        if (latest.current === ticket) setFailed(error?.message || '搜索失败，请重试')
      } finally {
        if (latest.current === ticket) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, campaignId])

  return (
    <View className='cc-sheet'>
      <View className='cc-sheet__head'>
        <Text className='cc-sheet__title'>这一餐是哪道菜</Text>
        <Text className='cc-sheet__close' onClick={onClose}>关闭</Text>
      </View>
      <Input className='rw-input' value={keyword} placeholder='搜菜名，如 宫保鸡丁、番茄炒蛋' onInput={(e) => setKeyword(e.detail.value)} />
      {loading ? <View className='cc-sheet__loading'><View className='loading-spinner-dark' /></View> : null}
      {!loading && failed ? <Text className='rw-tip'>{failed}</Text> : null}
      {!loading && !failed && items.length === 0 ? (
        <Text className='rw-tip'>{keyword.trim() ? '食堂菜单里没有这道菜，换个叫法试试；还没采的窗口可以让社团的采集同学先采上来。' : '输入菜名开始搜'}</Text>
      ) : null}
      {!loading && !failed && items[0]?.close ? (
        <Text className='rw-tip'>{`菜单里没有叫「${keyword.trim()}」的菜，下面是名字相近的，选最接近的一道。`}</Text>
      ) : null}
      {items.map((dish) => (
        <View key={dish.id} className='cc-dish' onClick={() => onPick({ catalogItemId: dish.id, name: dish.name })}>
          <Text className='cc-dish__name'>{dish.name}</Text>
          {dishPlace(dish) ? <Text className='cc-dish__place'>{dishPlace(dish)}</Text> : null}
        </View>
      ))}
    </View>
  )
}
