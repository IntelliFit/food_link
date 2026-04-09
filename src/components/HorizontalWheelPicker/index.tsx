import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import './index.scss'

interface HorizontalWheelPickerProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  activeColor?: string
  itemWidth?: number
}

export default function HorizontalWheelPicker({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  activeColor = '#111827',
  itemWidth = 70
}: HorizontalWheelPickerProps) {
  const values = Array.from(
    { length: Math.floor((max - min) / step) + 1 },
    (_, i) => min + i * step
  )

  const scrollRef = useRef<any>(null)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollTimerRef = useRef<NodeJS.Timeout | null>(null)

  const containerWidth = 300 // 可视区域宽度
  const centerOffset = containerWidth / 2

  // 计算目标滚动位置
  const getTargetScroll = useCallback((targetValue: number) => {
    const index = values.indexOf(targetValue)
    if (index === -1) return 0
    return index * itemWidth - centerOffset + itemWidth / 2
  }, [values, itemWidth, centerOffset])

  // 初始化滚动位置
  useEffect(() => {
    const targetScroll = getTargetScroll(value)
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          scrollLeft: Math.max(0, targetScroll),
          animated: false
        })
      }
    }, 50)
  }, []) // 只在挂载时执行

  // 值变化时同步滚动位置（非用户操作）
  useEffect(() => {
    if (!isScrolling && scrollRef.current) {
      const targetScroll = getTargetScroll(value)
      scrollRef.current.scrollTo({
        scrollLeft: Math.max(0, targetScroll),
        animated: true
      })
    }
  }, [value, isScrolling, getTargetScroll])

  const handleScroll = (e: any) => {
    const scrollX = e.detail.scrollLeft

    // 清除之前的定时器
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
    }

    // 计算当前应该选中的值
    const index = Math.round((scrollX + centerOffset - itemWidth / 2) / itemWidth)
    const clampedIndex = Math.max(0, Math.min(values.length - 1, index))
    const newValue = values[clampedIndex]

    if (newValue !== value) {
      onChange(newValue)
    }
  }

  const handleScrollStart = () => {
    setIsScrolling(true)
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
    }
  }

  const handleScrollEnd = () => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
    }
    scrollTimerRef.current = setTimeout(() => {
      setIsScrolling(false)
      // 吸附到最近的项目
      const targetScroll = getTargetScroll(value)
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          scrollLeft: Math.max(0, targetScroll),
          animated: true
        })
      }
    }, 150)
  }

  return (
    <View className='horizontal-wheel-picker'>
      {/* 选中高亮背景 */}
      <View
        className='wheel-active-bg'
        style={{ backgroundColor: activeColor + '12' }}
      />

      <ScrollView
        ref={scrollRef}
        className='wheel-scroll'
        scrollX
        scrollWithAnimation={false}
        showScrollbar={false}
        enhanced
        bounces={false}
        style={{ width: `${containerWidth}px` }}
        onScroll={handleScroll}
        onTouchStart={handleScrollStart}
        onTouchEnd={handleScrollEnd}
        onScrollToUpper={handleScrollEnd}
        onScrollToLower={handleScrollEnd}
      >
        <View className='wheel-content' style={{ width: `${values.length * itemWidth + containerWidth}px` }}>
          {/* 左侧留白，使第一个项目可以居中 */}
          <View style={{ width: `${centerOffset - itemWidth / 2}px`, flexShrink: 0 }} />

          {values.map((val) => {
            const isSelected = val === value
            return (
              <View
                key={val}
                className={`wheel-item ${isSelected ? 'active' : ''}`}
                style={{ width: `${itemWidth}px` }}
              >
                <Text
                  className='wheel-number'
                  style={{ color: isSelected ? activeColor : '#9ca3af' }}
                >
                  {val}
                  {isSelected && unit && (
                    <Text className='wheel-unit' style={{ color: activeColor }}>{unit}</Text>
                  )}
                </Text>
              </View>
            )
          })}

          {/* 右侧留白 */}
          <View style={{ width: `${centerOffset - itemWidth / 2}px`, flexShrink: 0 }} />
        </View>
      </ScrollView>
    </View>
  )
}
