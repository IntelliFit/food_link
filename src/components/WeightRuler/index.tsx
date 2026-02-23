import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useCallback, useEffect, useRef } from 'react'
import './index.scss'

interface WeightRulerProps {
    value: number // kg (float or integer)
    onChange: (val: number) => void
    min?: number // e.g. 30
    max?: number // e.g. 200
    height?: number // User height in cm (for BMI calculation)
}

// Tick resolution: 0.1kg per small tick
// 1kg = 10 ticks
// If we want smooth scrolling, we can map 1 tick = 0.1kg
// Scroll width per tick also affects UX. Let's say 1 tick = 10px.
// 1kg range = 100px.
const TICK_WIDTH = 10 // px
const TICK_VALUE = 0.1 // kg per tick

export default function WeightRuler({
    value,
    onChange,
    min = 30,
    max = 200,
    height = 170 // Default if not provided
}: WeightRulerProps) {

    // Total ticks = (max - min) / TICK_VALUE
    const totalTicks = Math.round((max - min) / TICK_VALUE)

    // Creating tick array might be heavy if range is large (e.g. 1700 items).
    // Ideally render window. But for simplicity, let's create a virtual list or just map indices and calculate position.
    // Actually, we can just use a long view with specific markers.

    // Let's create an array of main markers (every 1kg) for labels, and fill in-betweens visually via CSS or simplified logic.
    // No, to have specific ticks, we iterate. 
    // 170 * 10 = 1700 div elements. Modern browsers handle this okay in scroll wrapper usually.

    // Optimization: use a canvas or just optimized list?
    // Taro ScrollView is native. 1700 views might be heavy on some devices.
    // Let's try 0.5kg resolution for ticks? Or 1kg resolution with interpolation?
    // The image shows ticks for partial values.
    // Let's stick to 0.1kg but maybe render smarter?
    // For now, let's limit the rendered nodes or trust Taro recycling (it doesn't do recycling automatically in standard scrollview).
    // Let's implement full list but keep DOM light.

    const ticks = Array.from({ length: totalTicks + 1 }, (_, i) => min + i * TICK_VALUE)

    const [scrollLeft, setScrollLeft] = useState(0)
    const isScrolling = useRef(false)
    const scrollTimeout = useRef<any>(null)

    // Initialize scroll
    useEffect(() => {
        if (!isScrolling.current) {
            // Calculate initial scroll
            const steps = (value - min) / TICK_VALUE
            setScrollLeft(steps * TICK_WIDTH)
        }
    }, [value, min])

    const handleScroll = useCallback((e: any) => {
        isScrolling.current = true
        const left = e.detail.scrollLeft

        // Calculate index
        let index = Math.round(left / TICK_WIDTH)

        // Clamp
        if (index < 0) index = 0
        if (index > totalTicks) index = totalTicks

        const newValue = Number((min + index * TICK_VALUE).toFixed(1))

        if (newValue !== value) {
            onChange(newValue)
        }

        if (scrollTimeout.current) clearTimeout(scrollTimeout.current)
        scrollTimeout.current = setTimeout(() => {
            isScrolling.current = false
        }, 100)

    }, [min, totalTicks, onChange, value])

    // BMI Calculation
    // height in cm -> m
    const heightM = height / 100
    const bmi = (value / (heightM * heightM)).toFixed(1)

    let bmiStatus = 'normal'
    let bmiLabel = '健康'
    const bmiNum = Number(bmi)

    if (bmiNum < 18.5) {
        bmiStatus = 'underweight'
        bmiLabel = '偏瘦'
    } else if (bmiNum >= 24 && bmiNum < 28) {
        bmiStatus = 'overweight'
        bmiLabel = '超重'
    } else if (bmiNum >= 28) {
        bmiStatus = 'obese'
        bmiLabel = '肥胖'
    }

    return (
        <View className="weight-ruler-wrapper">
            <View className="value-display-area">
                <Text className="label-question">您的体重是多少?</Text>

                <View className="current-value-display">
                    <Text className="val-text">{value.toFixed(1)}</Text>
                    <Text className="unit-text">公斤</Text>
                </View>
            </View>

            <View className="bmi-card">
                <View className="bmi-header">
                    <Text className="bmi-label">您的BMI:</Text>
                    <Text className={`bmi-value status-${bmiStatus}`}>{bmi}</Text>
                    <View className={`bmi-tag status-${bmiStatus}`}>
                        <Text>{bmiLabel}</Text>
                    </View>
                </View>
                <Text className="bmi-desc">您的身材{bmiLabel === '健康' ? '很棒，请保持！' : '需要注意哦'}</Text>
            </View>

            <View className="ruler-container" style={{ width: '100%' }}>
                <View className="center-indicator" />
                <ScrollView
                    className="ruler-scroll-view"
                    scrollX
                    scrollLeft={scrollLeft}
                    onScroll={handleScroll}
                    scrollWithAnimation={false}
                    enhanced
                    showScrollbar={false}
                >
                    <View className="ruler-track" style={{ paddingLeft: `calc(50% - ${TICK_WIDTH / 2}px)`, paddingRight: `calc(50% - ${TICK_WIDTH / 2}px)` }}>
                        {ticks.map((val, idx) => {
                            const isMajor = idx % 10 === 0 // Integer kg
                            const isMedium = idx % 5 === 0 && !isMajor // 0.5 kg

                            // Optimize: Only render labels for Major ticks to save nodes/memory

                            return (
                                <View
                                    key={idx}
                                    className={`ruler-tick ${isMajor ? 'tick-major' : isMedium ? 'tick-medium' : 'tick-minor'}`}
                                    style={{ width: `${TICK_WIDTH}px` }}
                                >
                                    <View className="tick-mark" />
                                    {isMajor && (
                                        <Text className="tick-label">{val.toFixed(0)}</Text>
                                    )}
                                </View>
                            )
                        })}
                    </View>
                </ScrollView>
            </View>
        </View>
    )
}
