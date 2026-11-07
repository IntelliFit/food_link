import { Input, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { getPublicFoodLibraryList, type PublicFoodLibraryItem } from '../../../utils/api'

export interface PickedDish {
  catalogItemId: string
  name: string
}

interface DishPickerProps {
  schoolId: string
  onPick: (dish: PickedDish) => void
  onClose: () => void
}

const dishName = (item: PublicFoodLibraryItem) => String(item.food_name || '').trim()
const dishPlace = (item: PublicFoodLibraryItem) =>
  [item.canteen_name, item.window_name].map((part) => String(part || '').trim()).filter(Boolean).join(' · ')

/** 在本校食堂菜品里搜一道菜；只列出能对上食堂目录的菜。 */
export function DishPicker({ schoolId, onPick, onClose }: DishPickerProps) {
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<PublicFoodLibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    const ticket = latest.current + 1
    latest.current = ticket
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const { list } = await getPublicFoodLibraryList({ is_campus_food: true, school_id: schoolId, keyword: keyword.trim() || undefined, limit: 30 })
        if (latest.current === ticket) setItems((list || []).filter((item) => item.catalog_item_id))
      } catch (error) {
        console.warn('[campus-campaign] dish search failed', error)
      } finally {
        if (latest.current === ticket) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, schoolId])

  return (
    <View className='cc-sheet'>
      <View className='cc-sheet__head'>
        <Text className='cc-sheet__title'>选一道本校食堂的菜</Text>
        <Text className='cc-sheet__close' onClick={onClose}>关闭</Text>
      </View>
      <Input className='rw-input' value={keyword} placeholder='搜菜名，如 宫保鸡丁' onInput={(e) => setKeyword(e.detail.value)} />
      {loading ? <View className='cc-sheet__loading'><View className='loading-spinner-dark' /></View> : null}
      {!loading && items.length === 0 ? <Text className='rw-tip'>没找到这道菜，可以先让社团的采集同学把这个窗口的菜单采上来</Text> : null}
      {items.map((item) => (
        <View key={item.id} className='cc-dish' onClick={() => onPick({ catalogItemId: String(item.catalog_item_id), name: dishName(item) })}>
          <Text className='cc-dish__name'>{dishName(item)}</Text>
          {dishPlace(item) ? <Text className='cc-dish__place'>{dishPlace(item)}</Text> : null}
        </View>
      ))}
    </View>
  )
}
