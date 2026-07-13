import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AdminSidebar, type AdminMenuId } from '@/components/admin-sidebar'
import { adminRequest, adminUpload, displayApiBase } from '@/lib/api'

type CampusFoodCollectionPageProps = {
  onLogout: () => void
  onMenuChange: (menu: AdminMenuId) => void
}

type DirectoryOption = {
  id: string
  name: string
  floor?: string
}

type ListResponse<T> = {
  items: T[]
  page: number
  limit: number
  total: number
}

type CollectionBatch = {
  id: string
  batch_name: string
  venue_type: string
  organization_name: string
  area_name?: string
  canteen_name: string
  default_floor?: string
  default_window_name?: string
  default_meal_periods?: string[]
  captured_at?: string
  collector_name?: string
  status: string
  item_count: number
  created_at?: string
}

type CatalogItem = {
  id: string
  entry_type: string
  name?: string
  floor?: string
  window_name?: string
  service_mode: string
  meal_periods?: string[]
  price_type: string
  price?: number
  price_min?: number
  price_max?: number
  price_unit?: string
  price_text?: string
  image_paths?: string[]
  image_kind: string
  source_filename?: string
  missing_fields?: string[]
  completeness_status: string
}

type DraftEntry = {
  localId: string
  files: File[]
  previewUrls: string[]
  uploadedUrls: string[]
  entryType: string
  name: string
  imageKind: string
  floor: string
  windowName: string
  windowLayout: string
  serviceMode: string
  mealPeriods: string[]
  priceType: string
  price: string
  priceMin: string
  priceMax: string
  priceUnit: string
  priceText: string
  portionDescription: string
  rawText: string
  notes: string
  uploadError: string
}

const mealOptions: Array<[string, string]> = [
  ['breakfast', '早餐'],
  ['lunch', '午餐'],
  ['afternoon', '下午'],
  ['dinner', '晚餐'],
  ['late_night', '夜宵'],
  ['all_day', '全天'],
  ['unknown', '待确认'],
]

const serviceOptions: Array<[string, string]> = [
  ['fixed_portion', '整份售卖'],
  ['self_select', '自选打菜'],
  ['combo', '任选/套餐'],
  ['by_weight', '称重计价'],
  ['malatang', '麻辣烫/自选食材'],
  ['buffet', '自助'],
  ['made_to_order', '现点现做'],
  ['retail', '零售档口'],
  ['mixed', '混合售卖'],
  ['unknown', '待确认'],
]

const entryTypeOptions: Array<[string, string]> = [
  ['dish', '菜品实物'],
  ['menu_item', '菜单/价签条目'],
  ['stall_overview', '窗口整体'],
  ['combo', '套餐/任选规则'],
  ['ingredient', '麻辣烫/自选食材'],
]

const imageKindOptions: Array<[string, string]> = [
  ['dish', '菜品照片'],
  ['menu_board', '菜单牌'],
  ['stall_front', '窗口全景'],
  ['price_tag', '价签'],
  ['ingredient_display', '食材陈列'],
  ['receipt', '小票'],
  ['other', '其他证据'],
]

const priceTypeOptions: Array<[string, string]> = [
  ['fixed', '固定价'],
  ['range', '价格区间'],
  ['by_weight', '称重'],
  ['combo', '套餐/任选'],
  ['market', '时价'],
  ['freeform', '复杂规则'],
  ['unknown', '待补充'],
]

const windowLayoutOptions: Array<[string, string]> = [
  ['small', '小窗口'],
  ['standard', '标准窗口'],
  ['large', '大窗口'],
  ['continuous_counter', '连续长档口'],
  ['unknown', '待确认'],
]

