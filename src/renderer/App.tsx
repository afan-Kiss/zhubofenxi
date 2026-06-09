import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, FileDown, FileUp, Play, Settings2 } from 'lucide-react'
import { AdvancedDiagnosticsPanel } from './components/AdvancedDiagnosticsPanel'
import { AnchorSettingsDrawer } from './components/AnchorSettingsDrawer'
import { AnchorBusinessCard } from './components/AnchorBusinessCard'
import { BusinessTabPanel } from './components/BusinessTabPanel'
import { BuyerRankingCompact } from './components/BuyerRankingCompact'
import { DonutChart } from './components/DonutChart'
import { OverviewMetrics } from './components/OverviewMetrics'
import { QualityReturnPanel } from './components/QualityReturnPanel'
import { UploadSlotGrid } from './components/UploadSlotGrid'
import { useAnchorConfig } from './hooks/useAnchorConfig'
import { useFieldMappings } from './hooks/useFieldMappings'
import { useImportedFiles } from './hooks/useImportedFiles'
import { analyzeBusiness, formatCentToMoney } from './lib/businessAnalyzer'
import { canPreprocessOrders, preprocessOrders } from './lib/orderPreprocessor'
import { buildReportText } from './lib/reportText'
import { canPreprocessSettlement, preprocessSettlement } from './lib/settlementPreprocessor'
import type { AnalysisStatus, BusinessAnalysisResult } from './types/business'
import type { OrderDedupeResult } from './types/order'
import type { SettlementPreprocessResult } from './types/settlement'

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  idle: '未分析',
  analyzing: '分析中',
  done: '分析完成',
  done_with_warnings: '存在异常',
  error: '分析失败',
}

