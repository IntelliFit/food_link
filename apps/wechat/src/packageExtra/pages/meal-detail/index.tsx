import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useRef } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { getFoodRecordList, showUnifiedApiError, type FoodRecord } from '../../../utils/api'
import { combineMealRecords, mealRecordAdvice } from '../../../utils/meal-record-advice'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { AdaptiveImageGrid } from '../../../components/AdaptiveImageGrid'
import './index.scss'

const MEAL_NAMES: Record<string, string> = { breakfast: '早餐', morning_snack: '早加餐', lunch: '午餐', afternoon_snack: '午加餐', dinner: '晚餐', evening_snack: '晚加餐', snack: '加餐' }

function MealDetailPage() {
  const { scheme } = useAppColorScheme()
  const { params } = useRouter()
  const date = String(params.date || '')
  const mealType = String(params.meal_type || '')
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  useDidShow(() => {
    const request = ++epoch.current
    setLoading(true)
    setError('')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !MEAL_NAMES[mealType]) {
      setError('餐次或日期无效，请返回当天记录')
      setLoading(false)
      return
    }
    void getFoodRecordList(date).then(response => {
      if (request === epoch.current) setRecords(response.records.filter(record => record.meal_type === mealType))
    }).catch(async failure => {
      if (request !== epoch.current) return
      setError('获取本餐失败，请返回后重试')
      await showUnifiedApiError(failure, '获取本餐失败')
    }).finally(() => { if (request === epoch.current) setLoading(false) })
  })
  const meal = combineMealRecords(records)
  const advice = meal ? mealRecordAdvice(meal) : null
  return <ScrollView scrollY className={`meal-detail-page ${scheme === 'dark' ? 'meal-detail-page--dark' : ''}`}>
    {loading ? <View className='meal-detail-spinner' /> : error || !meal || !advice ? <Text className='meal-detail-empty'>{error || '本餐暂无记录'}</Text> : <>
      <View className='meal-detail-card'>
        <Text className='meal-detail-title'>{MEAL_NAMES[mealType]} · 整餐点评</Text>
        <Text>{date} · 合并 {records.length} 条记录 · {meal.total_calories.toFixed(1)} kcal</Text>
        <Text className='meal-detail-source'>结合本餐全部食物和实际摄入量生成营养点评</Text>
      </View>
      {!!meal.image_paths?.length && <AdaptiveImageGrid urls={meal.image_paths} />}
      {[
        ['本餐搭配', advice.insight], ['PFC 供能比例', advice.ratio], ['进食顺序', advice.order],
        ['吸收与利用', advice.absorption], ['情境建议', advice.context], ['饮食比例建议', advice.ratioAdvice],
      ].filter(([, body]) => body).map(([title, body], index) => <View className='meal-detail-card' key={index}><Text className='meal-detail-title'>{title}</Text><Text>{body}</Text></View>)}
      <View className='meal-detail-card'>
        <Text className='meal-detail-title'>本餐全部食物</Text>
        {meal.items.map((item, index) => <View className='meal-detail-food' key={index}>
          <Text>{item.name}</Text><Text>摄入 {item.intake}g · {(item.nutrients.calories * item.ratio / 100).toFixed(1)} kcal</Text>
        </View>)}
      </View>
      <View className='meal-detail-card'>
        <Text className='meal-detail-title'>查看或修改原记录</Text>
        {records.map((record, index) => <View className='meal-detail-record' key={record.id} onClick={() => Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(record.id)}&owned=1` })}>
          <Text>第 {index + 1} 条 · {record.items.map(item => item.name).join('、')}</Text><Text>查看 ›</Text>
        </View>)}
      </View>
    </>}
  </ScrollView>
}
export default withAuth(MealDetailPage)
