import { View, Text, Image, Input, Button } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'
import {
    login,
    LoginResponse,
    bindPhone,
    getUserProfile,
    updateUserInfo,
    uploadUserAvatar,
    imageToBase64,
    requestFriendByInviteCode,
    formatApiErrorModalBody,
} from '../../../utils/api'
import { extraPkgUrl, normalizeRedirectUrlForSubpackage, MAIN_TAB_ROUTES } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import loginLogo from '../../../assets/login-logo.png'
import './index.scss'

interface UserInfo {
    avatar: string
    name: string
    meta: string
}

/** 安全返回：若当前是第一个页面则跳转首页 */
function safeNavigateBack() {
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
        Taro.navigateBack()
    } else {
        Taro.switchTab({ url: '/pages/index/index' })
    }
}

function normalizePath(path: string): string {
    const raw = (path || '').trim()
    if (!raw) return ''
    return raw.startsWith('/') ? raw : `/${raw}`
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value || '')
    } catch {
        return value || ''
    }
}

function extractTraceId(text: string): string {
    const m = String(text || '').match(/traceId\s*[:：]\s*([a-fA-F0-9]+)/i)
    return (m?.[1] || '').trim() || 'no-trace-id'
}

function stripTraceText(text: string): string {
    return String(text || '')
        .replace(/\s*[\(（]?\s*traceId\s*[:：]\s*[a-fA-F0-9]+\s*[\)）]?\s*$/i, '')
        .trim()
}

async function showLoginErrorModal(error: unknown, fallback: string): Promise<void> {
    const raw = String((error as any)?.message || fallback || '请求失败，请稍后重试')
    const traceFromProp = String((error as any)?.traceId || '').trim()
    const traceId = traceFromProp || extractTraceId(raw)
    const base = stripTraceText(raw) || fallback || '请求失败，请稍后重试'
    const content = formatApiErrorModalBody(base).slice(0, 860)
    // 避免与 setState/loading 同帧冲突导致弹窗不出现
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
        await Taro.showModal({
            title: '请求失败',
            content,
            confirmText: '复制',
            showCancel: false,
        })
    } catch (firstError) {
        console.warn('[login] show error modal failed, fallback to simple modal', firstError)
        // 二次兜底：极简内容，确保至少有确认弹窗
        await Taro.showModal({
            title: '请求失败',
            content: formatApiErrorModalBody('请求失败，请稍后重试'),
            confirmText: '复制',
            showCancel: false,
        })
    }
    try {
        await Taro.setClipboardData({ data: traceId })
        Taro.showToast({ title: '已复制', icon: 'success' })
    } catch {
        Taro.showToast({ title: '复制失败，请手动记录', icon: 'none' })
    }
}

