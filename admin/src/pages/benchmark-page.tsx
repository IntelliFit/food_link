import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronLeft,
  FlaskConical,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Plus,
  CheckSquare,
  Square,
  BarChart3,
  Layers,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminSidebar } from '@/components/admin-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { adminRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { AdminMenuId } from '@/components/admin-sidebar'
import type {
  BenchmarkRun,
  BenchmarkRunSample,
  CreateRunInput,
  DatasetFilter,
  DatasetSample,
  DatasetSampleListResponse,
  BenchmarkRunListResponse,
  BenchmarkRunSampleListResponse,
  ExecutionMode,
  ItemComparison,
  LabelType,
  SampleStatus,
} from '@/types/benchmark'
import {
  executionModeLabels,
  executionModeOptions,
  labelTypeLabels,
  runSampleStatusLabels,
  runStatusLabels,
  sampleStatusLabels,
} from '@/types/benchmark'

type BenchmarkPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type ViewMode = 'datasets' | 'runs' | 'run-detail'

export function BenchmarkPage({ onLogout, onMenuChange }: BenchmarkPageProps) {
  const [view, setView] = useState<ViewMode>('datasets')
  const [selectedRunId, setSelectedRunId] = useState<string>('')

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1540px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="benchmark" onLogout={onLogout} onMenuChange={onMenuChange} />

      <main className="min-w-0 space-y-4 pb-8">
        {view === 'datasets' && <DatasetSection onViewRun={() => setView('runs')} />}
        {view === 'runs' && (
          <RunsSection
            onBack={() => setView('datasets')}
            onViewRun={(id) => {
              setSelectedRunId(id)
              setView('run-detail')
            }}
          />
        )}
        {view === 'run-detail' && (
          <RunDetailSection
            runId={selectedRunId}
            onBack={() => setView('runs')}
          />
        )}
      </main>
    </div>
  )
}

// ---------- Dataset Section ----------

