import { View, Text, Image, Input } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'
import {
    login,
    LoginResponse,
    bindPhone,
    debugImpersonateUser,
    getUserProfile,
    updateUserInfo,
    requestFriendByInviteCode,
} from '../../../utils/api'
import { extraPkgUrl, normalizeRedirectUrlForSubpackage, MAIN_TAB_ROUTES } from '../../../utils/subpackage-extra'
import { isPublicPage } from '../../../utils/withAuth'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { cleanupGeneratedUserFiles } from '../../../utils/weapp-user-files'
import { NewUserOnboardingModals } from '../../../components/NewUserOnboardingModals'
import { processChooseAvatarSelection, ensureAvatarUploadedForSave, getInitialRegistrationAvatar } from '../../../utils/new-user-profile-form'
import { shouldShowProfileFormFromApiUser } from '../../../utils/new-user-onboarding-scenarios'
import { resolveRegistrationNickname, buildDefaultWechatNickname } from '../../../utils/default-user-profile'

import loginLogo from '../../../assets/login-logo.png'
import './index.scss'

interface UserInfo {
    avatar: string
    name: string
    meta: string
}

/** 安全返回：若上一页是受保护页面则跳转首页，避免循环跳转 */
function safeNavigateBack() {
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
        const prevPage = pages[pages.length - 2]
        const prevRoute = `/${prevPage.route || ''}`
        // 如果上一页是登录页本身，避免循环
        if (prevRoute === extraPkgUrl('/pages/login/index')) {
            Taro.switchTab({ url: '/pages/index/index' })
            return
        }
        // 如果上一页不是公共页面且不是主 Tab 页，说明需要登录才能访问
        // navigateBack 会再次触发登录跳转，形成循环，因此直接去首页
        const isSafe = isPublicPage(prevRoute) || MAIN_TAB_ROUTES.has(prevRoute)
        if (!isSafe) {
            Taro.switchTab({ url: '/pages/index/index' })
            return
        }
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

function stripTraceText(text: string): string {
    return String(text || '')
        .replace(/\s*[\(（]?\s*traceId\s*[:：]\s*[a-fA-F0-9]+\s*[\)）]?\s*$/i, '')
        .trim()
}

async function showLoginErrorToast(error: unknown, fallback: string): Promise<void> {
    const raw = String((error as any)?.message || fallback || '请求失败，请稍后重试')
    const base = stripTraceText(raw) || fallback || '请求失败，请稍后重试'
    const title = base.length > 26 ? `${base.slice(0, 25)}…` : base
    console.warn('[login] request failed', {
        message: raw,
        traceId: String((error as any)?.traceId || '').trim() || undefined,
    })
    // 避免与 setState/loading 同帧冲突导致 toast 被 loading 覆盖
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
        await Taro.showToast({ title, icon: 'none', duration: 2200 })
    } catch (toastError) {
        console.warn('[login] showToast failed', toastError)
    }
}

