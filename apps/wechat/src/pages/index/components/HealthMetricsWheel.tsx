import { Image, Text, View } from '@tarojs/components'
import { useMemo } from 'react'
import { buildHealthWheelSvg, getHealthMetricReadings, healthWheelSvgSource, type HealthMetricKind, type HealthMetricsData } from './HealthMetricsWheel.data'
import './HealthMetricsWheel.scss'

interface Props extends HealthMetricsData {
  dark?: boolean
  wellness?: boolean
  onOpen: (kind: HealthMetricKind) => void
  onQuickRecord: (kind: HealthMetricKind) => void
}

export function HealthMetricsWheel({ dark = false, wellness = false, onOpen, onQuickRecord, ...data }: Props) {
  const readings = getHealthMetricReadings(data)
  const source = useMemo(() => healthWheelSvgSource(buildHealthWheelSvg(readings.waterVisualProgress, dark, wellness)), [readings.waterVisualProgress, dark, wellness])
  return (
    <View id='home-health-wheel' className={`health-wheel home-experience-card ${dark ? 'health-wheel--dark' : ''} ${wellness ? 'health-wheel--wellness' : ''}`}>
      <View className='health-wheel__header'>
        <Text className='health-wheel__title'>健康日常</Text>
        <Text className='health-wheel__date'>{data.date.replace(/-/g, '.')}</Text>
      </View>
      <View className='health-wheel__plot'>
        <Image className='health-wheel__graphic' src={source} mode='aspectFit' aria-hidden lazyLoad={false} />
        {readings.metrics.map(metric => (
          <View
            key={metric.kind}
            id={`health-wheel-${metric.kind}`}
            className={`health-wheel__metric health-wheel__metric--${metric.kind}`}
            role='button'
            aria-label={`${metric.title} ${metric.value} ${metric.unit}，${metric.hint}，点击查看记录`}
            onClick={() => onOpen(metric.kind)}
          >
            {wellness && metric.kind !== 'weight' && <Text className='ink-health-eyebrow'>{metric.kind === 'water' ? '静养' : '动养'}</Text>}
            <View className='health-wheel__metric-title'><Text className={`iconfont ${metric.icon}`} /><Text>{metric.title}</Text></View>
            <View className='health-wheel__reading'><Text className='health-wheel__value'>{metric.value}</Text><Text className='health-wheel__unit'>{metric.unit}</Text></View>
            {metric.hint ? <Text className='health-wheel__hint'>{metric.hint}</Text> : null}
            {metric.detail ? <Text className='health-wheel__detail'>{metric.detail}</Text> : null}
            <View
              className='health-wheel__quick-record'
              onClick={(event) => {
                event.stopPropagation()
                onQuickRecord(metric.kind)
              }}
            >
              <Text>＋记录</Text>
            </View>
          </View>
        ))}
        <View className='health-wheel__center' aria-hidden>
          {data.busy ? <View className='health-wheel__spinner' /> : <><Text>身体</Text><Text>记录</Text></>}
        </View>
      </View>
      <Text className='health-wheel__note'>点击数据查看趋势，使用“＋记录”快速添加</Text>
    </View>
  )
}
