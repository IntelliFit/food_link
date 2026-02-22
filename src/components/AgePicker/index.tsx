import { View, Text, PickerView, PickerViewColumn } from '@tarojs/components'
import { useState, useEffect } from 'react'
import './index.scss'

interface AgePickerProps {
    value: number
    onChange: (val: number) => void
    min?: number
    max?: number
}

// Age range: default 1 to 100
const DEFAULT_MIN = 1
const DEFAULT_MAX = 100

export default function AgePicker({
    value,
    onChange,
    min = DEFAULT_MIN,
    max = DEFAULT_MAX
}: AgePickerProps) {

    // Available ages
    const ages = Array.from({ length: max - min + 1 }, (_, i) => min + i)

    // PickerView value is an array of indices
    // Find index for current value
    const [pickVal, setPickVal] = useState<number[]>([Math.max(0, ages.indexOf(value))])

    useEffect(() => {
        const idx = ages.indexOf(value)
        if (idx !== -1 && idx !== pickVal[0]) {
            setPickVal([idx])
        }
    }, [value, ages])

    const handleChange = (e: any) => {
        const idx = e.detail.value[0]
        setPickVal([idx])
        const newValue = ages[idx]
        onChange(newValue)
    }

    return (
        <View className="age-picker-wrapper">
            <View className="picker-view-container">
                <PickerView
                    className="age-picker-view"
                    indicatorClass="picker-indicator-visible"
                    indicatorStyle="height: 120px;" // Native style inline
                    style={{ width: '100%', height: '100%' }}
                    value={pickVal}
                    onChange={handleChange}
                >
                    <PickerViewColumn>
                        {ages.map((age) => {
                            // Highlight if this item is selected?
                            // Unfortunately, inside PickerView loop, we don't dynamically re-render based on scroll easily without lag
                            // But we can check against current value if we accept slight delay
                            const isSelected = age === value
                            return (
                                <View key={age} className="picker-item">
                                    <Text
                                        className="age-number"
                                        style={{
                                            // Dynamic inline style for bolding selected item
                                            // This might update slightly delayed but is standard
                                            fontSize: isSelected ? '48px' : '32px',
                                            fontWeight: isSelected ? '600' : '400',
                                            color: isSelected ? '#111827' : '#9ca3af',
                                            transform: isSelected ? 'scale(1.2)' : 'scale(1)'
                                        }}
                                    >
                                        {age}
                                    </Text>
                                    {/* Unit is separate */}
                                </View>
                            )
                        })}
                    </PickerViewColumn>
                </PickerView>

                {/* Floating Unit Label */}
                <Text className="static-unit-label">岁</Text>
            </View>
        </View>
    )
}