const App: React.FC = () => {
  const {
    importedFiles,
    slotFiles,
    importCount,
    selectedOrderFile,
    selectedLiveFile,
    selectedPendingSettlementFile,
    selectedSettledSettlementFile,
    toast,
    importFromFileList,
    openFileDialog,
    removeFile,
    updateFileType,
  } = useImportedFiles()

  const {
    orderMapping,
    liveMapping,
    pendingSettlementMapping,
    settledSettlementMapping,
    orderFile,
    liveFile,
    pendingSettlementFile,
    settledSettlementFile,
    updateFieldMapping,
  } = useFieldMappings(
    importedFiles,
    selectedOrderFile,
    selectedLiveFile,
    selectedPendingSettlementFile,
    selectedSettledSettlementFile,
  )

  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [analysisResult, setAnalysisResult] = useState<BusinessAnalysisResult | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null)
  const [buyerFilter, setBuyerFilter] = useState<string | null>(null)

  const [preprocessResult, setPreprocessResult] = useState<OrderDedupeResult | null>(null)
  const [settlementResult, setSettlementResult] = useState<SettlementPreprocessResult | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const {
    config: anchorConfig,
    loaded: anchorConfigLoaded,
    saveError: anchorSaveError,
    addAnchor,
    updateAnchor,
    removeAnchor,
    addTimeRule,
    updateTimeRule,
    removeTimeRule,
    resetConfig,
  } = useAnchorConfig()

  const canPreprocess = useMemo(
    () => canPreprocessOrders(orderFile, orderMapping),
    [orderFile, orderMapping],
  )

  const preprocessDisabledReason = useMemo(() => {
    if (!orderFile) return '未导入订单表'
    if (!orderMapping) return '请先完成订单表字段映射'
    if (orderMapping.missingRequiredFields.length > 0) {
      return '订单表缺少关键字段'
    }
    return undefined
  }, [orderFile, orderMapping])

  const settlementCheck = useMemo(
    () =>
      canPreprocessSettlement(
        pendingSettlementFile,
        pendingSettlementMapping,
        settledSettlementFile,
        settledSettlementMapping,
      ),
    [
      pendingSettlementFile,
      pendingSettlementMapping,
      settledSettlementFile,
      settledSettlementMapping,
    ],
  )

  const hasBuyerField = useMemo(
    () => Boolean(orderMapping?.mappings.find((m) => m.key === 'buyerId' && m.header)),
    [orderMapping],
  )

  useEffect(() => {
    setAnalysisResult(null)
    setAnalysisStatus('idle')
    setAnalysisMessage(null)
    setPreprocessResult(null)
    setSettlementResult(null)
    setBuyerFilter(null)
  }, [
    orderFile?.id,
    orderMapping?.mappings,
    pendingSettlementFile?.id,
    pendingSettlementMapping?.mappings,
    settledSettlementFile?.id,
    settledSettlementMapping?.mappings,
  ])

  const handlePreprocess = useCallback(() => {
    if (!orderFile || !orderMapping) return
    const result = preprocessOrders(orderFile, orderMapping)
    if (result.ok && result.dedupeResult) setPreprocessResult(result.dedupeResult)
  }, [orderFile, orderMapping])

  const handleSettlementPreprocess = useCallback(() => {
    const result = preprocessSettlement(
      pendingSettlementFile,
      pendingSettlementMapping,
      settledSettlementFile,
      settledSettlementMapping,
    )
    if (result.ok && result.result) setSettlementResult(result.result)
  }, [
    pendingSettlementFile,
    pendingSettlementMapping,
    settledSettlementFile,
    settledSettlementMapping,
  ])

  const handleAnalyze = useCallback(() => {
    setAnalysisMessage(null)
    setAnalysisStatus('analyzing')

    window.setTimeout(() => {
      const out = analyzeBusiness({
        orderFile,
        orderMapping,
        liveFile,
        liveMapping,
        pendingFile: pendingSettlementFile,
        pendingMapping: pendingSettlementMapping,
        settledFile: settledSettlementFile,
        settledMapping: settledSettlementMapping,
        anchorConfig,
      })

      if (!out.ok || !out.result) {
        setAnalysisStatus('error')
        setAnalysisMessage(out.message ?? '分析失败')
        setAnalysisResult(null)
        return
      }

      const hasWarnings =
        out.result.warnings.length > 0 ||
        out.result.overview.abnormalOrderCount > 0 ||
        out.result.overview.unassignedOrderCount > 0 ||
        out.result.errors.length > 0 ||
        !out.result.attributionValidation.orderCountOk ||
        !out.result.attributionValidation.gmvOk

      setAnalysisResult(out.result)
      setAnalysisStatus(hasWarnings ? 'done_with_warnings' : 'done')

      handlePreprocess()
      handleSettlementPreprocess()
    }, 50)
  }, [
    orderFile,
    orderMapping,
    pendingSettlementFile,
    pendingSettlementMapping,
    settledSettlementFile,
    settledSettlementMapping,
    liveFile,
    liveMapping,
    anchorConfig,
    handlePreprocess,
    handleSettlementPreprocess,
  ])

  const handleCopyReport = useCallback(async () => {
    if (!analysisResult) {
      setAnalysisMessage('请先完成分析')
      return
    }
    const text = buildReportText(analysisResult)
    try {
      await navigator.clipboard.writeText(text)
      setAnalysisMessage('汇报文本已复制')
    } catch {
      setAnalysisMessage('复制失败，请手动复制')
    }
  }, [analysisResult])

  const handleWindowDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (files?.length) await importFromFileList(files)
    },
    [importFromFileList],
  )

  useEffect(() => {
    const preventDefault = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', handleWindowDrop)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [handleWindowDrop])

  const gmvDonut = useMemo(() => {
    if (!analysisResult) return { data: [], colors: [] as string[] }
    return {
      data: analysisResult.anchorSummaries
        .filter((a) => a.gmvCent > 0)
        .map((a) => ({
          name: a.anchorName,
          value: a.gmvCent / 100,
          display: formatCentToMoney(a.gmvCent),
        })),
      colors: analysisResult.anchorSummaries.filter((a) => a.gmvCent > 0).map((a) => a.color),
    }
  }, [analysisResult])

  const signedDonut = useMemo(() => {
    if (!analysisResult) return { data: [], colors: [] as string[] }
    return {
      data: analysisResult.anchorSummaries
        .filter((a) => a.actualSignedAmountCent > 0)
        .map((a) => ({
          name: a.anchorName,
          value: a.actualSignedAmountCent / 100,
          display: formatCentToMoney(a.actualSignedAmountCent),
        })),
      colors: analysisResult.anchorSummaries
        .filter((a) => a.actualSignedAmountCent > 0)
        .map((a) => a.color),
    }
  }, [analysisResult])

  const monthLabel = useMemo(() => {
    const key = analysisResult?.month
    if (!key) return '—'
    const [y, m] = key.split('-')
    return y && m ? `${y}年${Number(m)}月` : key
  }, [analysisResult?.month])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-bg-warm)] px-4 py-2">
      {(toast || analysisMessage) && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-1.5 text-xs text-white shadow-lg">
          {toast ?? analysisMessage}
        </div>
      )}

      <header className="flex shrink-0 items-center justify-between gap-3 py-1">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">直播订单经营看板</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span>分析月份：{monthLabel}</span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                analysisStatus === 'done'
                  ? 'bg-emerald-50 text-emerald-700'
                  : analysisStatus === 'done_with_warnings'
                    ? 'bg-amber-50 text-amber-700'
                    : analysisStatus === 'analyzing'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-slate-100 text-slate-600'
              }`}
            >
              {STATUS_LABEL[analysisStatus]}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={!anchorConfigLoaded}
            className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-700 shadow-sm hover:border-rose-200"
          >
            <Settings2 size={12} className="text-[var(--color-xhs-red)]" />
            主播规则设置
          </button>
          <button
            type="button"
            onClick={() => void openFileDialog()}
            className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-700 shadow-sm hover:border-rose-100"
          >
            <FileUp size={12} className="text-[var(--color-xhs-red)]" />
            上传表格
          </button>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!orderFile || analysisStatus === 'analyzing'}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-xhs-red)] px-2.5 py-1 text-[10px] font-medium text-white shadow-sm disabled:opacity-50"
          >
            <Play size={12} />
            开始分析
          </button>
          <button
            type="button"
            disabled
            title="下一阶段开放"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-[10px] text-slate-500"
          >
            <FileDown size={12} />
            导出详细报表
          </button>
          <button
            type="button"
            onClick={() => void handleCopyReport()}
            className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-700 shadow-sm"
          >
            <Copy size={12} />
            复制汇报文本
          </button>
        </div>
      </header>

      <UploadSlotGrid slotFiles={slotFiles} orderMapping={orderMapping} />

      <main className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5">
        {analysisResult ? (
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_200px_200px] gap-1.5">
            <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
              <OverviewMetrics
                overview={analysisResult.overview}
                validation={analysisResult.attributionValidation}
              />
              <div className="flex min-h-0 gap-1.5 overflow-x-auto">
                {analysisResult.anchorSummaries.map((a, i) => (
                  <AnchorBusinessCard
                    key={a.anchorName}
                    data={a}
                    tone={i % 2 === 0 ? 'pink' : 'orange'}
                  />
                ))}
              </div>
              <QualityReturnPanel insight={analysisResult.qualityReturn} />
              <BuyerRankingCompact
                returnRanking={analysisResult.buyerReturnRanking}
                qualityRanking={analysisResult.buyerQualityReturnRanking}
                hasBuyerField={hasBuyerField}
                onSelectBuyer={setBuyerFilter}
              />
            </div>
            <DonutChart
              title="主播 GMV 占比"
              totalLabel="总 GMV"
              totalValue={formatCentToMoney(analysisResult.overview.gmvCent)}
              data={gmvDonut.data}
              colors={gmvDonut.colors.length ? gmvDonut.colors : ['#ff2442', '#ff8a3d']}
            />
            <DonutChart
              title="实际签收金额占比"
              totalLabel="总签收"
              totalValue={formatCentToMoney(analysisResult.overview.actualSignedAmountCent)}
              data={signedDonut.data}
              colors={signedDonut.colors.length ? signedDonut.colors : ['#ff2442', '#ff8a3d']}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 text-[11px] text-slate-400">
            {analysisStatus === 'error' && analysisMessage
              ? analysisMessage
              : '上传当月订单表（必填），可选上传直播场次与结算明细，点击「开始分析」查看经营结果'}
          </div>
        )}

        <BusinessTabPanel
          result={analysisResult}
          buyerFilter={buyerFilter}
          hasBuyerField={hasBuyerField}
          onSelectBuyer={setBuyerFilter}
          onClearBuyerFilter={() => setBuyerFilter(null)}
        />
      </main>

      <AdvancedDiagnosticsPanel
        orderMapping={orderMapping}
        liveMapping={liveMapping}
        pendingSettlementMapping={pendingSettlementMapping}
        settledSettlementMapping={settledSettlementMapping}
        orderFile={orderFile}
        liveFile={liveFile}
        pendingSettlementFile={pendingSettlementFile}
        settledSettlementFile={settledSettlementFile}
        unknownFiles={slotFiles.unknown}
        onFieldChange={updateFieldMapping}
        onFileTypeChange={updateFileType}
        canPreprocess={canPreprocess}
        preprocessDisabledReason={preprocessDisabledReason}
        preprocessResult={preprocessResult}
        onPreprocess={handlePreprocess}
        settlementCanPreprocess={settlementCheck.ok}
        settlementDisabledReason={settlementCheck.reason}
        settlementResult={settlementResult}
        onSettlementPreprocess={handleSettlementPreprocess}
        analyzedOrders={analysisResult?.analyzedOrders ?? []}
        abnormalOrders={analysisResult?.abnormalOrders ?? []}
      />

      <AnchorSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={anchorConfig}
        saveError={anchorSaveError}
        onAddAnchor={addAnchor}
        onUpdateAnchor={updateAnchor}
        onRemoveAnchor={removeAnchor}
        onAddTimeRule={addTimeRule}
        onUpdateTimeRule={updateTimeRule}
        onRemoveTimeRule={removeTimeRule}
        onReset={resetConfig}
      />
    </div>
  )
}

export default App
