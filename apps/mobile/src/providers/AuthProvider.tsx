import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import type { AccountDeletionStatus } from '@food-link/core'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { apiClient, getStoredUserId, hasStoredToken, subscribeFoodRecordChanges, subscribeAccountStateChanges } from '../api'
import { syncNotificationDiagnosticOwner } from '../diagnostics/notificationDiagnostics'
import { syncLocalMealSession } from '../native/localMeals'
import { addHonorPushTokenListener } from '../native/honorPush'
import { authorizeWithWechat, isNativeWechatAuthAvailable } from '../native/wechatAuth'
import { refreshReminderDevice, refreshLocalMealRecords, revokeReminderDevice, setReminderSessionActive } from '../utils/businessNotifications'

const DEFAULT_DEBUG_OPENID = 'mobile-poc-debug-openid'
const DEFAULT_APP_WECHAT_DEV_CODE = process.env.EXPO_PUBLIC_APP_WECHAT_DEV_CODE || 'expo-go-dev-wechat-code'

interface AuthContextValue {
  isBootstrapping: boolean
  accountDeletionStatus: AccountDeletionStatus | null
  accountStatusError: boolean
  refreshAccountStatus: () => Promise<void>
  isAuthenticated: boolean
  loginWithWechat: (inviteCode?: string) => Promise<void>
  loginWithPassword: (phone: string, password: string) => Promise<void>
  loginWithSMSCode: (phone: string, code: string, inviteCode?: string) => Promise<void>
  resetPasswordWithSMS: (phone: string, code: string, password: string) => Promise<void>
  registerWithPassword: (phone: string, password: string, nickname?: string, inviteCode?: string) => Promise<void>
  loginWithDebugAccount: () => Promise<void>
  loginWithUserId: (userId: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const [accountDeletionStatus, setAccountDeletionStatus] = useState<AccountDeletionStatus | null>(null)
  const [accountStatusError, setAccountStatusError] = useState(false)
  const accountEpoch = useRef(0)
  const refreshAccountStatus = useCallback(async () => {
    const epoch = ++accountEpoch.current
    try {
      const status = await apiClient.getAccountDeletionStatus()
      if (epoch !== accountEpoch.current) return
      setAccountDeletionStatus(status)
      setAccountStatusError(false)
    } catch (error) {
      if (epoch !== accountEpoch.current) return
      if ((error as { status?: number })?.status === 401) {
        await apiClient.clearTokens()
        setAccountDeletionStatus(null)
        setAccountStatusError(false)
        setIsAuthenticated(false)
      } else setAccountStatusError(true)
    }
  }, [])
  const accountUsable = isAuthenticated && !accountStatusError && (!accountDeletionStatus || ['active', 'cancelled'].includes(accountDeletionStatus.state))

  useEffect(() => {
    void (async () => {
      if (await hasStoredToken()) {
        await refreshAccountStatus()
        setIsAuthenticated(await hasStoredToken())
      }
      setIsBootstrapping(false)
    })()
  }, [refreshAccountStatus])

  useEffect(() => subscribeAccountStateChanges(() => { void refreshAccountStatus() }), [refreshAccountStatus])
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isAuthenticated) void refreshAccountStatus()
    })
    return () => listener.remove()
  }, [isAuthenticated, refreshAccountStatus])

  useEffect(() => {
    if (isBootstrapping) return undefined
    let active = true
    void (async () => {
      const owner = accountUsable ? await getStoredUserId() : null
      if (active) await syncNotificationDiagnosticOwner(owner)
      if (active) await syncLocalMealSession(owner)
    })().catch(() => undefined)
    return () => { active = false }
  }, [accountUsable, isBootstrapping])

  useEffect(() => {
    setReminderSessionActive(accountUsable)
    if (!accountUsable) return undefined
    const refresh = () => { void refreshReminderDevice().catch(() => undefined) }
    refresh()
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') refresh() })
    const tokenChange = Notifications.addPushTokenListener(refresh)
    const honorTokenChange = addHonorPushTokenListener(refresh)
    const recordsChange = subscribeFoodRecordChanges(() => { void refreshLocalMealRecords().catch(() => undefined) })
    return () => {
      setReminderSessionActive(false)
      foreground.remove()
      tokenChange.remove()
      honorTokenChange.remove()
      recordsChange()
    }
  }, [accountUsable])

  const loginWithDebugAccount = useCallback(async () => {
    await apiClient.debugLoginWithTestOpenID(DEFAULT_DEBUG_OPENID)
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const loginWithWechat = useCallback(async (inviteCode?: string) => {
    const code = isNativeWechatAuthAvailable()
      ? await authorizeWithWechat()
      : __DEV__
        ? DEFAULT_APP_WECHAT_DEV_CODE
        : ''
    if (!code) {
      throw new Error('当前 App 包不包含微信登录组件，请安装最新正式包后重试')
    }
    await apiClient.loginWithAppWechat({ code, inviteCode })
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const loginWithPassword = useCallback(async (phone: string, password: string) => {
    await apiClient.loginWithPassword({ phone, password })
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const loginWithSMSCode = useCallback(async (phone: string, code: string, inviteCode?: string) => {
    await apiClient.loginWithSMSCode({ phone, code, inviteCode })
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const resetPasswordWithSMS = useCallback(async (phone: string, code: string, password: string) => {
    await apiClient.resetAccountPassword({ phone, code, password })
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const registerWithPassword = useCallback(async (phone: string, password: string, nickname?: string, inviteCode?: string) => {
    await apiClient.registerWithPassword({ phone, password, nickname, inviteCode })
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const loginWithUserId = useCallback(async (userId: string, password: string) => {
    await apiClient.debugImpersonateUser(userId, password)
    await refreshAccountStatus()
    setIsAuthenticated(await hasStoredToken())
  }, [refreshAccountStatus])

  const logout = useCallback(async () => {
    accountEpoch.current += 1
    setAccountDeletionStatus(null)
    setAccountStatusError(false)
    await revokeReminderDevice().catch(() => undefined)
    await apiClient.clearTokens()
    setIsAuthenticated(false)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    isBootstrapping,
    accountDeletionStatus,
    accountStatusError,
    refreshAccountStatus,
    isAuthenticated,
    loginWithWechat,
    loginWithPassword,
    loginWithSMSCode,
    resetPasswordWithSMS,
    registerWithPassword,
    loginWithDebugAccount,
    loginWithUserId,
    logout,
  }), [isBootstrapping, accountDeletionStatus, accountStatusError, refreshAccountStatus, isAuthenticated, loginWithWechat, loginWithPassword, loginWithSMSCode, resetPasswordWithSMS, registerWithPassword, loginWithDebugAccount, loginWithUserId, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}
