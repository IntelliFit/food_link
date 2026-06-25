import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { BrandMark } from '@/components/brand-mark'
import { adminRequest, displayApiBase } from '@/lib/api'
import {
  BenchmarkPage,
  BenchmarkDatasetsSection,
  BenchmarkRunsSection,
  BenchmarkRunDetailSection,
} from '@/pages/benchmark-page'
import { FeedbackPage } from '@/pages/feedback-page'
import { FeedReportPage } from '@/pages/feed-report-page'
import { FeedReportDetailPage } from '@/pages/feed-report-detail-page'
import { ExerciseEnergyPage } from '@/pages/exercise-energy-page'
import { LoginPage } from '@/pages/login-page'
import { OverviewPage } from '@/pages/overview-page'
import { PackagedFoodsPage } from '@/pages/packaged-foods-page'
import { PackagedFoodTestPage } from '@/pages/packaged-food-test-page'
import { PackagedFoodTestRunsPage } from '@/pages/packaged-food-test-runs-page'
import { FoodNutritionPage } from '@/pages/food-nutrition-page'
import { PublicFoodLibraryPage } from '@/pages/public-food-library-page'
import { CampusDirectoryPage } from '@/pages/campus-directory-page'
import { PaymentTestPage } from '@/pages/payment-test-page'
import type { AdminMenuId } from '@/components/admin-sidebar'

const MENU_PATHS: Record<AdminMenuId, string> = {
  overview: '/',
  feedback: '/feedback',
  benchmark: '/benchmark',
  'packaged-foods': '/packaged-foods',
  'packaged-food-test': '/packaged-food-test',
  'food-nutrition': '/food-nutrition',
  'public-food-library': '/public-food-library',
  'campus-directory': '/campus-directory',
  'exercise-energy': '/exercise-energy',
  'feed-reports': '/feed-reports',
  'payment-test': '/payment-test',
  settings: '/settings',
}

/** Admin 根组件：会话检查、登录与业务路由 */
export function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    void checkSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleMenuChange = (menu: AdminMenuId) => {
    const path = MENU_PATHS[menu]
    if (path) {
      navigate(path)
    }
  }

  const pageProps = useMemo(
    () => ({
      onLogout: () => void logout(),
      onMenuChange: handleMenuChange,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  if (checkingSession) {
    return (
      <>
        <BootScreen message='正在检查管理员登录态…' />
        <Toaster richColors closeButton position='bottom-right' />
      </>
    )
  }

  if (!authenticated) {
    return (
      <>
        <LoginPage apiBase={displayApiBase()} onLogin={login} />
        <Toaster richColors closeButton position='bottom-right' />
      </>
    )
  }

  return (
    <>
      <Routes>
        <Route path='/' element={<Navigate to='/overview' replace />} />
        <Route path='/overview' element={<OverviewPage {...pageProps} />} />
        <Route path='/feedback' element={<FeedbackPage {...pageProps} />} />
        <Route path='/benchmark/*' element={<BenchmarkPage {...pageProps} />}>
          <Route index element={<Navigate to='datasets' replace />} />
          <Route path='datasets' element={<BenchmarkDatasetsSection />} />
          <Route path='runs' element={<BenchmarkRunsSection />} />
          <Route path='runs/:runId' element={<BenchmarkRunDetailSection />} />
        </Route>
        <Route path='/exercise-energy' element={<ExerciseEnergyPage {...pageProps} />} />
        <Route path='/feed-reports' element={<FeedReportPage {...pageProps} />} />
        <Route path='/feed-reports/:reportId' element={<FeedReportDetailPage {...pageProps} />} />
        <Route path='/packaged-foods' element={<PackagedFoodsPage {...pageProps} />} />
        <Route path='/packaged-food-test' element={<PackagedFoodTestPage {...pageProps} />} />
        <Route path='/packaged-food-test/runs/:foodId' element={<PackagedFoodTestRunsPage {...pageProps} />} />
        <Route path='/food-nutrition' element={<FoodNutritionPage {...pageProps} />} />
        <Route path='/public-food-library' element={<PublicFoodLibraryPage {...pageProps} />} />
        <Route path='/campus-directory' element={<CampusDirectoryPage {...pageProps} />} />
        <Route path='/payment-test' element={<PaymentTestPage {...pageProps} />} />
        <Route path='*' element={<Navigate to='/overview' replace />} />
      </Routes>
      <Toaster richColors closeButton position='bottom-right' />
    </>
  )
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className='relative z-10 flex min-h-svh flex-col items-center justify-center gap-3 text-muted-foreground'>
      <BrandMark />
      <div className='flex items-center gap-2 text-sm'>
        <Loader2 className='size-4 animate-spin' />
        {message}
      </div>
    </div>
  )
}
