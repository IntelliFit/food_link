import { View, Text, Image } from '@tarojs/components'
import { IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../../components/iconfont'
import { getCachedMealFullRecord } from '../../../utils/api'
import type { HomeMealItem, HomeMealRecordEntry } from '../../../utils/api'
import { formatDisplayNumber } from '../utils/helpers'

const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#00bc7d', bgColor: '#ecfdf5', label: '早餐', iconClass: 'icon-zaocan1' },
  morning_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  lunch: { Icon: IconLunch, color: '#00bc7d', bgColor: '#ecfdf5', label: '午餐', iconClass: 'icon-wucan' },
  afternoon_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  dinner: { Icon: IconDinner, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚餐', iconClass: 'icon-wancan' },
  evening_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '零食', iconClass: 'icon-lingshi' }
} as const

function formatEntryTime(recordTime?: string): string {
  if (!recordTime) return ''
  try {
    const d = new Date(recordTime)
    if (Number.isNaN(d.getTime())) return ''
    const h = d.getHours()
    const m = d.getMinutes()
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  } catch {
    return ''
  }
}

interface MealRecordsDialogProps {
  visible: boolean
  meal: HomeMealItem | null
  onClose: () => void
  onSelectRecord: (recordId: string) => void
}

export function MealRecordsDialog({ visible, meal, onClose, onSelectRecord }: MealRecordsDialogProps) {
  if (!visible || !meal) return null

  const config = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
  const { Icon, color, bgColor, label } = config
  const entries = (Array.isArray(meal.meal_record_entries) ? meal.meal_record_entries.filter((e) => e && String(e.id || '').trim()) : []) as HomeMealRecordEntry[]
  // 按提交时间 created_at 从早到晚排序（fallback 到用餐时间 record_time）
  const sortedEntries = [...entries].sort((a, b) => {
    const timeA = a.full_record?.created_at || a.record_time || ''
    const timeB = b.full_record?.created_at || b.record_time || ''
    return new Date(timeA).getTime() - new Date(timeB).getTime()
  })
  const count = sortedEntries.length

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content meal-records-dialog-content'>
        <View className='record-menu-handle-bar' />

        {/* 标题：餐次图标 + 名称 + 记录次数 */}
        <View className='meal-records-dialog-header'>
          <View className='meal-records-dialog-title-wrap'>
            <Icon size={22} color={color} />
            <Text className='meal-records-dialog-title'>{label}</Text>
            <Text className='meal-records-dialog-count'>{count}条记录</Text>
          </View>
        </View>

        {/* 记录列表 */}
        <View className='meal-record-entries'>
          {sortedEntries.map((entry) => {
            const cachedFull = getCachedMealFullRecord(entry.id)
            // 每条记录只使用自己的图片，不 fallback 到餐次级别图片，避免同餐多条记录显示同一张图
            const imageUrl = cachedFull?.image_path || ''
            const hasImage = !!imageUrl
            const time = formatEntryTime(entry.record_time)
            const totalCalories = entry.total_calories ?? 0
            const protein = cachedFull?.total_protein ?? 0
            const carbs = cachedFull?.total_carbs ?? 0
            const fat = cachedFull?.total_fat ?? 0
            // title 兜底：优先 entry.title，其次缓存的 full_record 中的食物名/description，最后餐次名
            const title = (entry.title || '').trim()
              || (cachedFull?.items?.[0]?.name || '').trim()
              || (cachedFull?.description || '').trim().split('\n')[0]
              || label

            return (
              <View
                key={entry.id}
                className='meal-record-entry'
                onClick={() => onSelectRecord(entry.id)}
              >
                {/* 缩略图 */}
                <View className={`meal-record-entry-thumb ${hasImage ? 'is-photo' : 'is-icon'}`}>
                  {hasImage ? (
                    <Image
                      className='meal-record-entry-image'
                      src={imageUrl}
                      mode='aspectFill'
                    />
                  ) : (
                    <View className='meal-record-entry-icon' style={{ backgroundColor: bgColor }}>
                      <Icon size={22} color={color} />
                    </View>
                  )}
                </View>

                {/* 内容区 */}
                <View className='meal-record-entry-content'>
                  {/* 第一行：标题 + 时间 */}
                  <View className='meal-record-entry-header'>
                    <Text className='meal-record-entry-title' numberOfLines={1}>{title}</Text>
                    {time ? (
                      <View className='meal-time-pill'>
                        <Text className='meal-time-pill-text'>{time}</Text>
                      </View>
                    ) : null}
                  </View>
                  {/* 第二行：卡路里 */}
                  <View className='meal-record-entry-cal-row'>
                    <Text className='iconfont icon-huore' style={{ color: '#f0985c', fontSize: '22rpx', marginRight: '4rpx' }} />
                    <Text className='meal-record-entry-cal'>
                      {formatDisplayNumber(totalCalories)}
                      <Text className='meal-calorie-unit'> kcal</Text>
                    </Text>
                  </View>
                  {/* 第三行：营养素 */}
                  <View className='meal-record-entry-macros'>
                    <View className='meal-macro-pill'>
                      <Text className='iconfont icon-danbaizhi' style={{ color: '#5c9ed4', fontSize: '20rpx', marginRight: '4rpx' }} />
                      <Text className='meal-macro-text'>{formatDisplayNumber(protein)}g</Text>
                    </View>
                    <View className='meal-macro-pill'>
                      <Text className='iconfont icon-tanshui-dabiao' style={{ color: '#dcac52', fontSize: '20rpx', marginRight: '4rpx' }} />
                      <Text className='meal-macro-text'>{formatDisplayNumber(carbs)}g</Text>
                    </View>
                    <View className='meal-macro-pill'>
                      <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin' style={{ color: '#f0985c', fontSize: '20rpx', marginRight: '4rpx' }} />
                      <Text className='meal-macro-text'>{formatDisplayNumber(fat)}g</Text>
                    </View>
                  </View>
                </View>
              </View>
            )
          })}
        </View>
      </View>
    </View>
  )
}
