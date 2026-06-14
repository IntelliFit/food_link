import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { apiClient, hasStoredToken } from '../api'

const DEFAULT_DEBUG_OPENID = 'mobile-poc-debug-openid'

interface AuthContextValue {
  isBootstrapping: boolean
  isAuthenticated: boolean
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
    loginWithDebugAccount,
    loginWithUserId,
    logout,
  }), [isBootstrapping, isAuthenticated, loginWithDebugAccount, loginWithUserId, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}
