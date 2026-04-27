import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, useCallback } from 'react'
import { FlPageThemeRoot } from '../components/FlPageThemeRoot'
import { useAppColorScheme } from '../components/AppColorSchemeContext'
import { getAccessToken } from './api'
import { extraPkgUrl } from './subpackage-extra'
import { applyThemeNavigationBar } from './theme-navigation-bar'

// 不需要登录的页面白名单（含分包路径）
const PUBLIC_PAGES = new Set([
  extraPkgUrl('/pages/login/index'),
  extraPkgUrl('/pages/agreement/index'),
  extraPkgUrl('/pages/privacy/index'),
  extraPkgUrl('/pages/about/index'),
])

/**
 * 检查当前页面是否需要登录
 */
export function isPublicPage(path: string): boolean {
  // 移除查询参数
  const cleanPath = path.split('?')[0]
  return PUBLIC_PAGES.has(cleanPath)
}

/**
 * 获取当前页面路径（包含查询参数）
 */
export function getCurrentPagePath(): string {
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) return ''
  const currentPage = pages[pages.length - 1]
  const route = currentPage.route || ''
  const options = currentPage.options || {}
  const queryString = Object.keys(options)
    .map(key => `${key}=${encodeURIComponent(options[key])}`)
    .join('&')
  return `/${route}${queryString ? '?' + queryString : ''}`
}

/**
 * 获取当前页面路由（不包含查询参数）
 */
export function getCurrentPageRoute(): string {
  const pages = Taro.getCurrentPages()
  if (pages.length === 0) return ''
  const currentPage = pages[pages.length - 1]
  return `/${currentPage.route || ''}`
}

/**
 * 跳转到登录页
 */
export function redirectToLogin(redirectPath?: string) {
  const currentPath = redirectPath || getCurrentPagePath()
  const loginBase = extraPkgUrl('/pages/login/index')
  const loginUrl = `${loginBase}?redirect=${encodeURIComponent(currentPath)}`

  // 检查当前页面是否已经是登录页，避免重复跳转
  const currentRoute = getCurrentPageRoute()
  if (currentRoute === loginBase) {
    return
  }
  
  Taro.navigateTo({
    url: loginUrl,
    fail: () => {
      // 如果 navigateTo 失败（可能是页面栈满），尝试 redirectTo
      Taro.redirectTo({ url: loginUrl })
    }
  })
}

/**
 * 检查用户是否已登录
 */
export function checkIsLoggedIn(): boolean {
  return !!getAccessToken()
}

/**
 * 全局登录守卫检查
 * 在 useDidShow 或页面初始化时调用
 */
export function checkAuth(): boolean {
  const route = getCurrentPageRoute()
  
  // 如果是公共页面，不需要检查登录
  if (isPublicPage(route)) {
    return true
  }
  
  // 检查登录状态
  if (!checkIsLoggedIn()) {
    const fullPath = getCurrentPagePath()
    redirectToLogin(fullPath)
    return false
  }
  
  return true
}

/**
 * 高阶组件：为页面添加登录守卫
 * 当用户未登录时，自动跳转到登录页面
 * 
 * 使用方法：
 * export default withAuth(PageComponent)
 * 或
 * export default withAuth(PageComponent, { public: true }) // 允许未登录访问
 */
export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    /** 是否允许未登录访问（默认 false） */
    public?: boolean
    /** 自定义未登录时的处理逻辑，返回 true 则阻止默认跳转 */
    onUnauthenticated?: () => boolean
  }
): React.FC<P> {
  return function WithAuthComponent(props: P) {
    const { scheme } = useAppColorScheme()
    /** 已登录时首帧即渲染，避免分包页（如记录详情）短暂空白 */
    const [isAuthenticated, setIsAuthenticated] = useState(
      () => Boolean(options?.public) || checkIsLoggedIn()
    )

    const doAuthCheck = useCallback(() => {
      // 如果是公共页面，直接通过
      if (options?.public) {
        setIsAuthenticated(true)
        return
      }

      const currentRoute = getCurrentPageRoute()
      
      // 如果是公共页面，不需要检查登录
      if (isPublicPage(currentRoute)) {
        setIsAuthenticated(true)
        return
      }

      // 检查登录状态
      const loggedIn = checkIsLoggedIn()
      
      if (!loggedIn) {
        // 如果有自定义处理逻辑，先执行
        if (options?.onUnauthenticated && options.onUnauthenticated()) {
          return
        }
        
        // 默认跳转到登录页
        const fullPath = getCurrentPagePath()
        redirectToLogin(fullPath)
      } else {
        setIsAuthenticated(true)
      }
    }, [])

    // 页面显示时检查
    useDidShow(() => {
      applyThemeNavigationBar(scheme)
      doAuthCheck()
    })

    // 首次加载时也检查
    useEffect(() => {
      applyThemeNavigationBar(scheme)
      doAuthCheck()
    }, [])

    useEffect(() => {
      applyThemeNavigationBar(scheme)
    }, [scheme])

    // 如果是公共页面或已登录，正常渲染
    if (options?.public || isAuthenticated) {
      return (
        <FlPageThemeRoot>
          <WrappedComponent {...props} />
        </FlPageThemeRoot>
      )
    }

    // 未登录且不是公共页面，返回空（页面已经跳转了）
    return null
  }
}

/**
 * Hook：使用登录守卫
 * 在页面组件中调用，会自动在页面显示时检查登录状态
 * 
 * 使用方法：
 * const { isLoggedIn } = useAuthGuard()
 * 或
 * const { isLoggedIn } = useAuthGuard({ public: true }) // 允许未登录访问
 */
export function useAuthGuard(options?: {
  /** 是否允许未登录访问（默认 false） */
  public?: boolean
  /** 自定义未登录时的处理逻辑 */
  onUnauthenticated?: () => void
}): {
  isLoggedIn: boolean
  isChecking: boolean
  redirectToLogin: (redirectPath?: string) => void
} {
  const [isLoggedIn, setIsLoggedIn] = useState(options?.public || false)
  const [isChecking, setIsChecking] = useState(true)

  const doCheck = useCallback(() => {
    // 如果是公共页面，不需要检查登录
    const currentRoute = getCurrentPageRoute()
    if (options?.public || isPublicPage(currentRoute)) {
      setIsChecking(false)
      setIsLoggedIn(true)
      return
    }

    const loggedIn = checkIsLoggedIn()
    setIsLoggedIn(loggedIn)
    setIsChecking(false)

    if (!loggedIn) {
      if (options?.onUnauthenticated) {
        options.onUnauthenticated()
      } else {
        // 默认跳转到登录页
        const fullPath = getCurrentPagePath()
        redirectToLogin(fullPath)
      }
    }
  }, [])

  // 页面显示时检查
  useDidShow(() => {
    doCheck()
  })

  // 首次加载时也检查
  useEffect(() => {
    doCheck()
  }, [])

  return {
    isLoggedIn,
    isChecking,
    redirectToLogin,
  }
}

export default withAuth
