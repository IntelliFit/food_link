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
  description?: string
  window_id?: string
  floor?: string
  window_name?: string
  window_layout?: string
  service_mode: string
  meal_periods?: string[]
  available_weekdays?: string[]
  availability_note?: string
  price_type: string
  price?: number
  price_min?: number
  price_max?: number
  price_unit?: string
  price_text?: string
  price_options?: Record<string, unknown>
  portion_description?: string
  image_paths?: string[]
  image_kind: string
  source_filename?: string
  raw_text?: string
  notes?: string
  missing_fields?: string[]
  completeness_status: string
  status: 'draft' | 'published' | 'changes_pending' | 'analysis_pending' | 'analysis_failed' | string
  analysis_task_id?: string
  analysis_error?: string
  analysis_started_at?: string
  analysis_completed_at?: string
  published_at?: string
}

type CatalogItemEditDraft = {
  itemId: string
  entryType: string
  name: string
  description: string
  windowId: string
  floor: string
  windowName: string
  windowLayout: string
  serviceMode: string
  mealPeriods: string[]
  availableWeekdays: string[]
  availabilityNote: string
  priceType: string
  price: string
  priceMin: string
  priceMax: string
  priceUnit: string
  priceText: string
  priceOptions: Record<string, unknown>
  portionDescription: string
  imagePaths: string[]
  imageKind: string
  sourceFilename: string
  rawText: string
  notes: string
  newFiles: File[]
  previewUrls: string[]
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

const weekdayOptions: Array<[string, string]> = [
  ['monday', '周一'],
  ['tuesday', '周二'],
  ['wednesday', '周三'],
  ['thursday', '周四'],
  ['friday', '周五'],
  ['saturday', '周六'],
  ['sunday', '周日'],
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
  const [editingItem, setEditingItem] = useState<CatalogItemEditDraft | null>(null)
  const [itemSaving, setItemSaving] = useState(false)
  const [publishingItemId, setPublishingItemId] = useState('')
  const [batchPublishMode, setBatchPublishMode] = useState(false)
  const [selectedPublishItemIds, setSelectedPublishItemIds] = useState<string[]>([])
  const [batchPublishing, setBatchPublishing] = useState(false)
  const [batchPublishDone, setBatchPublishDone] = useState(0)
  const [batchPublishTotal, setBatchPublishTotal] = useState(0)

  const isUniversity = venueType === 'university'
  const apiBase = displayApiBase()
  const fileCount = useMemo(() => entries.reduce((sum, entry) => sum + entry.files.length, 0), [entries])
  const publishableBatchItems = useMemo(
    () => selectedBatchItems.filter(isCatalogItemPublishable),
    [selectedBatchItems],
  )
  const selectedPublishItems = useMemo(() => {
    const selectedIds = new Set(selectedPublishItemIds)
    return publishableBatchItems.filter((item) => selectedIds.has(item.id))
  }, [publishableBatchItems, selectedPublishItemIds])
  const hasPendingAnalysis = useMemo(
    () => selectedBatchItems.some((item) => item.status === 'analysis_pending'),
    [selectedBatchItems],
  )

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

  useEffect(() => {
    if (!selectedBatchId || !hasPendingAnalysis || batchPublishing) return undefined
    const timer = window.setInterval(() => {
      void refreshBatchItems(selectedBatchId, true)
    }, 4000)
    return () => window.clearInterval(timer)
    // refreshBatchItems intentionally reads only its arguments and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, hasPendingAnalysis, batchPublishing])

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
    if (batchPublishing) return
    setSelectedBatchId(batchId)
    setBatchPublishMode(false)
    setSelectedPublishItemIds([])
    setHistoryBusy(true)
    try {
      await refreshBatchItems(batchId)
    } finally {
      setHistoryBusy(false)
    }
  }

  async function refreshBatchItems(batchId: string, silent = false) {
    try {
      const data = await adminRequest<{ items: CatalogItem[] }>(`/api/admin/campus-food-collection/items?batch_id=${encodeURIComponent(batchId)}`)
      setSelectedBatchItems(data.items || [])
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : '批次明细读取失败')
    }
  }

  function openItemEditor(item: CatalogItem) {
    setEditingItem((current) => {
      current?.previewUrls.forEach((url) => URL.revokeObjectURL(url))
      return createCatalogItemEditDraft(item)
    })
  }

  function closeItemEditor() {
    if (itemSaving) return
    setEditingItem((current) => {
      current?.previewUrls.forEach((url) => URL.revokeObjectURL(url))
      return null
    })
  }

  function updateEditingItem(patch: Partial<CatalogItemEditDraft>) {
    setEditingItem((current) => (current ? { ...current, ...patch } : current))
  }

  function addEditingItemImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setEditingItem((current) => {
      if (!current) return current
      const room = Math.max(0, 6 - current.imagePaths.length - current.newFiles.length)
      const accepted = files.slice(0, room)
      if (accepted.length < files.length) toast.error('每条记录最多保留 6 张图片')
      return {
        ...current,
        newFiles: [...current.newFiles, ...accepted],
        previewUrls: [...current.previewUrls, ...accepted.map((file) => URL.createObjectURL(file))],
      }
    })
  }

  function removeEditingItemImage(index: number) {
    setEditingItem((current) => (current ? {
      ...current,
      imagePaths: current.imagePaths.filter((_, imageIndex) => imageIndex !== index),
    } : current))
  }

  function removeEditingItemNewImage(index: number) {
    setEditingItem((current) => {
      if (!current) return current
      URL.revokeObjectURL(current.previewUrls[index])
      return {
        ...current,
        newFiles: current.newFiles.filter((_, imageIndex) => imageIndex !== index),
        previewUrls: current.previewUrls.filter((_, imageIndex) => imageIndex !== index),
      }
    })
  }

  function toggleEditingItemValues(field: 'mealPeriods' | 'availableWeekdays', value: string) {
    setEditingItem((current) => {
      if (!current) return current
      const values = current[field]
      const next = field === 'mealPeriods'
        ? toggleValue(values, value)
        : toggleSimpleValue(values, value)
      return { ...current, [field]: next }
    })
  }

  async function saveEditingItem() {
    if (!editingItem) return
    setItemSaving(true)
    try {
      const uploadedImagePaths: string[] = []
      await runWithConcurrency(editingItem.newFiles, 3, async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const data = await adminUpload<{ image_url: string }>('/api/admin/campus-food-collection/images', formData)
        uploadedImagePaths.push(data.image_url)
      })
      const imagePaths = [...editingItem.imagePaths, ...uploadedImagePaths]
      const sourceFilename = [editingItem.sourceFilename, ...editingItem.newFiles.map((file) => file.name)].filter(Boolean).join(' | ')
      const item = await adminRequest<{ item: CatalogItem }>(`/api/admin/campus-food-collection/items/${encodeURIComponent(editingItem.itemId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          entry_type: editingItem.entryType,
          name: editingItem.name.trim(),
          description: editingItem.description.trim(),
          window_id: editingItem.windowId || undefined,
          floor: editingItem.floor.trim(),
          window_name: editingItem.windowName.trim(),
          window_layout: editingItem.windowLayout,
          service_mode: editingItem.serviceMode,
          meal_periods: editingItem.mealPeriods,
          available_weekdays: editingItem.availableWeekdays,
          availability_note: editingItem.availabilityNote.trim(),
          price_type: editingItem.priceType,
          price: optionalNumber(editingItem.price),
          price_min: optionalNumber(editingItem.priceMin),
          price_max: optionalNumber(editingItem.priceMax),
          price_unit: editingItem.priceUnit.trim(),
          price_text: editingItem.priceText.trim(),
          price_options: editingItem.priceOptions,
          portion_description: editingItem.portionDescription.trim(),
          image_paths: imagePaths,
          image_kind: editingItem.imageKind,
          source_filename: sourceFilename,
          raw_text: editingItem.rawText.trim(),
          notes: editingItem.notes.trim(),
        }),
      })
      setSelectedBatchItems((current) => current.map((currentItem) => (currentItem.id === item.item.id ? item.item : currentItem)))
      editingItem.previewUrls.forEach((url) => URL.revokeObjectURL(url))
      setEditingItem(null)
      toast.success(item.item.missing_fields?.length ? '条目已保存，可继续补充剩余字段' : '条目已补充完整')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '条目保存失败')
    } finally {
      setItemSaving(false)
    }
  }

  async function publishCatalogItem(item: CatalogItem) {
    if ((item.missing_fields || []).length || item.completeness_status !== 'complete') {
      toast.error('请先补齐名称、图片和价格后再提交上线')
      return
    }
    const actionLabel = item.status === 'analysis_failed'
      ? '重新提交 AI 分析'
      : item.status === 'changes_pending'
        ? '提交 AI 分析更新'
        : '提交 AI 分析并上线'
    if (!window.confirm(`${actionLabel}？AI 成功后将自动上线；首次上传在分析完成前不会出现在小程序。`)) return
    setPublishingItemId(item.id)
    try {
      const data = await adminRequest<{ item: CatalogItem }>(`/api/admin/campus-food-collection/items/${encodeURIComponent(item.id)}/publish`, {
        method: 'POST',
      })
      setSelectedBatchItems((current) => current.map((currentItem) => (currentItem.id === data.item.id ? data.item : currentItem)))
      toast.success('AI 分析已提交，成功后自动上线')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交 AI 分析失败')
    } finally {
      setPublishingItemId('')
    }
  }

  function toggleBatchPublishMode() {
    if (batchPublishing) return
    setBatchPublishMode((current) => !current)
    setSelectedPublishItemIds([])
    setBatchPublishDone(0)
    setBatchPublishTotal(0)
  }

  function togglePublishItemSelection(item: CatalogItem) {
    if (!isCatalogItemPublishable(item) || batchPublishing) return
    setSelectedPublishItemIds((current) => current.includes(item.id)
      ? current.filter((itemId) => itemId !== item.id)
      : [...current, item.id])
  }

  function toggleAllPublishableItems() {
    if (batchPublishing) return
    const allIds = publishableBatchItems.map((item) => item.id)
    const allSelected = allIds.length > 0 && allIds.every((itemId) => selectedPublishItemIds.includes(itemId))
    setSelectedPublishItemIds(allSelected ? [] : allIds)
  }

  async function publishSelectedCatalogItems() {
    if (!selectedPublishItems.length || batchPublishing) return
    const selectedCount = selectedPublishItems.length
    if (!window.confirm(`确定将选中的 ${selectedCount} 条校园食物批量提交 AI 分析吗？分析成功后会自动上线，首次上传在完成前不会出现在小程序。`)) return

    setBatchPublishing(true)
    setBatchPublishDone(0)
    setBatchPublishTotal(selectedCount)
    const publishedItems = new Map<string, CatalogItem>()
    const failedItemIds: string[] = []
    try {
      await runWithConcurrency(selectedPublishItems, 3, async (item) => {
        try {
          const data = await adminRequest<{ item: CatalogItem }>(`/api/admin/campus-food-collection/items/${encodeURIComponent(item.id)}/publish`, {
            method: 'POST',
          })
          publishedItems.set(data.item.id, data.item)
        } catch {
          failedItemIds.push(item.id)
        } finally {
          setBatchPublishDone((current) => current + 1)
        }
      })
      setSelectedBatchItems((current) => current.map((item) => publishedItems.get(item.id) || item))
      setSelectedPublishItemIds(failedItemIds)
      if (failedItemIds.length) {
        toast.error(`批量提交完成：已进入 AI 分析 ${publishedItems.size} 条，提交失败 ${failedItemIds.length} 条；失败项已保留勾选`)
      } else {
        setBatchPublishMode(false)
        toast.success(`已提交 ${publishedItems.size} 条进行 AI 分析，成功后自动上线`)
      }
    } finally {
      setBatchPublishing(false)
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
          <div className='collection-batch-grid'>
            {batches.map((batch) => (
              <button
                key={batch.id}
                type='button'
                className={`collection-batch-card ${selectedBatchId === batch.id ? 'selected' : ''}`}
                onClick={() => void loadBatchItems(batch.id)}
                disabled={batchPublishing}
              >
                <div className='collection-batch-heading'>
                  <strong title={batch.batch_name}>{batch.batch_name}</strong>
                  <span className='pill active'>{batch.item_count} 条</span>
                </div>
                <p className='collection-batch-location'>
                  {[batch.organization_name, batch.area_name, batch.canteen_name, batch.default_floor, batch.default_window_name].filter(Boolean).join(' · ')}
                </p>
                <p className='collection-batch-meta'>
                  <span>{formatDate(batch.captured_at || batch.created_at)}</span>
                  <span>{batch.collector_name || '采集人未填'}</span>
                </p>
              </button>
            ))}
          </div>
          {selectedBatchId ? (
            <div className='space-y-3'>
              <div className={`collection-batch-publish-toolbar ${batchPublishMode ? 'active' : ''}`}>
                <div>
                  <strong>{batchPublishMode ? `已选择 ${selectedPublishItems.length} 条` : `可提交分析 ${publishableBatchItems.length} 条`}</strong>
                  <p>
                    {batchPublishing
                      ? `正在提交 ${batchPublishDone}/${batchPublishTotal}`
                      : batchPublishMode
                        ? '只可选择字段完整且不在分析中的条目；AI 失败项可直接重试。'
                        : '批量提交原有 AI 食物分析，成功后自动上线；分析中会自动刷新状态。'}
                  </p>
                </div>
                <div className='actions collection-batch-publish-actions'>
                  {batchPublishMode ? (
                    <>
                      <button type='button' onClick={toggleAllPublishableItems} disabled={batchPublishing || publishableBatchItems.length === 0}>
                        {publishableBatchItems.length > 0 && selectedPublishItems.length === publishableBatchItems.length ? '取消全选' : '全选可分析'}
                      </button>
                      <button type='button' onClick={toggleBatchPublishMode} disabled={batchPublishing}>退出批量模式</button>
                      <button type='button' className='primary' onClick={() => void publishSelectedCatalogItems()} disabled={batchPublishing || selectedPublishItems.length === 0}>
                        {batchPublishing ? <span className='spinner small' /> : null}
                        <span className={batchPublishing ? 'ml-2' : ''}>
                          {batchPublishing ? `提交中 ${batchPublishDone}/${batchPublishTotal}` : `批量提交 AI 分析并上线（${selectedPublishItems.length}）`}
                        </span>
                      </button>
                    </>
                  ) : (
                    <button type='button' className='primary' onClick={toggleBatchPublishMode} disabled={publishableBatchItems.length === 0} title={publishableBatchItems.length === 0 ? '当前批次没有可上线条目' : undefined}>
                      批量 AI 分析上线
                    </button>
                  )}
                </div>
              </div>
              <div className='overflow-x-auto rounded-xl border'>
                <table className={`w-full text-sm ${batchPublishMode ? 'min-w-[1080px]' : 'min-w-[1020px]'}`}>
                  <thead>
                    <tr className='border-b text-left'>
                      {batchPublishMode ? <th className='collection-select-cell p-3'>选择</th> : null}
                      <th className='p-3'>图片</th>
                      <th className='p-3'>条目</th>
                      <th className='p-3'>窗口/餐时</th>
                      <th className='p-3'>售卖/价格/分量</th>
                      <th className='p-3'>待补</th>
                      <th className='p-3 text-right'>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBatchItems.map((item) => {
                      const publishable = isCatalogItemPublishable(item)
                      const selected = selectedPublishItemIds.includes(item.id)
                      return (
                        <tr key={item.id} className={`border-b last:border-0 ${selected ? 'collection-item-selected' : ''}`}>
                          {batchPublishMode ? (
                            <td className='collection-select-cell p-3'>
                              <input
                                className='collection-select-checkbox'
                                type='checkbox'
                                checked={selected}
                                disabled={!publishable || batchPublishing}
                                aria-label={`选择${item.name || '未命名条目'}`}
                                title={catalogPublishDisabledReason(item)}
                                onChange={() => togglePublishItemSelection(item)}
                              />
                            </td>
                          ) : null}
                          <td className='p-3'>
                            {item.image_paths?.[0] ? <img className='h-16 w-20 rounded-lg object-cover' src={item.image_paths[0]} alt={item.name || '食堂采集图片'} /> : <span className='pill'>缺图</span>}
                          </td>
                          <td className='p-3'><strong>{item.name || '待补名称'}</strong><div className='muted'>{labelOf(entryTypeOptions, item.entry_type)} · {labelOf(imageKindOptions, item.image_kind)}</div></td>
                          <td className='p-3'>{[item.floor, item.window_name].filter(Boolean).join(' · ') || '-'}<div className='muted'>{(item.meal_periods || []).map((value) => labelOf(mealOptions, value)).join(' / ') || '餐时待确认'}</div></td>
                          <td className='p-3'>
                            {labelOf(serviceOptions, item.service_mode)}
                            <div className='muted'>价格：{priceSummary(item)}</div>
                            <div className='muted'>分量：{item.portion_description || '待补充'}</div>
                          </td>
                          <td className='p-3'>
                            <div className='flex flex-wrap gap-1'>
                              {(item.missing_fields || []).length
                                ? (item.missing_fields || []).map((field) => <span key={field} className='pill inactive'>{missingFieldLabel(field)}</span>)
                                : <span className='pill active'>已完整</span>}
                            </div>
                            <div className='mt-2'>
                              <span className={`pill ${item.status === 'published' ? 'active' : item.status === 'changes_pending' || item.status === 'analysis_pending' ? 'warning' : item.status === 'analysis_failed' ? 'inactive' : ''}`}>
                                {catalogPublishStatusLabel(item.status)}
                              </span>
                              {item.status === 'analysis_failed' && item.analysis_error ? <div className='muted mt-1' title={item.analysis_error}>{shortAnalysisError(item.analysis_error)}</div> : null}
                            </div>
                          </td>
                          <td className='p-3 text-right'>
                            <div className='collection-item-actions'>
                              <button type='button' className='min-h-8 px-3' onClick={() => openItemEditor(item)} disabled={publishingItemId === item.id || batchPublishing || item.status === 'analysis_pending'}>编辑补充</button>
                              <button
                                type='button'
                                className='primary min-h-8 px-3'
                                onClick={() => void publishCatalogItem(item)}
                                disabled={publishingItemId === item.id || batchPublishing || item.status === 'published' || item.status === 'analysis_pending' || Boolean((item.missing_fields || []).length)}
                                title={catalogPublishDisabledReason(item)}
                              >
                                {publishingItemId === item.id ? <span className='spinner small' /> : null}
                                <span className={publishingItemId === item.id ? 'ml-2' : ''}>
                                  {catalogPublishActionLabel(item.status)}
                                </span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </main>
      {editingItem ? (
        <CatalogItemEditDialog
          draft={editingItem}
          saving={itemSaving}
          onChange={updateEditingItem}
          onToggleMeal={(value) => toggleEditingItemValues('mealPeriods', value)}
          onToggleWeekday={(value) => toggleEditingItemValues('availableWeekdays', value)}
          onAddImages={addEditingItemImages}
          onRemoveImage={removeEditingItemImage}
          onRemoveNewImage={removeEditingItemNewImage}
          onCancel={closeItemEditor}
          onSave={() => void saveEditingItem()}
        />
      ) : null}
    </div>
  )
}

function CatalogItemEditDialog({
  draft,
  saving,
  onChange,
  onToggleMeal,
  onToggleWeekday,
  onAddImages,
  onRemoveImage,
  onRemoveNewImage,
  onCancel,
  onSave,
}: {
  draft: CatalogItemEditDraft
  saving: boolean
  onChange: (patch: Partial<CatalogItemEditDraft>) => void
  onToggleMeal: (value: string) => void
  onToggleWeekday: (value: string) => void
  onAddImages: (event: ChangeEvent<HTMLInputElement>) => void
  onRemoveImage: (index: number) => void
  onRemoveNewImage: (index: number) => void
  onCancel: () => void
  onSave: () => void
}) {
  const imageCount = draft.imagePaths.length + draft.newFiles.length
  return (
    <div className='modal-overlay' role='presentation' onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className='modal-panel catalog-item-editor' role='dialog' aria-modal='true' aria-labelledby='catalog-item-editor-title'>
        <div className='editor-header'>
          <div>
            <h2 id='catalog-item-editor-title'>编辑采集条目</h2>
            <p>可以分多次补充；保存只更新后台草稿，不会直接显示到小程序。</p>
          </div>
          <button type='button' onClick={onCancel} disabled={saving}>关闭</button>
        </div>

        <div className='catalog-item-editor-section'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <strong>图片证据</strong>
              <p className='muted mt-1 text-xs'>已有图片可移除，也可以继续补图；每条最多 6 张。</p>
            </div>
            <label className={`button-link ${imageCount >= 6 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
              添加图片
              <input className='hidden' type='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif' multiple disabled={saving || imageCount >= 6} onChange={onAddImages} />
            </label>
          </div>
          {imageCount ? (
            <div className='catalog-item-image-grid'>
              {draft.imagePaths.map((url, index) => (
                <div key={url} className='catalog-item-image'>
                  <img src={url} alt={`已有图片 ${index + 1}`} />
                  <button type='button' className='destructive' disabled={saving} onClick={() => onRemoveImage(index)}>移除</button>
                </div>
              ))}
              {draft.previewUrls.map((url, index) => (
                <div key={url} className='catalog-item-image'>
                  <img src={url} alt={`待上传图片 ${index + 1}`} />
                  <span className='pill active'>待上传</span>
                  <button type='button' className='destructive' disabled={saving} onClick={() => onRemoveNewImage(index)}>移除</button>
                </div>
              ))}
            </div>
          ) : <div className='catalog-item-no-image'>当前缺少图片，可先保存其他字段，之后再补。</div>}
        </div>

        <div className='form-grid catalog-item-editor-form'>
          <Field label='条目类型'>
            <select value={draft.entryType} onChange={(event) => onChange({ entryType: event.target.value })}>
              {entryTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label='图片证据类型'>
            <select value={draft.imageKind} onChange={(event) => onChange({ imageKind: event.target.value })}>
              {imageKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label='菜名/条目名' wide>
            <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder='如：番茄炒饭' />
          </Field>
          <Field label='条目说明' wide>
            <textarea value={draft.description} onChange={(event) => onChange({ description: event.target.value })} rows={2} placeholder='补充菜品、套餐或窗口的说明' />
          </Field>
          <Field label='楼层'>
            <input value={draft.floor} onChange={(event) => onChange({ floor: event.target.value })} placeholder='如：2F' />
          </Field>
          <Field label='窗口/档口'>
            <input value={draft.windowName} onChange={(event) => onChange({ windowName: event.target.value })} placeholder='如：中式炒饭' />
          </Field>
          <Field label='窗口形态'>
            <select value={draft.windowLayout} onChange={(event) => onChange({ windowLayout: event.target.value })}>
              {windowLayoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label='售卖形式'>
            <select value={draft.serviceMode} onChange={(event) => onChange({ serviceMode: event.target.value })}>
              {serviceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label='餐时' wide>
            <ChoiceButtons options={mealOptions} selected={draft.mealPeriods} onToggle={onToggleMeal} />
          </Field>
          <Field label='供应星期' wide>
            <ChoiceButtons options={weekdayOptions} selected={draft.availableWeekdays} onToggle={onToggleWeekday} />
          </Field>
          <Field label='供应说明' wide>
            <input value={draft.availabilityNote} onChange={(event) => onChange({ availabilityNote: event.target.value })} placeholder='如：仅工作日午餐；售完即止' />
          </Field>
          <Field label='计价方式'>
            <select value={draft.priceType} onChange={(event) => onChange({ priceType: event.target.value })}>
              {priceTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {draft.priceType === 'range' ? (
            <>
              <Field label='最低价'><input type='number' min='0' step='0.01' value={draft.priceMin} onChange={(event) => onChange({ priceMin: event.target.value })} /></Field>
              <Field label='最高价'><input type='number' min='0' step='0.01' value={draft.priceMax} onChange={(event) => onChange({ priceMax: event.target.value })} /></Field>
            </>
          ) : (
            <Field label='标价'><input type='number' min='0' step='0.01' value={draft.price} onChange={(event) => onChange({ price: event.target.value })} placeholder='可暂时不填' /></Field>
          )}
          <Field label='价格单位'>
            <input value={draft.priceUnit} onChange={(event) => onChange({ priceUnit: event.target.value })} placeholder='元/份、元/两、元/斤' />
          </Field>
          <Field label='价格原文/规则' wide>
            <input value={draft.priceText} onChange={(event) => onChange({ priceText: event.target.value })} placeholder='如：任选三样 12 元' />
          </Field>
          <Field label='份量说明' wide>
            <input value={draft.portionDescription} onChange={(event) => onChange({ portionDescription: event.target.value })} placeholder='如：一盘、两串、约 300g' />
          </Field>
          <Field label='照片可见文字' wide>
            <textarea value={draft.rawText} onChange={(event) => onChange({ rawText: event.target.value })} rows={3} placeholder='录入菜单牌、价签、窗口招牌上的原始文字' />
          </Field>
          <Field label='内部备注' wide>
            <textarea value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={3} placeholder='记录待核实信息或补录来源' />
          </Field>
        </div>

        <div className='catalog-item-editor-actions'>
          <span className='muted'>允许保留未完整状态；补齐后提交原有 AI 食物分析，成功才会自动上线。</span>
          <div className='actions' style={{ marginTop: 0 }}>
            <button type='button' onClick={onCancel} disabled={saving}>取消</button>
            <button type='button' className='primary min-w-32' onClick={onSave} disabled={saving}>
              {saving ? <span className='spinner small' /> : null}
              <span className={saving ? 'ml-2' : ''}>保存条目</span>
            </button>
          </div>
        </div>
      </section>
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

function createCatalogItemEditDraft(item: CatalogItem): CatalogItemEditDraft {
  return {
    itemId: item.id,
    entryType: item.entry_type || 'dish',
    name: item.name || '',
    description: item.description || '',
    windowId: item.window_id || '',
    floor: item.floor || '',
    windowName: item.window_name || '',
    windowLayout: item.window_layout || 'unknown',
    serviceMode: item.service_mode || 'unknown',
    mealPeriods: item.meal_periods?.length ? [...item.meal_periods] : ['unknown'],
    availableWeekdays: [...(item.available_weekdays || [])],
    availabilityNote: item.availability_note || '',
    priceType: item.price_type || 'unknown',
    price: item.price == null ? '' : String(item.price),
    priceMin: item.price_min == null ? '' : String(item.price_min),
    priceMax: item.price_max == null ? '' : String(item.price_max),
    priceUnit: item.price_unit || '',
    priceText: item.price_text || '',
    priceOptions: item.price_options || {},
    portionDescription: item.portion_description || '',
    imagePaths: [...(item.image_paths || [])],
    imageKind: item.image_kind || 'dish',
    sourceFilename: item.source_filename || '',
    rawText: item.raw_text || '',
    notes: item.notes || '',
    newFiles: [],
    previewUrls: [],
  }
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

function isCatalogItemPublishable(item: CatalogItem): boolean {
  return item.status !== 'published'
    && item.status !== 'analysis_pending'
    && item.completeness_status === 'complete'
    && (item.missing_fields || []).length === 0
}

function toggleSimpleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
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
  const unit = displayPriceUnit(item.price_unit)
  if (item.price_type === 'range' && item.price_min != null && item.price_max != null) return `${item.price_min}-${item.price_max}${unit}`
  if (item.price != null) return `${item.price}${unit}`
  return item.price_text || '价格待补充'
}

function displayPriceUnit(value?: string): string {
  const unit = value?.trim()
  if (!unit) return '元'
  if (unit === '元' || unit.startsWith('元/')) return unit
  return `元/${unit}`
}

function catalogPublishStatusLabel(status: string): string {
  if (status === 'published') return '小程序已上线'
  if (status === 'analysis_pending') return 'AI 分析中'
  if (status === 'analysis_failed') return 'AI 分析失败'
  if (status === 'changes_pending') return '有修改待上线'
  return '仅后台草稿'
}

function catalogPublishActionLabel(status: string): string {
  if (status === 'published') return '已上线'
  if (status === 'analysis_pending') return 'AI 分析中'
  if (status === 'analysis_failed') return '重新分析'
  if (status === 'changes_pending') return '分析更新并上线'
  return 'AI 分析并上线'
}

function catalogPublishDisabledReason(item: CatalogItem): string | undefined {
  if (item.status === 'published') return '该条目已经上线'
  if (item.status === 'analysis_pending') return 'AI 分析进行中，请等待结果'
  if ((item.missing_fields || []).length || item.completeness_status !== 'complete') return '请先补齐名称、图片和价格'
  return '选择此条目'
}

function shortAnalysisError(value: string): string {
  const normalized = value.trim()
  return normalized.length > 42 ? `${normalized.slice(0, 42)}…` : normalized
}
