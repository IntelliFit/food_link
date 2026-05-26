export interface Scenario {
  id: string;
  name: string;
  desc: string;
  setup: ScenarioSetup;
  steps: Step[];
}

export interface ScenarioSetup {
  backend: BackendSetup;
  miniprogram: MiniprogramSetup;
}

export interface BackendSetup {
  suite: string;
  seed_sql?: string[];
}

export interface MiniprogramSetup {
  build_mode: 'development' | 'production';
  devtools_port: number;
}

export interface Step {
  action: string;
  name?: string;
  // evaluate
  script?: string;
  // relaunch / switchTab
  url?: string;
  // wait / wait_for
  ms?: number;
  interval?: number;
  // tap / assert_element
  selector?: string;
  // assert_element
  exists?: boolean;
  // screenshot
  path?: string;
  compare_with_baseline?: boolean;
  threshold?: number;
  // assert_evaluate
  expected?: any;
  // db_assert
  query?: string;
  args?: any[];
  // capture
  capture?: Record<string, string>;
  // sub assert block
  assert?: StepAssert;
}

export interface StepAssert {
  type: string;
  script?: string;
  selector?: string;
  exists?: boolean;
  expected?: any;
  query?: string;
  args?: any[];
}

export interface StepResult {
  stepIndex: number;
  action: string;
  name: string;
  success: boolean;
  durationMs: number;
  message?: string;
  screenshotPath?: string;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  durationMs: number;
  steps: StepResult[];
}

export interface MRCResult<T = any> {
  success: boolean;
  data: T;
  rawOutput: string;
  error?: string;
}

export interface BackendVars {
  [key: string]: string;
}

export interface BackendTokenResponse {
  token: string;
  token_type: string;
  user_id: string;
  openid: string;
  unionid: string;
}

// ─── Trace types ───────────────────────────────────────────────

export interface TraceFile {
  traces: Trace[];
}

export interface Trace {
  id: string;
  name: string;
  desc: string;
  steps: Step[];
}

export interface TraceResult {
  traceId: string;
  traceName: string;
  success: boolean;
  durationMs: number;
  steps: StepResult[];
  failedStepIndex?: number;
  failedStepMessage?: string;
}

export interface TraceReport {
  databaseName?: string;
  totalTraces: number;
  passedTraces: number;
  failedTraces: number;
  durationMs: number;
  traces: TraceResult[];
}
