import { View, Text, Canvas } from '@tarojs/components'
import { useEffect, useRef, useMemo, useCallback } from 'react'
import Taro from '@tarojs/taro'

interface CalorieWavePoolProps {
  calories: number
}

// 动画速度常量 - 可调
const WAVE_SPEED = 0.025

export function CalorieWavePool({ calories }: CalorieWavePoolProps) {
  const phaseRef = useRef(0)
  const canvasId = useMemo(() => `wave-${Math.random().toString(36).substr(2, 9)}`, [])
  const frameRef = useRef<number>(0)
  
  // 计算水位百分比 (500-3500 kcal 映射到 15%-95%)
  const percent = useMemo(() => {
    const minCalories = 500
    const maxCalories = 3500
    return Math.min(0.95, Math.max(0.15, (calories - minCalories) / (maxCalories - minCalories)))
  }, [calories])
  
  // 绘制波浪
  const drawWave = useCallback(() => {
    const query = Taro.createSelectorQuery()
    query.select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return
        
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const width = res[0].width
        const height = res[0].height
        
        // 设置画布实际像素尺寸
        canvas.width = width
        canvas.height = height
        
        // 清空画布
        ctx.clearRect(0, 0, width, height)
        
        // 计算水位高度 (从下往上)
        const waterLevel = height * (1 - percent)
        
        // 开始绘制波浪路径
        ctx.beginPath()
        ctx.moveTo(0, height)
        
        // 绘制正弦波
        for (let x = 0; x <= width; x++) {
          const y = waterLevel + Math.sin((x / width) * 2 * Math.PI + phaseRef.current) * 8
          ctx.lineTo(x, y)
        }
        
        // 闭合路径
        ctx.lineTo(width, height)
        ctx.lineTo(0, height)
        ctx.closePath()
        
        // 创建渐变填充 (从底到上，带透明度)
        const gradient = ctx.createLinearGradient(0, waterLevel - 20, 0, height)
        gradient.addColorStop(0, 'rgba(0, 214, 143, 0.6)')   // 水面附近：半透浅绿
        gradient.addColorStop(0.3, 'rgba(0, 188, 125, 0.75)') // 上中部：稍深
        gradient.addColorStop(0.7, 'rgba(0, 168, 110, 0.85)') // 下部：更深
        gradient.addColorStop(1, 'rgba(0, 143, 95, 0.95)')    // 底部最深
        
        ctx.fillStyle = gradient
        ctx.fill()
        
        // 更新相位 - 使用常量控制速度
        phaseRef.current += WAVE_SPEED
        
        // 继续动画
        frameRef.current = requestAnimationFrame(drawWave)
      })
  }, [percent, canvasId])
  
  useEffect(() => {
    // 启动动画
    frameRef.current = requestAnimationFrame(drawWave)
    
    return () => {
      cancelAnimationFrame(frameRef.current)
    }
  }, [drawWave])
  
  // 动态提示文案
  const hint = useMemo(() => {
    if (calories < 1200) return '偏轻饮食'
    if (calories < 1800) return '适中饮食'
    if (calories < 2500) return '充足饮食'
    return '高能量饮食'
  }, [calories])
  
  return (
    <View className='target-calorie-pool'>
      <Canvas 
        type='2d'
        id={canvasId}
        className='calorie-wave-canvas'
        style={{ width: '100%', height: '100%' }}
      />
      <View className='target-calorie-content'>
        <Text className='target-calorie-label'>预计摄入目标</Text>
        <Text className='target-calorie-value'>
          {calories}
          <Text className='target-calorie-unit'>kcal</Text>
        </Text>
        <Text className='target-calorie-hint'>{hint}</Text>
      </View>
    </View>
  )
}
