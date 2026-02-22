import { View, Text, Image, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'
import {
    login,
    LoginResponse,
    getUserProfile,
    updateUserInfo,
    uploadUserAvatar,
    imageToBase64,
    getUserRecordDays
} from '../../utils/api'

import './index.scss'

interface UserInfo {
    avatar: string
    name: string
    meta: string
}

const APP_LOGO_URL = 'https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/icon/shitan-nobackground.png'

export default function LoginPage() {
    const [loading, setLoading] = useState(false)
    const [showProfileForm, setShowProfileForm] = useState(false)

    // 临时头像和昵称（用于完善信息）
    const [tempAvatar, setTempAvatar] = useState('')
    const [tempNickname, setTempNickname] = useState('')

    // 获取手机号并登录
    const handleGetPhoneNumber = async (e: any) => {
        if (loading) return

        // 检查事件详情
        if (!e || !e.detail) {
            Taro.showToast({ title: '获取手机号失败', icon: 'none' })
            return
        }

        if (e.detail.errMsg !== 'getPhoneNumber:ok') {
            // 获取手机号失败，提示用户并尝试普通登录
            console.warn('获取手机号失败:', e.detail.errMsg)
            if (e.detail.errMsg === 'getPhoneNumber:fail no permission') {
                Taro.showModal({
                    title: '提示',
                    content: '无法获取手机号，是否继续使用微信账号直接登录？',
                    confirmText: '继续登录',
                    success: (res) => {
                        if (res.confirm) {
                            handleLoginOnly()
                        }
                    }
                })
                return
            }
            // 其他错误
            await handleLoginOnly()
            return
        }

        setLoading(true)
        try {
            const phoneCode = e.detail.code
            const loginRes = await Taro.login()
            if (!loginRes.code) throw new Error('获取登录凭证失败')

            const loginData: LoginResponse = await login(loginRes.code, phoneCode)
            await handleLoginSuccess(loginData)

        } catch (error: any) {
            console.error('登录失败:', error)
            Taro.showToast({
                title: error.message || '登录失败',
                icon: 'none'
            })
            setLoading(false)
        }
    }

    /** 微信一键登录：仅用 code 登录。若用户库中已有手机号，后端会直接带回，无需再次授权手机号 */
    const handleWxLogin = async () => {
        if (loading) return
        setLoading(true)
        try {
            const loginRes = await Taro.login()
            if (!loginRes.code) throw new Error('获取登录凭证失败')
            const loginData: LoginResponse = await login(loginRes.code)
            await handleLoginSuccess(loginData)
        } catch (error: any) {
            console.error('登录失败:', error)
            Taro.showToast({
                title: error.message || '登录失败',
                icon: 'none'
            })
            setLoading(false)
        }
    }

    /** 仅登录（不获取手机号），用于 getPhoneNumber 失败时的降级 */
    const handleLoginOnly = async () => {
        if (loading) return
        setLoading(true)
        try {
            const loginRes = await Taro.login()
            if (!loginRes.code) throw new Error('获取登录凭证失败')
            const loginData: LoginResponse = await login(loginRes.code)
            await handleLoginSuccess(loginData)
        } catch (error: any) {
            console.error('登录失败:', error)
            Taro.showToast({
                title: error.message || '登录失败',
                icon: 'none'
            })
            setLoading(false)
        }
    }

    // 登录成功后的处理
    const handleLoginSuccess = async (loginData: LoginResponse) => {
        // 保存基础信息
        Taro.setStorageSync('openid', loginData.openid)
        if (loginData.purePhoneNumber) {
            Taro.setStorageSync('phoneNumber', loginData.purePhoneNumber)
        }

        // 获取用户信息 check 是否完善
        try {
            const apiUserInfo = await getUserProfile()
            if (apiUserInfo.create_time) {
                Taro.setStorageSync('userRegisterTime', apiUserInfo.create_time)
            }

            // 保存用户信息到 storage
            const userInfo: UserInfo = {
                avatar: apiUserInfo.avatar || '',
                name: apiUserInfo.nickname || '用户昵称',
                meta: '已记录 0 天' // 初始值，profile 页面会刷新
            }
            Taro.setStorageSync('userInfo', userInfo)
            Taro.setStorageSync('isLoggedIn', true)

            Taro.showToast({
                title: '登录成功',
                icon: 'success'
            })

            // 检查是否需要完善头像/昵称
            // API 返回的 avatar 可能为空字符串，nickname 可能为空
            if (!apiUserInfo.nickname || !apiUserInfo.avatar || apiUserInfo.avatar === '' || apiUserInfo.nickname === '微信用户') {
                setLoading(false)
                setShowProfileForm(true) // 显示完善信息通过
            } else {
                // 信息齐全，直接返回
                setTimeout(() => {
                    Taro.navigateBack()
                }, 1500)
            }

        } catch (error) {
            console.error('获取用户信息失败', error)
            // 即使获取失败，也算登录成功
            Taro.setStorageSync('isLoggedIn', true)
            setLoading(false)
            setShowProfileForm(true) // 假设获取失败是因为没创建档案？或者让用户填写兜底
        }
    }

    // 跳过登录
    const handleSkip = () => {
        Taro.navigateBack()
    }

    // 处理头像选择
    const handleChooseAvatar = async (e: any) => {
        const { avatarUrl } = e.detail
        if (!avatarUrl) return

        // 也是同样逻辑：非 https 需要上传
        const needUpload = !avatarUrl.startsWith('https://')

        if (needUpload) {
            Taro.showLoading({ title: '上传中...' })
            try {
                const base64 = await imageToBase64(avatarUrl)
                const { imageUrl } = await uploadUserAvatar(base64)
                setTempAvatar(imageUrl)
                Taro.hideLoading()
            } catch (err: any) {
                Taro.hideLoading()
                Taro.showToast({ title: '上传失败', icon: 'none' })
            }
        } else {
            setTempAvatar(avatarUrl)
        }
    }

    const handleNicknameBlur = (e: any) => {
        setTempNickname(e.detail.value)
    }

    // 保存完善的信息
    const handleSaveProfile = async () => {
        if (!tempAvatar || !tempNickname) {
            Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
            return
        }

        Taro.showLoading({ title: '保存中...' })
        try {
            await updateUserInfo({
                nickname: tempNickname,
                avatar: tempAvatar
            })

            // 更新本地 storage
            const currentUser = Taro.getStorageSync('userInfo') || {}
            currentUser.avatar = tempAvatar
            currentUser.name = tempNickname
            Taro.setStorageSync('userInfo', currentUser)

            Taro.hideLoading()
            Taro.showToast({ title: '保存成功', icon: 'success' })

            setTimeout(() => {
                Taro.navigateBack()
            }, 1500)

        } catch (err: any) {
            Taro.hideLoading()
            Taro.showToast({ title: err.message || '保存失败', icon: 'none' })
        }
    }

    return (
        <View className='login-page'>
            <View className='login-header'>
                <Image src={APP_LOGO_URL} className='app-logo' mode='aspectFit' style={{ backgroundColor: '#f0fdf4' }} />
                <Text className='app-name'>智健食探</Text>
                <Text className='app-slogan'>记录饮食，连接健康</Text>
            </View>

            <View className='login-actions'>
                <TaroifyButton
                    className='wx-login-btn'
                    shape="round"
                    onClick={handleWxLogin}
                    loading={loading && !showProfileForm}
                >
                    微信一键登录
                </TaroifyButton>
                <TaroifyButton
                    className='skip-login-btn'
                    variant="text"
                    onClick={handleSkip}
                >
                    暂不登录，随便看看
                </TaroifyButton>
            </View>

            <View className='login-footer'>
                <View className='agreement-text'>
                    登录即代表同意 <Text className='link'>用户协议</Text> 和 <Text className='link'>隐私政策</Text>
                </View>
            </View>

            {/* 完善信息弹窗 */}
            {showProfileForm && (
                <View className='profile-form-modal'>
                    <View className='profile-form-content'>
                        <View className='profile-form-header'>
                            <Text className='profile-form-title'>完善个人信息</Text>
                        </View>
                        <View className='profile-form-body'>
                            <View className='avatar-choose-wrapper'>
                                {tempAvatar ? (
                                    <Image src={tempAvatar} className='avatar-image' mode='aspectFill' />
                                ) : (
                                    <Text className='iconfont icon-camera camera-icon' style={{ fontSize: '60rpx', color: '#ccc' }}>📷</Text>
                                )}
                                <Button
                                    className='avatar-choose-btn'
                                    openType='chooseAvatar'
                                    onChooseAvatar={handleChooseAvatar}
                                />
                                <View className='choose-tip'>点击修改</View>
                            </View>

                            <Input
                                className='nickname-input'
                                type='nickname'
                                placeholder='请输入昵称'
                                value={tempNickname}
                                onBlur={handleNicknameBlur}
                                onInput={(e) => setTempNickname(e.detail.value)}
                            />
                        </View>

                        <TaroifyButton
                            className='save-btn'
                            block
                            shape="round"
                            onClick={handleSaveProfile}
                        >
                            进入首页
                        </TaroifyButton>
                    </View>
                </View>
            )}
        </View>
    )
}
