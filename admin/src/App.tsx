import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { BrandMark } from '@/components/brand-mark'
import { adminRequest, displayApiBase } from '@/lib/api'
import { BenchmarkPage } from '@/pages/benchmark-page'
import { FeedbackPage } from '@/pages/feedback-page'
import { LoginPage } from '@/pages/login-page'
import type { AdminMenuId } from '@/components/admin-sidebar'

/** Admin 根组件：会话检查、登录与业务页切换 */
export function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [currentMenu, setCurrentMenu] = useState<AdminMenuId>('feedback')

  useEffect(() => {
    void checkSession()
  }, [])

  async function checkSession() {
    setCheckingSession(true)
    try {
      await adminRequest<{ authenticated: boolean }>('/api/admin/session')
      setAuthenticated(true)
    } catch {
      setAuthenticated(false)
    } finally {
      setCheckingSession(false)
    }
  }

  async function login(username: string, password: string) {
    await adminRequest<{ authenticated: boolean }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setAuthenticated(true)
  }

  async function logout() {
    try {
      await adminRequest<{ authenticated: boolean }>('/api/admin/logout', { method: 'POST' })
    } finally {
      setAuthenticated(false)
      toast.message('已退出登录')
    }
  }

  if (checkingSession) {
    return (
      <>
        <BootScreen message="正在检查管理员登录态…" />
        <Toaster richColors closeButton position="bottom-right" />
      </>
    )
  }

  if (!authenticated) {
    return (
      <>
        <LoginPage apiBase={displayApiBase()} onLogin={login} />
        <Toaster richColors closeButton position="bottom-right" />
      </>
    )
  }

  return (
    <>
      {currentMenu === 'benchmark' ? (
        <BenchmarkPage onLogout={() => void logout()} onMenuChange={setCurrentMenu} />
      ) : (
        <FeedbackPage onLogout={() => void logout()} onMenuChange={setCurrentMenu} />
      )}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  )
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className="relative z-10 flex min-h-svh flex-col items-center justify-center gap-3 text-muted-foreground">
      <BrandMark />
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {message}
      </div>
    </div>
  )
}