export default function LoginPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [showProfileForm, setShowProfileForm] = useState(false)
    /** 登录成功但库中无手机号时展示，引导用户授权绑定 */
    const [showPhoneBindModal, setShowPhoneBindModal] = useState(false)
    const [showDebugLoginPanel, setShowDebugLoginPanel] = useState(false)
    /** 当前登录链路是否已完成首次健康档案 */
    const [pendingOnboardingCompleted, setPendingOnboardingCompleted] = useState(true)
    /** 是否已同意用户协议与隐私政策 */
    const [agreed, setAgreed] = useState(false)

    // 临时头像和昵称（用于完善信息）
    const [tempAvatar, setTempAvatar] = useState('')
    const [tempNickname, setTempNickname] = useState('')
    const [debugUserId, setDebugUserId] = useState('')
    const [debugPassword, setDebugPassword] = useState('')

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
        Taro.switchTab({ url: '/pages/index/index' })
    }

    const continueAfterAuthGates = (onboardingCompleted: boolean) => {
        if (!onboardingCompleted) {
            Taro.redirectTo({ url: extraPkgUrl('/pages/health-profile/index') })
            return
        }
        finishLoginFlow()
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
            await cleanupGeneratedUserFiles()
            const loginRes = await Taro.login()
            if (!loginRes.code) throw new Error('获取登录凭证失败')
            const loginData: LoginResponse = await login(loginRes.code, undefined, inviteCodeFromQuery)
            await handleLoginSuccess(loginData)
        } catch (error: any) {
            console.error('登录失败:', error)
            await showLoginErrorToast(error, '登录失败')
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
            setTimeout(() => { continueAfterAuthGates(pendingOnboardingCompleted) }, 800)
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
            setTimeout(() => { continueAfterAuthGates(pendingOnboardingCompleted) }, 1000)
        } catch (err: any) {
            Taro.hideLoading()
            await showLoginErrorToast(err, '绑定失败')
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
            const displayName = resolveRegistrationNickname(apiUserInfo.nickname, loginData.openid)
            const userInfo: UserInfo = {
                avatar: getInitialRegistrationAvatar(apiUserInfo.avatar),
                name: displayName,
                meta: '已记录 0 天' // 初始值，profile 页面会刷新
            }
            Taro.setStorageSync('userInfo', userInfo)
            Taro.setStorageSync('isLoggedIn', true)

            Taro.showToast({
                title: '登录成功',
                icon: 'success'
            })

            const onboardingCompleted = apiUserInfo.onboarding_completed === true
            setPendingOnboardingCompleted(onboardingCompleted)

            // 检查是否需要完善头像/昵称
            // API 返回的 avatar 可能为空字符串，nickname 可能为空
            if (shouldShowProfileFormFromApiUser(apiUserInfo)) {
                setTempAvatar(getInitialRegistrationAvatar(apiUserInfo.avatar))
                setTempNickname(resolveRegistrationNickname(apiUserInfo.nickname, loginData.openid))
                setLoading(false)
                setShowProfileForm(true) // 显示完善信息弹窗
            } else {
                setLoading(false)
                // 库中已有手机号则直接返回；否则弹出授权手机号弹窗
                if (loginData.purePhoneNumber) {
                    setTimeout(() => { continueAfterAuthGates(onboardingCompleted) }, 1500)
                } else {
                    setShowPhoneBindModal(true)
                }
            }

        } catch (error) {
            console.error('获取用户信息失败', error)
            // 即使获取失败，也算登录成功
            Taro.setStorageSync('isLoggedIn', true)
            setLoading(false)
            setTempAvatar(getInitialRegistrationAvatar(''))
            setTempNickname(buildDefaultWechatNickname(loginData.openid))
            setShowProfileForm(true) // 兜底：预填默认头像昵称，用户可直接进入
        }
    }

    // 跳过登录
    const handleSkip = () => {
        safeNavigateBack()
    }

    const handleDebugImpersonate = async () => {
        if (!isDev || loading) return
        setLoading(true)
        try {
            const loginData = await debugImpersonateUser(debugUserId, debugPassword)
            await handleLoginSuccess(loginData)
            setShowDebugLoginPanel(false)
        } catch (error: any) {
            console.error('调试代登录失败:', error)
            await showLoginErrorToast(error, '代登录失败')
        } finally {
            setLoading(false)
        }
    }

    const handleChooseAvatar = async (e: { detail?: { avatarUrl?: string } }) => {
        const avatarUrl = e.detail?.avatarUrl
        if (!avatarUrl) return
        try {
            await processChooseAvatarSelection(avatarUrl, setTempAvatar)
        } catch (err: unknown) {
            await showLoginErrorToast(err, '上传失败')
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
            const avatarToSave = await ensureAvatarUploadedForSave(tempAvatar)
            await updateUserInfo({
                nickname: tempNickname,
                avatar: avatarToSave
            })

            // 更新本地 storage
            const currentUser = Taro.getStorageSync('userInfo') || {}
            currentUser.avatar = avatarToSave
            currentUser.name = tempNickname
            Taro.setStorageSync('userInfo', currentUser)

            Taro.hideLoading()
            Taro.showToast({ title: '保存成功', icon: 'success' })

            setShowProfileForm(false)
            setTimeout(() => {
                const hasPhone = String(Taro.getStorageSync('phoneNumber') || '').trim().length > 0
                if (hasPhone) {
                    continueAfterAuthGates(pendingOnboardingCompleted)
                    return
                }
                setShowPhoneBindModal(true)
            }, 1500)

        } catch (err: any) {
            Taro.hideLoading()
            await showLoginErrorToast(err, '保存失败')
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
                {isDev && (
                    <TaroifyButton
                      className='debug-login-btn'
                      variant='text'
                      onClick={() => setShowDebugLoginPanel(true)}
                    >
                        调试代登录
                    </TaroifyButton>
                )}
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

            <NewUserOnboardingModals
              showProfileForm={showProfileForm}
              showPhoneBindModal={showPhoneBindModal}
              tempAvatar={tempAvatar}
              tempNickname={tempNickname}
              onChooseAvatar={handleChooseAvatar}
              onNicknameInput={setTempNickname}
              onNicknameBlur={handleNicknameBlur}
              onSaveProfile={handleSaveProfile}
              onBindPhone={handleBindPhone}
              onSkipPhone={() => {
                setShowPhoneBindModal(false)
                continueAfterAuthGates(pendingOnboardingCompleted)
              }}
            />

            {isDev && showDebugLoginPanel && (
                <View className='profile-form-modal debug-login-modal'>
                    <View className='profile-form-content'>
                        <View className='profile-form-header'>
                            <Text className='profile-form-title'>调试代登录</Text>
                            <Text className='profile-form-desc'>输入目标用户 ID，直接进入该用户的小程序态</Text>
                        </View>
                        <View className='profile-form-body'>
                            <Input
                              className='nickname-input'
                              placeholder='请输入用户 ID'
                              value={debugUserId}
                              onInput={(e) => setDebugUserId(e.detail.value)}
                            />
                            <Input
                              className='nickname-input'
                              password
                              placeholder='请输入 test-backend 调试密码'
                              value={debugPassword}
                              onInput={(e) => setDebugPassword(e.detail.value)}
                            />
                        </View>
                        <View className='phone-bind-actions'>
                            <TaroifyButton
                              className='save-btn'
                              block
                              shape='round'
                              onClick={handleDebugImpersonate}
                              loading={loading}
                            >
                                进入该用户
                            </TaroifyButton>
                            <TaroifyButton
                              className='skip-phone-btn'
                              variant='text'
                              onClick={() => setShowDebugLoginPanel(false)}
                            >
                                取消
                            </TaroifyButton>
                        </View>
                    </View>
                </View>
            )}

        </View>
        </FlPageThemeRoot>
    )
}
