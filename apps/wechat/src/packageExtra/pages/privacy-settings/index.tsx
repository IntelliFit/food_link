import { Switch, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { getUserProfile, authenticatedRequest, showUnifiedApiError } from '../../../utils/api'
import { nextRecordVisibility, type RecordVisibility } from '../../../utils/feed-share'
import './index.scss'
import { withAuth } from '../../../utils/withAuth'

function PrivacySettings() {
    const [searchable, setSearchable] = useState(true)
    const [recordVisibility, setRecordVisibility] = useState<RecordVisibility>({ friends_can_view_records: true, public_records: false })
	const [publicFavoriteRecipes, setPublicFavoriteRecipes] = useState(true)
    const [loading, setLoading] = useState(true)

    useDidShow(() => {
        fetchPrivacySettings()
    })

    const fetchPrivacySettings = async () => {
        try {
            setLoading(true)
            const profile = await getUserProfile()
            setSearchable(profile.searchable ?? true)
            setRecordVisibility({
                friends_can_view_records: profile.friends_can_view_records ?? true,
                public_records: profile.public_records ?? false,
            })
			setPublicFavoriteRecipes(profile.public_favorite_recipes ?? true)
        } catch (e) {
            console.error('Failed to fetch privacy settings:', e)
            await showUnifiedApiError(e, '加载失败')
        } finally {
            setLoading(false)
        }
    }

    const saveSetting = async (key: string, value: boolean) => {
        // Call API directly for updating user profile
        const res = await authenticatedRequest('/api/user/profile', {
            method: 'PUT',
            data: { [key]: value }
        })
        if (res.statusCode !== 200) {
            throw new Error('Update failed')
        }
        Taro.showToast({ title: '设置已更新', icon: 'success' })
    }

    const updateSetting = async (key: 'searchable' | 'public_favorite_recipes', value: boolean) => {
        try {
            if (key === 'searchable') setSearchable(value)
			if (key === 'public_favorite_recipes') setPublicFavoriteRecipes(value)
            await saveSetting(key, value)
        } catch (e) {
            console.error('Failed to update privacy settings', e)
            await showUnifiedApiError(e, '更新失败')
            // Revert optimism setup
            if (key === 'searchable') setSearchable(!value)
			if (key === 'public_favorite_recipes') setPublicFavoriteRecipes(!value)
        }
    }

    const updateRecordVisibility = async (key: keyof RecordVisibility, value: boolean) => {
        const previous = recordVisibility
        try {
            setRecordVisibility(nextRecordVisibility(previous, key, value))
            await saveSetting(key, value)
        } catch (e) {
            console.error('Failed to update record visibility', e)
            await showUnifiedApiError(e, '更新失败')
            setRecordVisibility(previous)
        }
    }

    if (loading) {
        return (
            <View className='loading-container'>
                <View className='loading-spinner-md' />
            </View>
        )
    }

    return (
        <View className='privacy-settings-page'>
            <View className='setting-group'>
                <Text className='setting-group__title'>谁能看到我的记录</Text>
                <View className='setting-row'>
                    <View className='setting-row__text'>
                        <Text className='setting-row__title'>互相好友可以看到</Text>
                        <Text className='setting-row__brief'>开启后，和您互相加了好友的人能看到您的饮食、运动记录和照片。关闭后只有您自己能看到，关闭期间保存的记录，之后重新开启也不会给好友看。</Text>
                    </View>
                    <Switch className='setting-row__switch' checked={recordVisibility.friends_can_view_records} color='#00bc7d' onChange={(e) => updateRecordVisibility('friends_can_view_records', e.detail.value)} />
                </View>
                <View className='setting-row'>
                    <View className='setting-row__text'>
                        <Text className='setting-row__title'>允许陌生人看到</Text>
                        <Text className='setting-row__brief'>开启后，没加好友的用户（包括未登录的访客）也能在圈子看到您的记录和照片，包括历史记录。</Text>
                    </View>
                    <Switch className='setting-row__switch' checked={recordVisibility.public_records} color='#00bc7d' onChange={(e) => updateRecordVisibility('public_records', e.detail.value)} />
                </View>
            </View>
            <View className='setting-group'>
                <Text className='setting-group__title'>基础隐私</Text>
                <View className='setting-row'>
                    <View className='setting-row__text'>
                        <Text className='setting-row__title'>允许在圈子中被搜索</Text>
                        <Text className='setting-row__brief'>开启后，其他用户可以通过用户名或手机号搜索到您。</Text>
                    </View>
                    <Switch className='setting-row__switch' checked={searchable} color='#00bc7d' onChange={(e) => updateSetting('searchable', e.detail.value)} />
                </View>
                <View className='setting-row'>
                    <View className='setting-row__text'>
                        <Text className='setting-row__title'>公开我的食物收藏</Text>
                        <Text className='setting-row__brief'>关闭后，其他用户进入您的个人主页时将无法查看拍照分析后收藏的食物。</Text>
                    </View>
                    <Switch className='setting-row__switch' checked={publicFavoriteRecipes} color='#00bc7d' onChange={(e) => updateSetting('public_favorite_recipes', e.detail.value)} />
                </View>
            </View>
        </View>
    )
}

export default withAuth(PrivacySettings)
