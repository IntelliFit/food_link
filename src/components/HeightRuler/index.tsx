import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useCallback, useEffect, useRef } from 'react'
import './index.scss'

interface HeightRulerProps {
    value: number // cm integer
    onChange: (val: number) => void
    min?: number
    max?: number
    unit?: 'cm' // Expandable
}

// 每一格的高度，与 CSS 对应
// Assuming 1cm = 20rpx or similar.
// Since we used 'px' in SCSS, let's use standard rpx or pixel calculations.
// The image has high resolution.
// Let's set 1 unit (1cm) = 20px for smoother scroll? Or 10px?
// SCSS uses 'px'. In Taro, this usually means rpx unless configured otherwise.
// If using standard Taro setup, 'px' in SCSS compiles to 'rpx'.
// Let's assume 1 unit = 20px (rpx).
const ITEM_HEIGHT = 20

export default function HeightRuler({
    value,
    onChange,
    min = 100,
    max = 250
}: HeightRulerProps) {

    // Total items: max - min + 1
    // Render list: from min to max
    // Example: 100, 101, ..., 250

    // Create ticks array (larger values at the top)
    const ticks = Array.from({ length: max - min + 1 }, (_, i) => max - i)

    // Current scroll top
    // If value is 100 (min), scroll top = 0
    // If value is 101, scroll top = ITEM_HEIGHT
    const [scrollTop, setScrollTop] = useState(0)

    // To avoid circular update loop
    const isScrolling = useRef(false)
    const scrollTimeout = useRef<any>(null)

    // Initialize scroll position based on value
    useEffect(() => {
        if (!isScrolling.current) {
            const initialScroll = (max - value) * ITEM_HEIGHT
            setScrollTop(initialScroll)
        }
    }, [value, max])

    const handleScroll = useCallback((e: any) => {
        isScrolling.current = true
        const top = e.detail.scrollTop

        // Calculate index
        // Round to nearest integer index
        let index = Math.round(top / ITEM_HEIGHT)

        // Clamp index
        if (index < 0) index = 0
        if (index > max - min) index = max - min

        const newValue = max - index

        if (newValue !== value) {
            onChange(newValue)
        }

        // Debounce resetting scrolling state
        if (scrollTimeout.current) clearTimeout(scrollTimeout.current)
        scrollTimeout.current = setTimeout(() => {
            isScrolling.current = false
            // Snap to grid visually?
            // Re-set scrollTop to exact multiple of ITEM_HEIGHT for alignment
            // setScrollTop(index * ITEM_HEIGHT) 
        }, 100)

    }, [min, max, onChange, value])

    return (
        <View className="height-ruler-wrapper">
            {/* Scrollable Ruler */}
            <ScrollView
                className="ruler-scroll-view"
                scrollY
                scrollTop={scrollTop}
                onScroll={handleScroll}
                scrollWithAnimation={false} // Immediate feedback
                enhanced
                showScrollbar={false}
            >
                <View className="ruler-content" style={{ paddingTop: `calc(400rpx - ${ITEM_HEIGHT / 2}px)`, paddingBottom: `calc(400rpx - ${ITEM_HEIGHT / 2}px)` }}>
                    {ticks.map((val) => {
                        const isTen = val % 10 === 0
                        const isFive = val % 5 === 0 && !isTen

                        return (
                            <View
                                key={val}
                                className={`ruler-item ${isTen ? 'tick-10' : isFive ? 'tick-5' : 'tick-1'}`}
                                style={{ height: `${ITEM_HEIGHT}px` }}
                            >
                                <View className="tick-mark" />
                                {isTen && (
                                    <Text className="tick-text">{val}</Text>
                                )}
                            </View>
                        )
                    })}
                </View>
            </ScrollView>

            {/* Fixed Indicator */}
            <View className="center-indicator" />

            {/* Right Side: Display */}
            <View className="value-display-area">
                <Text className="label-question">您的身高是?</Text>

                <View className="current-value-display">
                    <Text className="val-text">{value}</Text>
                    <Text className="unit-text">厘米</Text>
                </View>
            </View>
        </View>
    )
}
