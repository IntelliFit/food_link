import { Text, View } from '@tarojs/components'
import { WEIGHT_PLOT, type CalorieChartView, type MacroSplitView, type WeightTrendView } from './analysis-view'

// 热量、体重和加载骨架。小程序里不用内联 SVG，图都用 View 拼

const LINE_THICKNESS = 5
const END_DOT = 16

/** 热量：每日柱子 + 参考消耗虚线 + 三大营养比例条 */
export function CaloriesCard({ chart, macro }: { chart: CalorieChartView; macro: MacroSplitView | null }) {
  return (
    <View className='sa-card'>
      <View className='sa-card__title'>
        <Text className='sa-card__name'>热量</Text>
        {chart.averageText ? <Text className='sa-card__side'>{chart.averageText}</Text> : null}
      </View>
      <View className={`sa-bars ${chart.dense ? 'is-dense' : ''}`}>
        <View className='sa-bars__plot'>
          {chart.referencePct !== null ? (
            <View className='sa-bars__ref' style={{ bottom: `${chart.referencePct}%` }}>
              <Text className='sa-bars__ref-text'>{chart.referenceText}</Text>
            </View>
          ) : null}
          {chart.bars.map(bar => (
            <View key={bar.key} className='sa-bars__col'>
              <View
                className={`sa-bars__bar ${bar.today ? 'is-today' : ''} ${bar.empty ? 'is-empty' : ''}`}
                style={bar.empty ? undefined : { height: `${bar.heightPct}%` }}
              />
            </View>
          ))}
        </View>
      </View>
      <View className={`sa-blabels ${chart.dense ? 'is-dense' : ''}`}>
        {chart.bars.map(bar => <Text key={bar.key} className='sa-blabels__item'>{bar.label}</Text>)}
      </View>
      {macro ? (
        <>
          <View className='sa-macro' aria-hidden>
            <View className='sa-macro__part is-protein' style={{ width: `${macro.protein}%` }} />
            <View className='sa-macro__part is-carbs' style={{ width: `${macro.carbs}%` }} />
            <View className='sa-macro__part is-fat' style={{ width: `${macro.fat}%` }} />
          </View>
          <View className='sa-macro-legend'>
            <Text>蛋白 {macro.protein}%</Text>
            <Text>碳水 {macro.carbs}%</Text>
            <Text>脂肪 {macro.fat}%</Text>
          </View>
        </>
      ) : null}
    </View>
  )
}

/** 体重：最新一次、变化和走势小图 */
export function WeightCard({ trend }: { trend: WeightTrendView }) {
  const last = trend.points[trend.points.length - 1]
  return (
    <View className='sa-card'>
      <View className='sa-card__title'>
        <Text className='sa-card__name'>体重</Text>
        <Text className='sa-card__side'>{trend.countText}</Text>
      </View>
      <View className='sa-weight'>
        <View className='sa-weight__copy'>
          <View className='sa-weight__value-line'>
            <Text className='sa-weight__value'>{trend.valueText}</Text>
            <Text className='sa-weight__unit'>kg</Text>
          </View>
          <Text className='sa-weight__change'>{trend.changeText}</Text>
        </View>
        {last ? (
          <View className='sa-weight__plot' style={{ width: `${WEIGHT_PLOT.width}rpx`, height: `${WEIGHT_PLOT.height}rpx` }} aria-hidden>
            {trend.segments.map(segment => (
              <View
                key={segment.key}
                className='sa-weight__line'
                style={{
                  left: `${segment.x}rpx`,
                  top: `${segment.y - LINE_THICKNESS / 2}rpx`,
                  width: `${segment.length}rpx`,
                  height: `${LINE_THICKNESS}rpx`,
                  transform: `rotate(${segment.angle}deg)`,
                }}
              />
            ))}
            <View
              className='sa-weight__dot'
              style={{ left: `${last.x - END_DOT / 2}rpx`, top: `${last.y - END_DOT / 2}rpx`, width: `${END_DOT}rpx`, height: `${END_DOT}rpx` }}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** 加载中：画出同样形状的骨架，不写字 */
export function AnalysisSkeleton() {
  return (
    <>
      <View className='sa-brief'>
        <View className='sa-sk sa-sk--on-brief sa-sk--label' />
        <View className='sa-sk sa-sk--on-brief sa-sk--score' />
        <View className='sa-sk sa-sk--on-brief sa-sk--line' />
      </View>
      <View className='sa-card'>
        <View className='sa-sk sa-sk--title' />
        <View className='sa-sk sa-sk--row' />
        <View className='sa-sk sa-sk--row' />
        <View className='sa-sk sa-sk--row' />
      </View>
    </>
  )
}
