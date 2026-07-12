import React, { Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewTab } from './pages/board/OverviewTab'
import { AnchorPerformanceTab } from './pages/board/AnchorPerformanceTab'
import { AnchorSchedulePage } from './pages/board/AnchorSchedulePage'
import { BuyerRankingTab } from './pages/board/BuyerRankingTab'
import { SettingsTab } from './pages/board/SettingsTab'
import { OperationsReportPage } from './pages/operations/OperationsReportPage'
import { DataHealthPage } from './pages/board/DataHealthPage'
import { LuckyGiftsPage } from './pages/board/LuckyGiftsPage'
import { BossDashboardPage } from './pages/boss/BossDashboardPage'
import { DailyReportMobileUploadPage } from './pages/mobile/DailyReportMobileUploadPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { RequireAuth } from './components/auth/RequireAuth'
import { AmountDisplayProvider } from './providers/AmountDisplayProvider'
import { AuthProvider } from './providers/AuthProvider'
import { loadAndApplyAppFavicon } from './lib/app-favicon'

const GoodReviewsPage = React.lazy(() =>
  import('./pages/good-reviews/GoodReviewsPage').then((m) => ({ default: m.GoodReviewsPage })),
)

function GoodReviewsPageFallback(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-8 text-sm text-slate-500">
      正在打开好评中心...
    </div>
  )
}

const App: React.FC = () => {
  useEffect(() => {
    void loadAndApplyAppFavicon()
  }, [])
  return (
    <AmountDisplayProvider>
      <AuthProvider>
        <BrowserRouter
          basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/mobile/daily-report-upload" element={<DailyReportMobileUploadPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<OverviewTab />} />
                <Route path="anchors" element={<AnchorPerformanceTab />} />
                <Route path="anchor-schedules" element={<AnchorSchedulePage />} />
                <Route path="anchors/:anchorId" element={<Navigate to="/anchors" replace />} />
                <Route path="buyers" element={<BuyerRankingTab />} />
                <Route path="lucky-gifts" element={<LuckyGiftsPage />} />
                <Route path="anchor-weekly-ranking" element={<Navigate to="/buyers" replace />} />
                <Route path="operations-report" element={<OperationsReportPage />} />
                <Route path="data-health" element={<DataHealthPage />} />
                <Route
                  path="good-reviews"
                  element={
                    <Suspense fallback={<GoodReviewsPageFallback />}>
                      <GoodReviewsPage />
                    </Suspense>
                  }
                />
                <Route path="boss-dashboard" element={<BossDashboardPage />} />
                <Route path="orders" element={<Navigate to="/" replace />} />
                <Route path="billing" element={<Navigate to="/" replace />} />
                <Route path="settings" element={<SettingsTab />} />
                <Route path="dashboard" element={<Navigate to="/" replace />} />
                <Route path="buyer-ranking" element={<Navigate to="/buyers" replace />} />
                <Route path="admin" element={<Navigate to="/settings" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AmountDisplayProvider>
  )
}

export default App
