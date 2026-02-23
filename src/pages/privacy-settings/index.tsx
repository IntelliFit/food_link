import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { Cell, Switch } from '@taroify/core'
import { useState } from 'react'
import { getUserProfile, authenticatedRequest } from '../../utils/api'
import './index.scss'

export default function PrivacySettings() {
    const [searchable, setSearchable] = useState(true)
    const [publicRecords, setPublicRecords] = useState(true)
    const [loading, setLoading] = useState(true)

    useDidShow(() => {
        fetchPrivacySettings()
    })

    const fetchPrivacySettings = async () => {
        try {
            setLoading(true)
            const profile = await getUserProfile()
            // API 应该返回这两个字段
            setSearchable(profile.searchable ?? true)
            setPublicRecords(profile.public_records ?? true)
        } catch (e) {
            console.error('Failed to fetch privacy settings:', e)
            Taro.showToast({ title: '加载失败', icon: 'error' })
        } finally {
            setLoading(false)
        }
    }

    const updateSetting = async (key: 'searchable' | 'public_records', value: boolean) => {
        try {
            if (key === 'searchable') setSearchable(value)
            if (key === 'public_records') setPublicRecords(value)

            // Call API directly for updating user profile
            const res = await authenticatedRequest('/api/user/profile', {
                method: 'PUT',
                data: { [key]: value }
            })

            if (res.statusCode !== 200) {
                throw new Error('Update failed')
            }
            Taro.showToast({ title: '设置已更新', icon: 'success' })
        } catch (e) {
            console.error('Failed to update privacy settings', e)
            Taro.showToast({ title: '更新失败', icon: 'error' })
            // Revert optimism setup
            if (key === 'searchable') setSearchable(!value)
            if (key === 'public_records') setPublicRecords(!value)
        }
    }

    if (loading) {
        return (
            <View className="loading-container">
                <Text>加载中...</Text>
            </View>
        )
    }

    return (
        <View className="privacy-settings-page">
            <Cell.Group className="setting-group" title="基础隐私">
                <Cell
                    title="允许在圈子中被搜索"
                    brief="开启后，其他用户可以通过用户名或手机号搜索到您。"
                    rightIcon={
                        <Switch
                            checked={searchable}
                            onChange={(val) => updateSetting('searchable', val)}
                            style={{ '--switch-checked-background-color': '#00bc7d' } as React.CSSProperties}
                        />
                    }
                />
                <Cell
                    title="公开我的饮食记录"
                    brief="开启后，其他用户在圈子里可以看到您的动态和饮食记录。"
                    rightIcon={
                        <Switch
                            checked={publicRecords}
                            onChange={(val) => updateSetting('public_records', val)}
                            style={{ '--switch-checked-background-color': '#00bc7d' } as React.CSSProperties}
                        />
                    }
                />
            </Cell.Group>
        </View>
    )
}