function DatasetSection({ onViewRun }: { onViewRun: () => void }) {
  const [samples, setSamples] = useState<DatasetSample[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const limit = 20
  const [query, setQuery] = useState('')
  const [batchName, setBatchName] = useState('all')
  const [labelType, setLabelType] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [batches, setBatches] = useState<string[]>([])
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [editingSample, setEditingSample] = useState<DatasetSample | null>(null)
  const [sampleToDelete, setSampleToDelete] = useState<string | null>(null)
  const [deletingSample, setDeletingSample] = useState(false)

  useEffect(() => {
    void loadBatches()
  }, [])

  useEffect(() => {
    void loadSamples()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, batchName, labelType, status])

  async function loadBatches() {
    try {
      const data = await adminRequest<{ items: string[] }>('/api/admin/benchmark/datasets/batches')
      setBatches(data.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载批次失败')
    }
  }

  async function loadSamples(nextPage = page) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
        batch_name: batchName === 'all' ? '' : batchName,
        label_type: labelType === 'all' ? '' : labelType,
        status: status === 'all' ? '' : status,
      })
      const data = await adminRequest<DatasetSampleListResponse>(`/api/admin/benchmark/datasets/samples?${params.toString()}`)
      setSamples(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || nextPage)
      setSelectedSampleIds(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载样本失败')
      setSamples([])
    } finally {
      setLoading(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedSampleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedSampleIds.size === samples.length) {
      setSelectedSampleIds(new Set())
    } else {
      setSelectedSampleIds(new Set(samples.map((s) => s.id)))
    }
  }

  async function handleDelete(id: string) {
    setDeletingSample(true)
    try {
      await adminRequest(`/api/admin/benchmark/datasets/samples/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success('已删除')
      setSampleToDelete(null)
      void loadSamples()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingSample(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <Card className="border bg-card/90 shadow-lg backdrop-blur-md">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">Benchmark / 数据集管理</p>
            <CardTitle className="text-3xl tracking-tight">数据集评测</CardTitle>
            <CardDescription className="max-w-2xl text-base leading-relaxed">
              管理食物图片标注数据集，选择样本发起算法评测，对比模型输出与人工标注，分析各阶段效果。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onViewRun}>
              <BarChart3 className="mr-2 size-4" />
              评测记录
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 size-4" />
              新增样本
            </Button>
          </div>
        </CardHeader>
      </Card>

      <RunLauncher
        selectedSampleIds={Array.from(selectedSampleIds)}
        batches={batches}
        onLaunched={() => onViewRun()}
      />

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-[minmax(200px,2fr)_160px_150px_150px_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="search">搜索</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                placeholder="样本名 / 文件名 / 批次"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadSamples(1)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>批次</Label>
            <Select value={batchName} onValueChange={(v) => { setBatchName(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="全部批次" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部批次</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>标签类型</Label>
            <Select value={labelType} onValueChange={(v) => { setLabelType(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="total">总重</SelectItem>
                <SelectItem value="items">分项</SelectItem>
                <SelectItem value="unlabeled">未标注</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>状态</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="labeled">已标注</SelectItem>
                <SelectItem value="unlabeled">未标注</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => loadSamples(1)} disabled={loading}>
            {loading ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
            查询
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={toggleSelectAll}>
              {selectedSampleIds.size === samples.length && samples.length > 0 ? (
                <CheckSquare className="size-4" />
              ) : (
                <Square className="size-4" />
              )}
              全选
            </Button>
            <span>已选 {selectedSampleIds.size} / 共 {total} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 text-left"></th>
                  <th className="px-3 py-2 text-left">批次</th>
                  <th className="px-3 py-2 text-left">样本名</th>
                  <th className="px-3 py-2 text-left">类型</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">标注</th>
                  <th className="px-3 py-2 text-left">图片</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && samples.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ) : samples.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  samples.map((sample) => (
                    <tr key={sample.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggleSelect(sample.id)}>
                          {selectedSampleIds.has(sample.id) ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                        </Button>
                      </td>
                      <td className="px-3 py-2">{sample.batch_name}</td>
                      <td className="px-3 py-2 font-medium">{sample.sample_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{labelTypeLabels[sample.label_type as LabelType]}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={sample.status === 'labeled' ? 'default' : 'secondary'}>
                          {sampleStatusLabels[sample.status as SampleStatus]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 max-w-[240px] truncate" title={labelSummary(sample)}>
                        {labelSummary(sample)}
                      </td>
                      <td className="px-3 py-2">
                        {sample.image_url ? (
                          <a href={sample.image_url} target="_blank" rel="noreferrer" className="inline-block">
                            <img
                              src={sample.image_url}
                              alt={sample.sample_name}
                              className="h-10 w-10 rounded object-cover ring-1 ring-border"
                            />
                          </a>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => setEditingSample(sample)}>
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => setSampleToDelete(sample.id)}>
                          <Trash2 className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              第 {page} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {showCreate && (
        <SampleFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void loadSamples() }}
        />
      )}
      {editingSample && (
        <SampleFormModal
          sample={editingSample}
          onClose={() => setEditingSample(null)}
          onSaved={() => { setEditingSample(null); void loadSamples() }}
        />
      )}
      <ConfirmDialog
        open={sampleToDelete !== null}
        onOpenChange={(open) => setSampleToDelete(open ? sampleToDelete : null)}
        title="删除数据集样本？"
        description="该样本会从评测数据集中移除，已经生成的历史评测结果不会被自动重算。"
        confirmLabel="删除样本"
        variant="destructive"
        confirming={deletingSample}
        onConfirm={() => sampleToDelete ? handleDelete(sampleToDelete) : undefined}
      />
    </div>
  )
}

function labelSummary(sample: DatasetSample): string {
  if (sample.label_type === 'total' && sample.total_weight_grams !== undefined) {
    return `${sample.total_weight_grams}g`
  }
  if (sample.label_type === 'items' && sample.items && Object.keys(sample.items).length > 0) {
    return Object.entries(sample.items).map(([name, w]) => `${name}=${w}g`).join('; ')
  }
  return '-'
}

// ---------- Sample Form Modal ----------

function SampleFormModal({
  sample,
  onClose,
  onSaved,
}: {
  sample?: DatasetSample | null
  onClose: () => void
  onSaved: () => void
}) {
  const [batchName, setBatchName] = useState(sample?.batch_name || '')
  const [sampleName, setSampleName] = useState(sample?.sample_name || '')
  const [originalFilename, setOriginalFilename] = useState(sample?.original_filename || '')
  const [imageUrl, setImageUrl] = useState(sample?.image_url || '')
  const [labelType, setLabelType] = useState<LabelType>((sample?.label_type as LabelType) || 'total')
  const [totalWeight, setTotalWeight] = useState(sample?.total_weight_grams?.toString() || '')
  const [itemsText, setItemsText] = useState(
    sample?.items
      ? Object.entries(sample.items)
          .filter(([name]) => name !== '__total__')
          .map(([name, w]) => `${name}=${w}`)
          .join('\n')
      : ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      let items: Record<string, number> | undefined
      let total: number | undefined
      if (labelType === 'items') {
        items = parseItemsText(itemsText)
      } else if (labelType === 'total') {
        total = parseFloat(totalWeight)
        if (!isNaN(total)) {
          items = { __total__: total }
        }
      }
      const body: any = {
        batch_name: batchName,
        sample_name: sampleName,
        original_filename: originalFilename || sampleName,
        image_url: imageUrl,
        label_type: labelType,
        status: labelType === 'unlabeled' ? 'unlabeled' : 'labeled',
      }
      if (items) body.items = items
      if (total !== undefined && !isNaN(total)) body.total_weight_grams = total

      if (sample) {
        await adminRequest(`/api/admin/benchmark/datasets/samples/${encodeURIComponent(sample.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        toast.success('已更新')
      } else {
        await adminRequest('/api/admin/benchmark/datasets/samples', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        toast.success('已创建')
      }
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{sample ? '编辑样本' : '新增样本'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>批次</Label>
              <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>样本名</Label>
              <Input value={sampleName} onChange={(e) => setSampleName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>原始文件名</Label>
            <Input value={originalFilename} onChange={(e) => setOriginalFilename(e.target.value)} placeholder="默认使用样本名" />
          </div>
          <div className="space-y-2">
            <Label>图片 URL</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>标签类型</Label>
            <Select value={labelType} onValueChange={(v) => setLabelType(v as LabelType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">总重</SelectItem>
                <SelectItem value="items">分项</SelectItem>
                <SelectItem value="unlabeled">未标注</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {labelType === 'total' && (
            <div className="space-y-2">
              <Label>总重量 (g)</Label>
              <Input value={totalWeight} onChange={(e) => setTotalWeight(e.target.value)} />
            </div>
          )}
          {labelType === 'items' && (
            <div className="space-y-2">
              <Label>分项（每行 食物名=重量）</Label>
              <Textarea rows={5} value={itemsText} onChange={(e) => setItemsText(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中' : '保存'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function parseItemsText(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('=')
    if (parts.length < 2) continue
    const w = parseFloat(parts[parts.length - 1])
    if (isNaN(w)) continue
    out[parts.slice(0, -1).join('=').trim()] = w
  }
  return out
}

// ---------- Run Launcher ----------

function RunLauncher({
  selectedSampleIds,
  batches,
  onLaunched,
}: {
  selectedSampleIds: string[]
  batches: string[]
  onLaunched: () => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<ExecutionMode>('standard')
  const [textInput, setTextInput] = useState('')
  const [scope, setScope] = useState<'selected' | 'batch' | 'all'>('selected')
  const [batchName, setBatchName] = useState('all')
  const [labelType, setLabelType] = useState<string>('all')
  const [status, setStatus] = useState<string>('labeled')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const filter: DatasetFilter = {}
    if (scope === 'selected') {
      if (selectedSampleIds.length === 0) {
        toast.error('请先选择样本')
        return
      }
      filter.sample_ids = selectedSampleIds
    } else if (scope === 'batch') {
      if (batchName !== 'all') filter.batch_names = [batchName]
      if (labelType !== 'all') filter.label_types = [labelType as LabelType]
      if (status !== 'all') filter.statuses = [status as SampleStatus]
    } else {
      if (labelType !== 'all') filter.label_types = [labelType as LabelType]
      if (status !== 'all') filter.statuses = [status as SampleStatus]
    }

    const body: CreateRunInput = {
      name: name.trim(),
      execution_mode: mode,
      dataset_filter: filter,
      text_input: textInput.trim(),
    }

    setSubmitting(true)
    try {
      await adminRequest('/api/admin/benchmark/runs', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      toast.success('评测已启动')
      onLaunched()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5" />
          发起评测
        </CardTitle>
        <CardDescription>选择样本与执行模式，调用后端识别算法生成 Benchmark 结果。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>运行名称</Label>
            <Input placeholder="留空自动生成" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>执行模式</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ExecutionMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {executionModeOptions.map((m) => (
                  <SelectItem key={m} value={m}>{executionModeLabels[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>可选文本输入</Label>
            <Input placeholder="例如：中餐" value={textInput} onChange={(e) => setTextInput(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>样本范围</Label>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={scope === 'selected' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScope('selected')}
            >
              已选样本 ({selectedSampleIds.length})
            </Button>
            <Button
              variant={scope === 'batch' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScope('batch')}
            >
              按批次筛选
            </Button>
            <Button
              variant={scope === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScope('all')}
            >
              全部
            </Button>
          </div>
        </div>

        {scope === 'batch' && (
          <div className="grid gap-4 md:grid-cols-3">
            <Select value={batchName} onValueChange={setBatchName}>
              <SelectTrigger>
                <SelectValue placeholder="全部批次" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部批次</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={labelType} onValueChange={setLabelType}>
              <SelectTrigger>
                <SelectValue placeholder="标签类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="total">总重</SelectItem>
                <SelectItem value="items">分项</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="labeled">已标注</SelectItem>
                <SelectItem value="unlabeled">未标注</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === 'all' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Select value={labelType} onValueChange={setLabelType}>
              <SelectTrigger>
                <SelectValue placeholder="标签类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="total">总重</SelectItem>
                <SelectItem value="items">分项</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="labeled">已标注</SelectItem>
                <SelectItem value="unlabeled">未标注</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            开始评测
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Runs Section ----------

function RunsSection({ onBack, onViewRun }: { onBack: () => void; onViewRun: (id: string) => void }) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [runToDelete, setRunToDelete] = useState<string | null>(null)
  const [deletingRun, setDeletingRun] = useState(false)

  useEffect(() => {
    void loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRuns()
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  async function loadRuns() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      const data = await adminRequest<BenchmarkRunListResponse>(`/api/admin/benchmark/runs?${params.toString()}`)
      setRuns(data.items || [])
      setTotal(data.total || 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingRun(true)
    try {
      await adminRequest(`/api/admin/benchmark/runs/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success('已删除')
      setRunToDelete(null)
      void loadRuns()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingRun(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <Card className="border bg-card/90 shadow-lg backdrop-blur-md">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">评测记录</CardTitle>
            <CardDescription>查看历史 Benchmark 运行结果与聚合指标。</CardDescription>
          </div>
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="mr-2 size-4" />
            返回数据集
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">模式</th>
                  <th className="px-3 py-2 text-left">创建者</th>
                  <th className="px-3 py-2 text-left">样本数</th>
                  <th className="px-3 py-2 text-left">名称匹配率</th>
                  <th className="px-3 py-2 text-left">总重 MAPE</th>
                  <th className="px-3 py-2 text-left">完成时间</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && runs.length === 0 ? (
                  <tr><td colSpan={8} className="p-6"><Skeleton className="h-8 w-full" /></td></tr>
                ) : runs.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">暂无评测记录</td></tr>
                ) : (
                  runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{run.name}</td>
                      <td className="px-3 py-2">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-2">{executionModeLabels[run.execution_mode as ExecutionMode]}</td>
                      <td className="px-3 py-2">{run.created_by_username || '-'}</td>
                      <td className="px-3 py-2">{run.sample_count}</td>
                      <td className="px-3 py-2">{formatPct(run.metrics?.name_match_rate)}</td>
                      <td className="px-3 py-2">{formatPct(run.metrics?.total_weight_mape)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatTime(run.completed_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => onViewRun(run.id)}>详情</Button>
                        <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => setRunToDelete(run.id)}>
                          <Trash2 className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={runToDelete !== null}
        onOpenChange={(open) => setRunToDelete(open ? runToDelete : null)}
        title="删除评测运行记录？"
        description="该运行记录和关联结果将被删除，删除后不可恢复。"
        confirmLabel="删除记录"
        variant="destructive"
        confirming={deletingRun}
        onConfirm={() => runToDelete ? handleDelete(runToDelete) : undefined}
      />
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    cancelled: 'bg-muted text-muted-foreground dark:bg-muted/50',
  }
  return (
    <Badge variant="outline" className={cn(variants[status] || '', 'border-transparent')}>
      {runStatusLabels[status as keyof typeof runStatusLabels] || status}
    </Badge>
  )
}

// ---------- Run Detail Section ----------

function RunDetailSection({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [samples, setSamples] = useState<BenchmarkRunSample[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [total, setTotal] = useState(0)
  const [selectedSample, setSelectedSample] = useState<BenchmarkRunSample | null>(null)

  useEffect(() => {
    void loadRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  useEffect(() => {
    void loadSamples()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, page])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRun()
      void loadSamples()
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, page])

  async function loadRun() {
    try {
      const data = await adminRequest<{ run: BenchmarkRun }>(`/api/admin/benchmark/runs/${encodeURIComponent(runId)}`)
      setRun(data.run)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载运行详情失败')
    }
  }

  async function loadSamples() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      const data = await adminRequest<BenchmarkRunSampleListResponse>(`/api/admin/benchmark/runs/${encodeURIComponent(runId)}/samples?${params.toString()}`)
      setSamples(data.items || [])
      setTotal(data.total || 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载样本结果失败')
    } finally {
      setLoading(false)
    }
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="mr-2 size-4" />返回</Button>
        <Card><CardContent className="p-8"><Skeleton className="h-8 w-full" /></CardContent></Card>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="mr-2 size-4" />返回</Button>
        <Button variant="outline" onClick={() => { void loadRun(); void loadSamples() }}>
          <RefreshCw className="mr-2 size-4" />刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{run.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <span>{executionModeLabels[run.execution_mode as ExecutionMode]}</span>
            <span className="text-muted-foreground">{run.sample_count} 个样本</span>
            {run.created_by_username && (
              <span className="text-muted-foreground">由 {run.created_by_username} 创建</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="名称匹配率" value={formatPct(run.metrics?.name_match_rate)} />
            <MetricCard label="总重 MAPE" value={formatPct(run.metrics?.total_weight_mape)} />
            <MetricCard label="总重 RMSE" value={formatNumber(run.metrics?.total_weight_rmse) + 'g'} />
            <MetricCard label="平均耗时" value={formatNumber(run.metrics?.average_duration_ms) + 'ms'} />
            <MetricCard label="完成" value={String(run.metrics?.completed_count || 0)} />
            <MetricCard label="失败" value={String(run.metrics?.failed_count || 0)} />
            <MetricCard label="分项 MAPE" value={formatPct(run.metrics?.item_weight_mape)} />
            <MetricCard label="分项 RMSE" value={formatNumber(run.metrics?.item_weight_rmse) + 'g'} />
          </div>
          {run.error_message && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {run.error_message}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Layers className="size-5" />逐样本结果</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">状态</th>
                  <th className="px-3 py-2 text-left">样本 ID</th>
                  <th className="px-3 py-2 text-left">名称匹配</th>
                  <th className="px-3 py-2 text-left">总重误差</th>
                  <th className="px-3 py-2 text-left">分项对比</th>
                  <th className="px-3 py-2 text-left">耗时</th>
                  <th className="px-3 py-2 text-left">错误信息</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && samples.length === 0 ? (
                  <tr><td colSpan={8} className="p-6"><Skeleton className="h-8 w-full" /></td></tr>
                ) : samples.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">暂无样本结果</td></tr>
                ) : (
                  samples.map((s) => (
                    <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2"><RunSampleStatusBadge status={s.status} /></td>
                      <td className="px-3 py-2 font-mono text-xs">{s.sample_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{s.metrics?.name_matched ? '✅' : '❌'}</td>
                      <td className="px-3 py-2">{formatPct(s.metrics?.total_weight_error_pct)}</td>
                      <td className="px-3 py-2">{comparisonSummary(s.metrics?.item_comparisons)}</td>
                      <td className="px-3 py-2">{formatNumber(s.metrics?.duration_ms)}ms</td>
                      <td className="px-3 py-2 max-w-[280px] truncate text-destructive" title={s.error_message || ''}>{s.error_message || '-'}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => setSelectedSample(s)}>详情</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedSample && (
        <RunSampleDetailModal sample={selectedSample} onClose={() => setSelectedSample(null)} />
      )}
    </div>
  )
}

function RunSampleStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    processing: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    cancelled: 'bg-muted text-muted-foreground dark:bg-muted/50',
  }
  return (
    <Badge variant="outline" className={cn(variants[status] || '', 'border-transparent')}>
      {runSampleStatusLabels[status as keyof typeof runSampleStatusLabels] || status}
    </Badge>
  )
}

function RunSampleDetailModal({ sample, onClose }: { sample: BenchmarkRunSample; onClose: () => void }) {
  const stages = [
    { key: 'vision', label: 'Vision 识别' },
    { key: 'review', label: 'Review / Web Search' },
    { key: 'edible', label: 'Edible Portion' },
    { key: 'nutrition', label: 'Nutrition 查询' },
    { key: 'suggest_ratio', label: 'Suggest Ratio' },
    { key: 'final', label: 'Final 输出' },
  ]

  const comparisons: ItemComparison[] = sample.metrics?.item_comparisons || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-5" />
              样本评测详情
            </CardTitle>
            <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
          <CardDescription>sample_id: {sample.sample_id} / task_id: {sample.task_id || '-'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 font-semibold">Ground Truth</h4>
              <pre className="max-h-[200px] overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(sample.ground_truth, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="mb-2 font-semibold">Prediction</h4>
              <pre className="max-h-[200px] overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(sample.prediction, null, 2)}
              </pre>
            </div>
          </div>

          {comparisons.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold">分项对比</h4>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">标注</th>
                      <th className="px-3 py-2 text-left">预测</th>
                      <th className="px-3 py-2 text-right">标注重</th>
                      <th className="px-3 py-2 text-right">预测重</th>
                      <th className="px-3 py-2 text-right">误差</th>
                      <th className="px-3 py-2 text-right">误差%</th>
                      <th className="px-3 py-2 text-center">匹配</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((c, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{c.gt_name || '-'}</td>
                        <td className="px-3 py-2">{c.pred_name || '-'}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(c.gt_weight)}g</td>
                        <td className="px-3 py-2 text-right">{formatNumber(c.pred_weight)}g</td>
                        <td className="px-3 py-2 text-right">{formatNumber(c.weight_error)}g</td>
                        <td className="px-3 py-2 text-right">{formatPct(c.weight_error_pct)}</td>
                        <td className="px-3 py-2 text-center">
                          {c.matched ? '✅' : c.extra ? '⚠️' : '❌'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sample.error_message && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-semibold text-destructive">
                <AlertCircle className="size-4" />
                错误信息
              </h4>
              <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-destructive">
                {sample.error_message}
              </pre>
            </div>
          )}

          <div>
            <h4 className="mb-2 font-semibold">阶段输出</h4>
            <div className="space-y-2">
              {stages.map((stage) => {
                const output = sample.stage_outputs?.[stage.key]
                return (
                  <div key={stage.key} className="rounded-md border">
                    <div className="flex items-center justify-between bg-muted/50 px-3 py-2 text-sm font-medium">
                      <span>{stage.label}</span>
                      <Badge variant="outline" className="text-xs">
                        {output ? (typeof output === 'object' && 'status' in output ? String(output.status) : '有输出') : '无输出'}
                      </Badge>
                    </div>
                    <pre className="max-h-[160px] overflow-auto p-3 text-xs">
                      {JSON.stringify(output, null, 2)}
                    </pre>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>关闭</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function formatPct(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) return '-'
  return `${value.toFixed(2)}%`
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) return '-'
  return value.toFixed(2)
}

function formatTime(value: string | undefined): string {
  if (!value) return '-'
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString('zh-CN')
}

function comparisonSummary(comparisons: ItemComparison[] | undefined): string {
  if (!comparisons || comparisons.length === 0) return '-'
  const matched = comparisons.filter((c) => c.matched).length
  const extra = comparisons.filter((c) => c.extra).length
  const total = comparisons.length
  if (total === 1 && comparisons[0].gt_name === '__total__') {
    return '总重对比'
  }
  return `匹配 ${matched}/${total}${extra > 0 ? `, 多检 ${extra}` : ''}`
}
