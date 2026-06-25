import React, { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OverviewTab } from './pages/board/OverviewTab'
import { AnchorPerformanceTab } from './pages/board/AnchorPerformanceTab'
import { BuyerRankingTab } from './pages/board/BuyerRankingTab'
import { SettingsTab } from './pages/board/SettingsTab'
import { OperationsReportPage } from './pages/operations/OperationsReportPage'
import { AmountDisplayProvider } from './providers/AmountDisplayProvider'
import { loadAndApplyAppFavicon } from './lib/app-favicon'

const App: React.FC = () => {
  useEffect(() => {
    void loadAndApplyAppFavicon()
  }, [])
  return (
    <AmountDisplayProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AmountDisplayProvider>
  )
}

export default App
