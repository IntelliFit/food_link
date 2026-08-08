import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { apiClient, hasStoredToken } from '../api'
import { authorizeWithWechat, isNativeWechatAuthAvailable } from '../native/wechatAuth'

const DEFAULT_DEBUG_OPENID = 'mobile-poc-debug-openid'
const DEFAULT_APP_WECHAT_DEV_CODE = process.env.EXPO_PUBLIC_APP_WECHAT_DEV_CODE || 'expo-go-dev-wechat-code'

interface AuthContextValue {
  isBootstrapping: boolean
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

  useEffect(() => {
    hasStoredToken()
      .then(setIsAuthenticated)
      .finally(() => setIsBootstrapping(false))
  }, [])

  const loginWithDebugAccount = useCallback(async () => {
    await apiClient.debugLoginWithTestOpenID(DEFAULT_DEBUG_OPENID)
    setIsAuthenticated(true)
  }, [])

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
    setIsAuthenticated(true)
  }, [])

  const loginWithPassword = useCallback(async (phone: string, password: string) => {
    await apiClient.loginWithPassword({ phone, password })
    setIsAuthenticated(true)
  }, [])

  const loginWithSMSCode = useCallback(async (phone: string, code: string, inviteCode?: string) => {
    await apiClient.loginWithSMSCode({ phone, code, inviteCode })
    setIsAuthenticated(true)
  }, [])

  const resetPasswordWithSMS = useCallback(async (phone: string, code: string, password: string) => {
    await apiClient.resetAccountPassword({ phone, code, password })
    setIsAuthenticated(true)
  }, [])

  const registerWithPassword = useCallback(async (phone: string, password: string, nickname?: string, inviteCode?: string) => {
    await apiClient.registerWithPassword({ phone, password, nickname, inviteCode })
    setIsAuthenticated(true)
  }, [])

  const loginWithUserId = useCallback(async (userId: string, password: string) => {
    await apiClient.debugImpersonateUser(userId, password)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(async () => {
    await apiClient.clearTokens()
    setIsAuthenticated(false)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    isBootstrapping,
    isAuthenticated,
    loginWithWechat,
    loginWithPassword,
    loginWithSMSCode,
    resetPasswordWithSMS,
    registerWithPassword,
    loginWithDebugAccount,
    loginWithUserId,
    logout,
  }), [isBootstrapping, isAuthenticated, loginWithWechat, loginWithPassword, loginWithSMSCode, resetPasswordWithSMS, registerWithPassword, loginWithDebugAccount, loginWithUserId, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}
