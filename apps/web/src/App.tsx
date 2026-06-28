import React, { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewTab } from './pages/board/OverviewTab'
import { AnchorPerformanceTab } from './pages/board/AnchorPerformanceTab'
import { BuyerRankingTab } from './pages/board/BuyerRankingTab'
import { SettingsTab } from './pages/board/SettingsTab'
import { OperationsReportPage } from './pages/operations/OperationsReportPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { RequireAuth } from './components/auth/RequireAuth'
import { AmountDisplayProvider } from './providers/AmountDisplayProvider'
import { AuthProvider } from './providers/AuthProvider'
import { loadAndApplyAppFavicon } from './lib/app-favicon'

const App: React.FC = () => {
  useEffect(() => {
    void loadAndApplyAppFavicon()
  }, [])
  return (
    <AmountDisplayProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<OverviewTab />} />
                <Route path="anchors" element={<AnchorPerformanceTab />} />
                <Route path="anchors/:anchorId" element={<Navigate to="/anchors" replace />} />
                <Route path="buyers" element={<BuyerRankingTab />} />
                <Route path="operations-report" element={<OperationsReportPage />} />
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
