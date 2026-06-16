export type LabelType = 'total' | 'items' | 'unlabeled'
export type SampleStatus = 'labeled' | 'unlabeled'
export type RunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
export type RunSampleStatus = 'pending' | 'processing' | 'done' | 'failed' | 'cancelled'
export type ExecutionMode = 'fast' | 'standard' | 'strict' | 'fast_web_search' | 'standard_web_search' | 'strict_web_search' | 'gemini35_flash_grouped'

export interface DatasetSample {
  id: string
  batch_name: string
  sample_name: string
  original_filename: string
  image_url?: string
  image_object_key?: string
  label_type: LabelType
  total_weight_grams?: number
  items: Record<string, number>
  status: SampleStatus
  source_path?: string
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface DatasetSampleListResponse {
  items: DatasetSample[]
  page: number
  limit: number
  total: number
}

export interface DatasetFilter {
  batch_names?: string[]
  label_types?: LabelType[]
  statuses?: SampleStatus[]
  sample_ids?: string[]
}

export interface ModelConfig {
  vision?: string
  review?: string
  nutrition?: string
  edible?: string
  suggest?: string
  text?: string
}

export interface CreateRunInput {
  name?: string
  execution_mode: ExecutionMode
  dataset_filter: DatasetFilter
  model_config?: ModelConfig
  text_input?: string
}

export interface BenchmarkRun {
  id: string
  name: string
  status: RunStatus
  dataset_filter: Record<string, any>
  execution_mode: ExecutionMode
  model_config: Record<string, any>
  sample_count: number
  metrics: RunMetrics
  stage_outputs_summary: Record<string, any>
  error_message?: string
  started_at?: string
  completed_at?: string
  created_by?: string
  created_by_username?: string
  created_at: string
  updated_at: string
}

export interface RunMetrics {
  sample_count: number
  completed_count: number
  failed_count: number
  name_match_rate: number
  total_weight_mape: number
  total_weight_rmse: number
  item_weight_mape: number
  item_weight_rmse: number
  average_duration_ms: number
}

export interface ItemComparison {
  gt_name: string
  gt_weight: number
  pred_name?: string
  pred_weight?: number
  matched: boolean
  similarity: number
  weight_error?: number
  weight_error_pct?: number
  extra?: boolean
}

export interface SampleMetrics {
  name_matched: boolean
  name_match_details?: boolean[]
  total_weight_error?: number
  total_weight_error_pct?: number
  item_weight_errors?: number[]
  item_weight_error_pcts?: number[]
  item_comparisons?: ItemComparison[]
  duration_ms?: number
}

export interface BenchmarkRunSample {
  id: string
  run_id: string
  sample_id: string
  task_id?: string
  status: RunSampleStatus
  prediction: Record<string, any>
  ground_truth: Record<string, any>
  stage_outputs: Record<string, any>
  metrics: SampleMetrics
  error_message?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface BenchmarkRunListResponse {
  items: BenchmarkRun[]
  page: number
  limit: number
  total: number
}

export interface BenchmarkRunSampleListResponse {
  items: BenchmarkRunSample[]
  page: number
  limit: number
  total: number
}

export const labelTypeLabels: Record<LabelType, string> = {
  total: '总重',
  items: '分项',
  unlabeled: '未标注',
}

export const sampleStatusLabels: Record<SampleStatus, string> = {
  labeled: '已标注',
  unlabeled: '未标注',
}

export const runStatusLabels: Record<RunStatus, string> = {
  pending: '等待中',
  running: '运行中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}

export const runSampleStatusLabels: Record<RunSampleStatus, string> = {
  pending: '等待中',
  processing: '处理中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}

export const executionModeLabels: Record<ExecutionMode, string> = {
  fast: '快速',
  standard: '普通',
  strict: '精准',
  fast_web_search: '快速+搜索',
  standard_web_search: '普通+搜索',
  strict_web_search: '精准+搜索',
  gemini35_flash_grouped: 'Gemini 分组',
}

export const executionModeOptions: ExecutionMode[] = [
  'fast',
  'standard',
  'strict',
  'fast_web_search',
  'standard_web_search',
  'strict_web_search',
  'gemini35_flash_grouped',
]