export function CampusFoodCollectionPage({ onLogout, onMenuChange }: CampusFoodCollectionPageProps) {
  const [venueType, setVenueType] = useState('university')
  const [schoolQuery, setSchoolQuery] = useState('清华大学')
  const [schoolOptions, setSchoolOptions] = useState<DirectoryOption[]>([])
  const [campusOptions, setCampusOptions] = useState<DirectoryOption[]>([])
  const [canteenOptions, setCanteenOptions] = useState<DirectoryOption[]>([])
  const [windowOptions, setWindowOptions] = useState<DirectoryOption[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [campusId, setCampusId] = useState('')
  const [canteenId, setCanteenId] = useState('')
  const [windowId, setWindowId] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [areaName, setAreaName] = useState('')
  const [canteenName, setCanteenName] = useState('')
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [windowLayout, setWindowLayout] = useState('unknown')
  const [serviceMode, setServiceMode] = useState('unknown')
  const [mealPeriods, setMealPeriods] = useState<string[]>(['unknown'])
  const [capturedAt, setCapturedAt] = useState(todayInputValue())
  const [collectorName, setCollectorName] = useState('')
  const [sourceNote, setSourceNote] = useState('')
  const [batchName, setBatchName] = useState('')
  const [clientBatchKey, setClientBatchKey] = useState(newClientBatchKey)
  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadDone, setUploadDone] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const [batches, setBatches] = useState<CollectionBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [selectedBatchItems, setSelectedBatchItems] = useState<CatalogItem[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)

  const isUniversity = venueType === 'university'
  const apiBase = displayApiBase()
  const fileCount = useMemo(() => entries.reduce((sum, entry) => sum + entry.files.length, 0), [entries])

  useEffect(() => {
    void searchSchools('清华大学', true)
    void loadBatches()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!schoolId || !isUniversity) {
      setCampusOptions([])
      return
    }
    void loadDirectoryOptions(`/api/admin/campus-directory/campuses?school_id=${encodeURIComponent(schoolId)}&status=active&limit=100`, setCampusOptions)
  }, [schoolId, isUniversity])

  useEffect(() => {
    if (!schoolId || !isUniversity) {
      setCanteenOptions([])
      return
    }
    const params = new URLSearchParams({ school_id: schoolId, status: 'active', limit: '100' })
    if (campusId) params.set('campus_id', campusId)
    void loadDirectoryOptions(`/api/admin/campus-directory/canteens?${params.toString()}`, setCanteenOptions)
  }, [schoolId, campusId, isUniversity])

  useEffect(() => {
    if (!canteenId || !isUniversity) {
      setWindowOptions([])
      return
    }
    void loadDirectoryOptions(`/api/admin/campus-directory/windows?canteen_id=${encodeURIComponent(canteenId)}&status=active&limit=100`, setWindowOptions)
  }, [canteenId, isUniversity])

  async function loadDirectoryOptions(path: string, setter: (items: DirectoryOption[]) => void) {
    try {
      const data = await adminRequest<ListResponse<DirectoryOption>>(path)
      setter(data.items || [])
    } catch (error) {
      setter([])
      toast.error(error instanceof Error ? error.message : '目录读取失败')
    }
  }

  async function searchSchools(query = schoolQuery, autoSelect = false) {
    setDirectoryBusy(true)
    try {
      const data = await adminRequest<ListResponse<DirectoryOption>>(`/api/admin/campus-directory/schools?q=${encodeURIComponent(query.trim())}&status=active&limit=30`)
      const options = data.items || []
      setSchoolOptions(options)
      const exact = options.find((item) => item.name === query.trim())
      if ((autoSelect || options.length === 1) && exact) {
        setSchoolId(exact.id)
        setOrganizationName(exact.name)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学校搜索失败')
    } finally {
      setDirectoryBusy(false)
    }
  }

  async function loadBatches() {
    setHistoryBusy(true)
    try {
      const data = await adminRequest<ListResponse<CollectionBatch>>('/api/admin/campus-food-collection/batches?page=1&limit=20')
      setBatches(data.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采集批次读取失败')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function loadBatchItems(batchId: string) {
    setSelectedBatchId(batchId)
    setHistoryBusy(true)
    try {
      const data = await adminRequest<{ items: CatalogItem[] }>(`/api/admin/campus-food-collection/items?batch_id=${encodeURIComponent(batchId)}`)
      setSelectedBatchItems(data.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批次明细读取失败')
    } finally {
      setHistoryBusy(false)
    }
  }

  function switchVenueType(nextType: string) {
    setVenueType(nextType)
    if (nextType !== 'university') {
      setSchoolId('')
      setCampusId('')
      setCanteenId('')
      setWindowId('')
      setOrganizationName('')
      setAreaName('')
      setCanteenName('')
      setWindowName('')
    }
  }

  function chooseSchool(id: string) {
    setSchoolId(id)
    const selected = schoolOptions.find((item) => item.id === id)
    setOrganizationName(selected?.name || '')
    setCampusId('')
    setAreaName('')
    setCanteenId('')
    setCanteenName('')
    setWindowId('')
    setWindowName('')
  }

  function chooseCampus(id: string) {
    setCampusId(id)
    const selected = campusOptions.find((item) => item.id === id)
    setAreaName(selected?.name || '')
    setCanteenId('')
    setCanteenName('')
    setWindowId('')
    setWindowName('')
  }

  function chooseCanteen(id: string) {
    setCanteenId(id)
    const selected = canteenOptions.find((item) => item.id === id)
    setCanteenName(selected?.name || '')
    setWindowId('')
    setWindowName('')
  }

  function chooseWindow(id: string) {
    setWindowId(id)
    const selected = windowOptions.find((item) => item.id === id)
    setWindowName(selected?.name || '')
    if (selected?.floor) setFloor(selected.floor)
  }

  function addSelectedFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setEntries((current) => [
      ...current,
      ...files.map((file) => createDraftEntry([file])),
    ])
    event.target.value = ''
  }

  function addNoPhotoEntry() {
    setEntries((current) => [...current, createDraftEntry([])])
  }

  function appendEntryFiles(localId: string, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setEntries((current) => current.map((entry) => {
      if (entry.localId !== localId) return entry
      const room = Math.max(0, 6 - entry.files.length)
      const accepted = files.slice(0, room)
      return {
        ...entry,
        files: [...entry.files, ...accepted],
        previewUrls: [...entry.previewUrls, ...accepted.map((file) => URL.createObjectURL(file))],
        uploadedUrls: [...entry.uploadedUrls, ...accepted.map(() => '')],
      }
    }))
    event.target.value = ''
  }

  function updateEntry(localId: string, patch: Partial<DraftEntry>) {
    setEntries((current) => current.map((entry) => (entry.localId === localId ? { ...entry, ...patch } : entry)))
  }

  function removeEntry(localId: string) {
    setEntries((current) => {
      const target = current.find((entry) => entry.localId === localId)
      target?.previewUrls.forEach((url) => URL.revokeObjectURL(url))
      return current.filter((entry) => entry.localId !== localId)
    })
  }

  function toggleDefaultMeal(value: string) {
    setMealPeriods((current) => toggleValue(current, value))
  }

  function toggleEntryMeal(localId: string, value: string) {
    setEntries((current) => current.map((entry) => entry.localId === localId
      ? { ...entry, mealPeriods: toggleValue(entry.mealPeriods, value) }
      : entry))
  }

  async function submitBatch() {
    if (!organizationName.trim() || !canteenName.trim()) {
      toast.error('请先填写学校/园区和食堂名称')
      return
    }
    if (!entries.length) {
      toast.error('请至少添加一张图片或一条无图记录')
      return
    }
    setSubmitting(true)
    setUploadDone(0)
    const jobs = entries.flatMap((entry) => entry.files.map((file, index) => ({ entryId: entry.localId, file, index })))
    setUploadTotal(jobs.length)
    const uploadedByEntry = new Map(entries.map((entry) => [entry.localId, [...entry.uploadedUrls]]))
    const uploadErrors = new Set<string>()
    try {
      await runWithConcurrency(jobs, 3, async (job) => {
        const currentUrls = uploadedByEntry.get(job.entryId) || []
        if (currentUrls[job.index]) {
          setUploadDone((value) => value + 1)
          return
        }
        const formData = new FormData()
        formData.append('file', job.file)
        try {
          const data = await adminUpload<{ image_url: string }>('/api/admin/campus-food-collection/images', formData)
          currentUrls[job.index] = data.image_url
          uploadedByEntry.set(job.entryId, currentUrls)
          setEntries((current) => current.map((entry) => entry.localId === job.entryId
            ? { ...entry, uploadedUrls: [...currentUrls], uploadError: '' }
            : entry))
        } catch (error) {
          const message = error instanceof Error ? error.message : '图片上传失败'
          uploadErrors.add(message)
          setEntries((current) => current.map((entry) => entry.localId === job.entryId
            ? { ...entry, uploadedUrls: [...currentUrls], uploadError: message }
            : entry))
        } finally {
          setUploadDone((value) => value + 1)
        }
      })
      if (uploadErrors.size > 0) {
        throw new Error(`${uploadErrors.size} 类图片上传失败，请修正后重试；已成功上传的图片会被保留`)
      }

      const captured = capturedAt ? `${capturedAt}T12:00:00+08:00` : undefined
      const payload = {
        client_batch_key: clientBatchKey,
        batch_name: batchName.trim() || undefined,
        venue_type: venueType,
        school_id: schoolId || undefined,
        campus_id: campusId || undefined,
        canteen_id: canteenId || undefined,
        default_window_id: windowId || undefined,
        organization_name: organizationName.trim(),
        area_name: areaName.trim(),
        canteen_name: canteenName.trim(),
        default_floor: floor.trim(),
        default_window_name: windowName.trim(),
        default_window_layout: windowLayout,
        default_service_mode: serviceMode,
        default_meal_periods: mealPeriods,
        captured_at: captured,
        collector_name: collectorName.trim(),
        source_note: sourceNote.trim(),
        entries: entries.map((entry) => ({
          entry_type: entry.entryType,
          name: entry.name.trim(),
          floor: entry.floor.trim(),
          window_name: entry.windowName.trim(),
          window_layout: entry.windowLayout,
          service_mode: entry.serviceMode,
          meal_periods: entry.mealPeriods,
          price_type: entry.priceType,
          price: optionalNumber(entry.price),
          price_min: optionalNumber(entry.priceMin),
          price_max: optionalNumber(entry.priceMax),
          price_unit: entry.priceUnit.trim(),
          price_text: entry.priceText.trim(),
          portion_description: entry.portionDescription.trim(),
          image_paths: (uploadedByEntry.get(entry.localId) || []).filter(Boolean),
          image_kind: entry.imageKind,
          source_filename: entry.files.map((file) => file.name).join(' | '),
          raw_text: entry.rawText.trim(),
          notes: entry.notes.trim(),
        })),
      }
      const result = await adminRequest<{ batch: CollectionBatch; items: CatalogItem[]; idempotent: boolean }>('/api/admin/campus-food-collection/batches', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast.success(result.idempotent ? '批次已存在，已恢复原记录' : `已保存 ${result.items.length} 条采集记录`)
      entries.forEach((entry) => entry.previewUrls.forEach((url) => URL.revokeObjectURL(url)))
      setEntries([])
      setClientBatchKey(newClientBatchKey())
      setUploadDone(0)
      setUploadTotal(0)
      setSelectedBatchId(result.batch.id)
      setSelectedBatchItems(result.items)
      await loadBatches()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采集批次保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1640px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4'>
      <AdminSidebar activeMenu='campus-food-collection' onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className='min-w-0 space-y-6 pb-10'>
        <header className='page-header'>
          <div>
            <p className='eyebrow'>现场采集 / 批量录入</p>
            <h1>食堂采集</h1>
            <p className='muted mt-2'>一批设置一次地点和餐时，逐图补菜名、价格与证据类型；缺图和待确认字段也可以先保存。</p>
          </div>
          <div className='api-pill'>API: {apiBase}</div>
        </header>

        <section className='stats-grid'>
          <Stat label='待提交记录' value={String(entries.length)} foot='条' />
          <Stat label='本地图片' value={String(fileCount)} foot='张' />
          <Stat label='最近批次' value={String(batches.length)} foot='批' />
        </section>

        <section className='detail-panel space-y-5 p-6'>
          <div className='editor-header'>
            <div>
              <h2>1. 本批次公共信息</h2>
              <p>同一食堂、楼层或窗口的一组照片建议放在一个批次。</p>
            </div>
          </div>
          <div className='form-grid'>
            <Field label='场所类型'>
              <select value={venueType} onChange={(event) => switchVenueType(event.target.value)}>
                <option value='university'>大学食堂</option>
                <option value='office_park'>创业/办公园区</option>
                <option value='corporate'>企业食堂</option>
                <option value='community'>社区食堂</option>
                <option value='other'>其他</option>
              </select>
            </Field>
            <Field label='采集日期'>
              <input type='date' value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
            </Field>
            {isUniversity ? (
              <>
                <Field label='搜索学校' wide>
                  <div className='flex gap-2'>
                    <input value={schoolQuery} onChange={(event) => setSchoolQuery(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Enter') void searchSchools()
                    }} placeholder='输入学校名' />
                    <button type='button' onClick={() => void searchSchools()} disabled={directoryBusy}>
                      {directoryBusy ? <span className='spinner small' /> : '搜索'}
                    </button>
                  </div>
                </Field>
                <Field label='学校'>
                  <select value={schoolId} onChange={(event) => chooseSchool(event.target.value)}>
                    <option value=''>请选择</option>
                    {schoolOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label='校区'>
                  <select value={campusId} onChange={(event) => chooseCampus(event.target.value)}>
                    <option value=''>可不选</option>
                    {campusOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label='食堂'>
                  <select value={canteenId} onChange={(event) => chooseCanteen(event.target.value)}>
                    <option value=''>请选择或手填</option>
                    {canteenOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
              </>
            ) : null}
            <Field label={isUniversity ? '学校名称' : '园区/机构名称'}>
              <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder={isUniversity ? '如：清华大学' : '如：AI远景中心'} />
            </Field>
            <Field label={isUniversity ? '校区名称' : '楼宇/区域'}>
              <input value={areaName} onChange={(event) => setAreaName(event.target.value)} placeholder={isUniversity ? '如：清华园校区' : '如：A座'} />
            </Field>
            <Field label='食堂名称'>
              <input value={canteenName} onChange={(event) => setCanteenName(event.target.value)} placeholder='如：紫荆园 / 桃李园 / 园区食堂' />
            </Field>
            {isUniversity ? (
              <Field label='已有窗口'>
                <select value={windowId} onChange={(event) => chooseWindow(event.target.value)}>
                  <option value=''>可不选，下面手填</option>
                  {windowOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label='楼层'>
              <input value={floor} onChange={(event) => setFloor(event.target.value)} placeholder='如：一层 / B1' />
            </Field>
            <Field label='窗口/档口'>
              <input value={windowName} onChange={(event) => setWindowName(event.target.value)} placeholder='如：老北京炸鸡' />
            </Field>
            <Field label='窗口形态'>
              <select value={windowLayout} onChange={(event) => setWindowLayout(event.target.value)}>
                {windowLayoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label='默认售卖形式'>
              <select value={serviceMode} onChange={(event) => setServiceMode(event.target.value)}>
                {serviceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label='批次名称'>
              <input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder='不填则自动生成' />
            </Field>
            <Field label='采集人'>
              <input value={collectorName} onChange={(event) => setCollectorName(event.target.value)} placeholder='助理姓名或小组' />
            </Field>
            <Field label='默认餐时' wide>
              <ChoiceButtons options={mealOptions} selected={mealPeriods} onToggle={toggleDefaultMeal} />
            </Field>
            <Field label='来源备注' wide>
              <textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} rows={2} placeholder='如：现场实拍，菜单可能随日期变化' />
            </Field>
          </div>
        </section>

        <section className='detail-panel space-y-5 p-6'>
          <div className='editor-header'>
            <div>
              <h2>2. 添加分割图片或无图条目</h2>
              <p>批量选图后默认一张图一条记录；同一道菜的菜牌图和实物图可继续追加到同一条。</p>
            </div>
            <div className='actions' style={{ marginTop: 0 }}>
              <label className='cursor-pointer rounded-lg border px-4 py-2 text-sm'>
                批量选择图片
                <input className='hidden' type='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif' multiple onChange={addSelectedFiles} />
              </label>
              <button type='button' onClick={addNoPhotoEntry}>添加无图条目</button>
            </div>
          </div>
          {entries.length === 0 ? (
            <div className='empty-state'>
              <div className='empty-icon'>＋</div>
              <h2>还没有待提交记录</h2>
              <p>选择分割好的照片，或先添加一条缺图菜品/窗口信息。</p>
            </div>
          ) : (
            <div className='space-y-4'>
              {entries.map((entry, index) => (
                <EntryEditor
                  key={entry.localId}
                  entry={entry}
                  index={index}
                  defaultMealPeriods={mealPeriods}
                  defaultServiceMode={serviceMode}
                  defaultWindowLayout={windowLayout}
                  onChange={(patch) => updateEntry(entry.localId, patch)}
                  onToggleMeal={(value) => toggleEntryMeal(entry.localId, value)}
                  onAddFiles={(event) => appendEntryFiles(entry.localId, event)}
                  onRemove={() => removeEntry(entry.localId)}
                />
              ))}
            </div>
          )}
          <div className='flex flex-wrap items-center justify-between gap-4 border-t pt-5'>
            <div className='muted'>
              {uploadTotal > 0 ? `已处理图片 ${uploadDone}/${uploadTotal}` : `将保存 ${entries.length} 条记录、${fileCount} 张图片`}
            </div>
            <button className='primary min-w-40' type='button' disabled={submitting || entries.length === 0} onClick={() => void submitBatch()}>
              {submitting ? <span className='spinner small' /> : null}
              <span className='ml-2'>上传并保存批次</span>
            </button>
          </div>
        </section>

        <section className='detail-panel space-y-5 p-6'>
          <div className='editor-header'>
            <div>
              <h2>最近采集批次</h2>
              <p>点击批次查看已保存记录和待补字段。</p>
            </div>
            <button type='button' onClick={() => void loadBatches()} disabled={historyBusy}>
              {historyBusy ? <span className='spinner small' /> : '刷新'}
            </button>
          </div>
          <div className='grid gap-3 lg:grid-cols-2'>
            {batches.map((batch) => (
              <button
                key={batch.id}
                type='button'
                className={`rounded-xl border p-4 text-left ${selectedBatchId === batch.id ? 'border-emerald-500 bg-emerald-50/50' : ''}`}
                onClick={() => void loadBatchItems(batch.id)}
              >
                <div className='flex items-start justify-between gap-3'>
                  <strong>{batch.batch_name}</strong>
                  <span className='pill active'>{batch.item_count} 条</span>
                </div>
                <p className='muted mt-2'>{[batch.organization_name, batch.area_name, batch.canteen_name, batch.default_floor, batch.default_window_name].filter(Boolean).join(' · ')}</p>
                <p className='muted mt-1'>{formatDate(batch.captured_at || batch.created_at)} · {batch.collector_name || '采集人未填'}</p>
              </button>
            ))}
          </div>
          {selectedBatchId ? (
            <div className='overflow-x-auto rounded-xl border'>
              <table className='w-full min-w-[900px] text-sm'>
                <thead>
                  <tr className='border-b text-left'>
                    <th className='p-3'>图片</th>
                    <th className='p-3'>条目</th>
                    <th className='p-3'>窗口/餐时</th>
                    <th className='p-3'>售卖/价格</th>
                    <th className='p-3'>待补</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBatchItems.map((item) => (
                    <tr key={item.id} className='border-b last:border-0'>
                      <td className='p-3'>
                        {item.image_paths?.[0] ? <img className='h-16 w-20 rounded-lg object-cover' src={item.image_paths[0]} alt={item.name || '食堂采集图片'} /> : <span className='pill'>缺图</span>}
                      </td>
                      <td className='p-3'><strong>{item.name || '待补名称'}</strong><div className='muted'>{labelOf(entryTypeOptions, item.entry_type)} · {labelOf(imageKindOptions, item.image_kind)}</div></td>
                      <td className='p-3'>{[item.floor, item.window_name].filter(Boolean).join(' · ') || '-'}<div className='muted'>{(item.meal_periods || []).map((value) => labelOf(mealOptions, value)).join(' / ') || '餐时待确认'}</div></td>
                      <td className='p-3'>{labelOf(serviceOptions, item.service_mode)}<div className='muted'>{priceSummary(item)}</div></td>
                      <td className='p-3'><div className='flex flex-wrap gap-1'>{(item.missing_fields || []).map((field) => <span key={field} className='pill inactive'>{missingFieldLabel(field)}</span>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

function EntryEditor({
  entry,
  index,
  defaultMealPeriods,
  defaultServiceMode,
  defaultWindowLayout,
  onChange,
  onToggleMeal,
  onAddFiles,
  onRemove,
}: {
  entry: DraftEntry
  index: number
  defaultMealPeriods: string[]
  defaultServiceMode: string
  defaultWindowLayout: string
  onChange: (patch: Partial<DraftEntry>) => void
  onToggleMeal: (value: string) => void
  onAddFiles: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: () => void
}) {
  const effectiveMeals = entry.mealPeriods.length ? entry.mealPeriods : defaultMealPeriods
  return (
    <article className='rounded-2xl border p-5'>
      <div className='mb-4 flex flex-wrap items-start justify-between gap-3'>
        <div>
          <strong>第 {index + 1} 条</strong>
          <span className='muted ml-2'>{entry.files.map((file) => file.name).join('、') || '无图记录'}</span>
        </div>
        <div className='actions' style={{ marginTop: 0 }}>
          <label className='cursor-pointer rounded-lg border px-3 py-2 text-xs'>
            追加图片
            <input className='hidden' type='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif' multiple onChange={onAddFiles} />
          </label>
          <button className='destructive' type='button' onClick={onRemove}>移除</button>
        </div>
      </div>
      {entry.previewUrls.length ? (
        <div className='mb-4 flex gap-2 overflow-x-auto'>
          {entry.previewUrls.map((url, previewIndex) => <img key={url} className='h-28 w-36 shrink-0 rounded-xl object-cover' src={url} alt={`预览 ${previewIndex + 1}`} />)}
        </div>
      ) : null}
      {entry.uploadError ? <div className='mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'>{entry.uploadError}</div> : null}
      <div className='form-grid'>
        <Field label='条目类型'>
          <select value={entry.entryType} onChange={(event) => onChange({ entryType: event.target.value })}>
            {entryTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label='图片证据类型'>
          <select value={entry.imageKind} onChange={(event) => onChange({ imageKind: event.target.value })}>
            {imageKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label='菜名/条目名' wide>
          <input value={entry.name} onChange={(event) => onChange({ name: event.target.value })} placeholder='可暂时不填；窗口整体会自动用窗口名' />
        </Field>
        <Field label='楼层覆盖'>
          <input value={entry.floor} onChange={(event) => onChange({ floor: event.target.value })} placeholder='留空继承批次' />
        </Field>
        <Field label='窗口覆盖'>
          <input value={entry.windowName} onChange={(event) => onChange({ windowName: event.target.value })} placeholder='留空继承批次' />
        </Field>
        <Field label='窗口形态'>
          <select value={entry.windowLayout} onChange={(event) => onChange({ windowLayout: event.target.value })}>
            <option value=''>继承：{labelOf(windowLayoutOptions, defaultWindowLayout)}</option>
            {windowLayoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label='售卖形式'>
          <select value={entry.serviceMode} onChange={(event) => onChange({ serviceMode: event.target.value })}>
            <option value=''>继承：{labelOf(serviceOptions, defaultServiceMode)}</option>
            {serviceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label='餐时' wide>
          <ChoiceButtons options={mealOptions} selected={effectiveMeals} onToggle={onToggleMeal} />
          {!entry.mealPeriods.length ? <p className='muted mt-1'>当前继承批次餐时，点任一项后改为本条独立餐时。</p> : null}
        </Field>
        <Field label='计价方式'>
          <select value={entry.priceType} onChange={(event) => onChange({ priceType: event.target.value })}>
            {priceTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {entry.priceType === 'range' ? (
          <>
            <Field label='最低价'><input type='number' step='0.01' min='0' value={entry.priceMin} onChange={(event) => onChange({ priceMin: event.target.value })} /></Field>
            <Field label='最高价'><input type='number' step='0.01' min='0' value={entry.priceMax} onChange={(event) => onChange({ priceMax: event.target.value })} /></Field>
          </>
        ) : (
          <Field label='标价'><input type='number' step='0.01' min='0' value={entry.price} onChange={(event) => onChange({ price: event.target.value })} placeholder='可不填' /></Field>
        )}
        <Field label='价格单位'>
          <input value={entry.priceUnit} onChange={(event) => onChange({ priceUnit: event.target.value })} placeholder='元/份、元/两、元/斤' />
        </Field>
        <Field label='价格原文/规则' wide>
          <input value={entry.priceText} onChange={(event) => onChange({ priceText: event.target.value })} placeholder='如：任选三样 12 元；按最终所选菜品结算' />
        </Field>
        <Field label='份量说明'>
          <input value={entry.portionDescription} onChange={(event) => onChange({ portionDescription: event.target.value })} placeholder='如：一份、两串、可选四样' />
        </Field>
        <Field label='照片可见文字' wide>
          <textarea value={entry.rawText} onChange={(event) => onChange({ rawText: event.target.value })} rows={2} placeholder='菜单牌、价签、窗口招牌上的原始文字，可先整段录入' />
        </Field>
        <Field label='备注' wide>
          <textarea value={entry.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={2} placeholder='如：只有价签没有实物图；晚餐可能不供应' />
        </Field>
      </div>
    </article>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`form-field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label>
}

function ChoiceButtons({ options, selected, onToggle }: { options: Array<[string, string]>; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div className='flex flex-wrap gap-2'>
      {options.map(([value, label]) => (
        <button key={value} type='button' className={selected.includes(value) ? 'primary' : ''} onClick={() => onToggle(value)}>{label}</button>
      ))}
    </div>
  )
}

function Stat({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <article className='stat-card'><span className='stat-label'>{label}</span><strong>{value}</strong><span className='stat-foot'>{foot}</span></article>
}

function createDraftEntry(files: File[]): DraftEntry {
  return {
    localId: newClientBatchKey(),
    files,
    previewUrls: files.map((file) => URL.createObjectURL(file)),
    uploadedUrls: files.map(() => ''),
    entryType: 'dish',
    name: guessName(files[0]?.name || ''),
    imageKind: 'dish',
    floor: '',
    windowName: '',
    windowLayout: '',
    serviceMode: '',
    mealPeriods: [],
    priceType: 'unknown',
    price: '',
    priceMin: '',
    priceMax: '',
    priceUnit: '元/份',
    priceText: '',
    portionDescription: '',
    rawText: '',
    notes: '',
    uploadError: '',
  }
}

function guessName(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').trim()
  if (!stem || /^(img|image|wx|mmexport|screenshot|dsc|photo)[-_ ]?\d*$/i.test(stem)) return ''
  if (/^[a-f0-9-]{12,}$/i.test(stem)) return ''
  return stem
}

function toggleValue(values: string[], value: string): string[] {
  const next = values.includes(value) ? values.filter((item) => item !== value) : [...values.filter((item) => item !== 'unknown'), value]
  return next.length ? next : ['unknown']
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

function todayInputValue(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function newClientBatchKey(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined
  return cryptoObject?.randomUUID?.call(cryptoObject) || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function labelOf(options: Array<[string, string]>, value: string): string {
  return options.find(([key]) => key === value)?.[1] || value || '-'
}

function missingFieldLabel(value: string): string {
  if (value === 'name') return '缺名称'
  if (value === 'image') return '缺图片'
  if (value === 'price') return '缺价格'
  return value
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

function priceSummary(item: CatalogItem): string {
  if (item.price_type === 'range' && item.price_min != null && item.price_max != null) return `${item.price_min}-${item.price_max}${item.price_unit || '元'}`
  if (item.price != null) return `${item.price}${item.price_unit || '元'}`
  return item.price_text || '价格待补充'
}