export default function LoginPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [showProfileForm, setShowProfileForm] = useState(false)
    /** 登录成功但库中无手机号时展示，引导用户授权绑定 */
    const [showPhoneBindModal, setShowPhoneBindModal] = useState(false)
    /** 是否已同意用户协议与隐私政策 */
    const [agreed, setAgreed] = useState(false)

    // 临时头像和昵称（用于完善信息）
    const [tempAvatar, setTempAvatar] = useState('')
    const [tempNickname, setTempNickname] = useState('')

    /** 开发环境测试：模拟新用户 openid */
    const [testOpenid, setTestOpenid] = useState('')
    const isDev = process.env.NODE_ENV === 'development'

    const inviteCodeFromQuery = (router.params?.invite_code || '').trim()
    const redirectFromQuery = safeDecodeURIComponent((router.params?.redirect || '').trim())

    const finishLoginFlow = async () => {
        const pendingInviteCode = inviteCodeFromQuery || String(Taro.getStorageSync('pending_friend_invite_code') || '').trim()
        if (pendingInviteCode) {
            try {
                const res = await requestFriendByInviteCode(pendingInviteCode)
                if (res.status === 'requested') {
                    Taro.showToast({ title: `已向${res.nickname || '对方'}发起好友请求`, icon: 'success' })
                } else if (res.status === 'already_friend') {
                    Taro.showToast({ title: `已和${res.nickname || '对方'}是好友`, icon: 'none' })
                }
                Taro.removeStorageSync('pending_friend_invite_code')
            } catch {
                // 邀请处理失败不阻断登录跳转
            }
        }

        const target = normalizeRedirectUrlForSubpackage(normalizePath(redirectFromQuery))
        if (target) {
            const tabPath = target.split('?')[0]
            if (MAIN_TAB_ROUTES.has(tabPath)) {
                Taro.switchTab({ url: tabPath })
            } else {
                Taro.redirectTo({ url: target })
            }
            return
        }
        safeNavigateBack()
    }

    /** 微信一键登录：仅用 code，后端若已有手机号会直接带回，无需再授权 */
    const handleWxLogin = async () => {
        if (!agreed) {
            Taro.showToast({
                title: '请先阅读并勾选同意《用户服务协议》及《隐私政策》',
                icon: 'none'
            })
            return
        }
        if (loading) return
        setLoading(true)
        try {
            const loginRes = await Taro.login()
            if (!loginRes.code) throw new Error('获取登录凭证失败')
            const loginData: LoginResponse = await login(loginRes.code, undefined, inviteCodeFromQuery, isDev ? testOpenid : undefined)
            await handleLoginSuccess(loginData)
        } catch (error: any) {
            console.error('登录失败:', error)
            await showLoginErrorModal(error, '登录失败')
        } finally {
            setLoading(false)
        }
    }

    /** 登录后无手机号时，授权手机号并调用绑定接口 */
    const handleBindPhone = async (e: any) => {
        const phoneCode = e.detail?.code
        if (!phoneCode) {
            setShowPhoneBindModal(false)
            Taro.showToast({ title: '未授权手机号', icon: 'none' })
            setTimeout(() => { finishLoginFlow() }, 800)
            return
        }
        try {
            Taro.showLoading({ title: '绑定中...' })
            const res = await bindPhone(phoneCode)
            const num = res.purePhoneNumber || res.telephone
            if (num) Taro.setStorageSync('phoneNumber', num)
            Taro.hideLoading()
            Taro.showToast({ title: '绑定成功', icon: 'success' })
            setShowPhoneBindModal(false)
            setTimeout(() => { finishLoginFlow() }, 1000)
        } catch (err: any) {
            Taro.hideLoading()
            await showLoginErrorModal(err, '绑定失败')
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
                setShowProfileForm(true) // 显示完善信息弹窗
            } else {
                setLoading(false)
                // 库中已有手机号则直接返回；否则弹出授权手机号弹窗
                if (loginData.purePhoneNumber) {
                    setTimeout(() => { finishLoginFlow() }, 1500)
                } else {
                    setShowPhoneBindModal(true)
                }
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
        safeNavigateBack()
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
                await showLoginErrorModal(err, '上传失败')
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
                finishLoginFlow()
            }, 1500)

        } catch (err: any) {
            Taro.hideLoading()
            await showLoginErrorModal(err, '保存失败')
        }
    }

    return (
        <FlPageThemeRoot>
        <View className='login-page'>
            <View className='login-header'>
                <Image src={loginLogo} className='app-logo' mode='aspectFit' style={{ backgroundColor: '#f0fdf4' }} />
                <Text className='app-name'>智健食探</Text>
                <Text className='app-slogan'>记录饮食，连接健康</Text>
            </View>

            {isDev && inviteCodeFromQuery && (
                <View className='dev-invite-code-banner'>
                    <Text className='dev-invite-code-text'>
                        【测试模式】邀请码：{inviteCodeFromQuery}
                    </Text>
                </View>
            )}

            <View className='login-actions'>
                {isDev && (
                    <View className='dev-test-input-wrapper'>
                        <Text className='dev-test-label'>测试 OpenID（留空则走正常流程）</Text>
                        <Input
                          className='dev-test-openid-input'
                          value={testOpenid}
                          onInput={(e) => setTestOpenid(e.detail.value)}
                          placeholder='输入测试 openid 模拟新用户'
                        />
                    </View>
                )}
                <TaroifyButton
                  className='wx-login-btn'
                  shape='round'
                  onClick={handleWxLogin}
                  loading={loading && !showProfileForm}
                >
                    手机号快捷登录
                </TaroifyButton>
                <TaroifyButton
                  className='skip-login-btn'
                  variant='text'
                  onClick={handleSkip}
                >
                    暂不登录，随便看看
                </TaroifyButton>
            </View>

            <View className='login-footer'>
                <View
                  className='agreement-row'
                  onClick={() => setAgreed(prev => !prev)}
                >
                    <View className={`agreement-checkbox ${agreed ? 'checked' : ''}`}>
                        {agreed && <Text className='agreement-check-icon'>✓</Text>}
                    </View>
                    <Text className='agreement-text'>
                        我已阅读并同意
                        <Text
                          className='agreement-link'
                          onClick={(e) => {
                                e.stopPropagation()
                                Taro.navigateTo({ url: extraPkgUrl('/pages/agreement/index') })
                            }}
                        >
                            《用户服务协议》
                        </Text>
                        、
                        <Text
                          className='agreement-link'
                          onClick={(e) => {
                                e.stopPropagation()
                                Taro.navigateTo({ url: extraPkgUrl('/pages/membership-agreement/index') })
                            }}
                        >
                            《会员服务协议》
                        </Text>
                        和
                        <Text
                          className='agreement-link'
                          onClick={(e) => {
                                e.stopPropagation()
                                Taro.navigateTo({ url: extraPkgUrl('/pages/privacy/index') })
                            }}
                        >
                            《隐私政策》
                        </Text>
                    </Text>
                </View>
            </View>

            {/* 登录成功但库中无手机号：引导授权绑定 */}
            {showPhoneBindModal && (
                <View className='profile-form-modal phone-bind-modal'>
                    <View className='profile-form-content'>
                        <View className='profile-form-header'>
                            <Text className='profile-form-title'>完善账号</Text>
                            <Text className='profile-form-desc'>授权手机号便于好友搜索与账号安全</Text>
                        </View>
                        <View className='phone-bind-actions'>
                            <Button
                              className='wx-login-btn-native phone-bind-btn'
                              openType='getPhoneNumber'
                              onGetPhoneNumber={handleBindPhone}
                            >
                                授权手机号
                            </Button>
                            <TaroifyButton
                              className='skip-phone-btn'
                              variant='text'
                              onClick={() => {
                                    setShowPhoneBindModal(false)
                                    finishLoginFlow()
                                }}
                            >
                                暂不绑定
                            </TaroifyButton>
                        </View>
                    </View>
                </View>
            )}

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
                          shape='round'
                          onClick={handleSaveProfile}
                        >
                            进入首页
                        </TaroifyButton>
                    </View>
                </View>
            )}
        </View>
        </FlPageThemeRoot>
    )
}
