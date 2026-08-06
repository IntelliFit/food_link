import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Building2,
  ChevronRight,
  ImageOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AdminSidebar, type AdminMenuId } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { adminRequest, adminUpload, displayApiBase } from "@/lib/api";

type CampusDirectoryPageProps = {
  onLogout: () => void;
  onMenuChange: (menu: AdminMenuId) => void;
};

type ListResponse<T> = { items: T[]; page: number; limit: number; total: number };
type EntityKind = "school" | "campus" | "canteen" | "window";
type ViewLevel = "campuses" | "canteens" | "windows" | "dishes";

type School = {
  id: string;
  name: string;
  location_type?: string;
  province?: string;
  city?: string;
  level?: string;
  is_985?: boolean;
  is_211?: boolean;
  status?: string;
};

type Campus = {
  id: string;
  school_id: string;
  name: string;
  address?: string;
  campus_type?: string;
  source_url?: string;
  status?: string;
  sort_order?: number;
};

type Canteen = {
  id: string;
  school_id: string;
  campus_id?: string | null;
  campus_name?: string;
  name: string;
  location_text?: string;
  building_or_floor?: string;
  service_type?: string;
  audience?: string;
  opening_hours_raw?: string;
  source_url?: string;
  source_org?: string;
  source_type?: string;
  confidence_level?: string;
  status?: string;
  review_note?: string;
  sort_order?: number;
};

type WindowItem = {
  id: string;
  school_id: string;
  campus_id?: string | null;
  canteen_id: string;
  name: string;
  floor?: string;
  source_url?: string;
  status?: string;
  sort_order?: number;
};

type CatalogItem = {
  id: string;
  batch_id: string;
  entry_type: string;
  name?: string;
  description?: string;
  window_id?: string;
  floor?: string;
  window_name?: string;
  window_layout?: string;
  service_mode: string;
  meal_periods?: string[];
  available_weekdays?: string[];
  availability_note?: string;
  price_type: string;
  price?: number;
  price_min?: number;
  price_max?: number;
  price_unit?: string;
  price_text?: string;
  price_options?: Record<string, unknown>;
  portion_description?: string;
  image_paths?: string[];
  image_kind: string;
  source_filename?: string;
  raw_text?: string;
  notes?: string;
  missing_fields?: string[];
  completeness_status: string;
  status: string;
  analysis_error?: string;
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fat?: number;
  client_status?: string;
};

type SchoolSummary = {
  school: School;
  counts: { campuses: number; canteens: number; windows: number; dishes: number };
};

type AnalysisProgress = {
  total: number;
  analyzable_total: number;
  completed: number;
  completed_percent: number;
  status_counts: Record<string, number>;
};

type EditorState = {
  mode: "create" | "edit";
  kind: EntityKind;
  id?: string;
  value: Record<string, unknown>;
};

type DishEditorState = {
  mode: "create" | "edit";
  item?: CatalogItem;
  value: Record<string, unknown>;
};

const inputClass =
  "min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const textareaClass = `${inputClass} min-h-24 resize-y`;

const STATUS_LABELS: Record<string, string> = {
  active: "已启用",
  pending_review: "待审核",
  inactive: "已停用",
  rejected: "已拒绝",
  draft: "草稿",
  changes_pending: "有更新待分析",
  analysis_pending: "AI 分析中",
  analysis_failed: "AI 分析失败",
  published: "已上线",
  deleted: "已删除",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  published: "bg-emerald-500/15 text-emerald-400",
  pending_review: "bg-amber-500/15 text-amber-300",
  changes_pending: "bg-amber-500/15 text-amber-300",
  analysis_pending: "bg-sky-500/15 text-sky-300",
  inactive: "bg-slate-500/20 text-slate-300",
  analysis_failed: "bg-red-500/15 text-red-300",
  rejected: "bg-red-500/15 text-red-300",
};

export function CampusDirectoryPage({ onLogout, onMenuChange }: CampusDirectoryPageProps) {
  const navigate = useNavigate();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolStatus, setSchoolStatus] = useState("active");
  const [schoolPage, setSchoolPage] = useState(1);
  const [schoolTotal, setSchoolTotal] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [summary, setSummary] = useState<SchoolSummary | null>(null);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);
  const [selectedCanteen, setSelectedCanteen] = useState<Canteen | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<WindowItem | null>(null);
  const [viewLevel, setViewLevel] = useState<ViewLevel>("campuses");
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [dishes, setDishes] = useState<CatalogItem[]>([]);
  const [dishTotal, setDishTotal] = useState(0);
  const [dishPage, setDishPage] = useState(1);
  const [dishQuery, setDishQuery] = useState("");
  const [dishStatus, setDishStatus] = useState("all");
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dishEditor, setDishEditor] = useState<DishEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([]);
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const [dishImageUploading, setDishImageUploading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [loadingAnalysisProgress, setLoadingAnalysisProgress] = useState(false);

  const apiBase = displayApiBase();
  const schoolPages = Math.max(1, Math.ceil(schoolTotal / 40));
  const dishPages = Math.max(1, Math.ceil(dishTotal / 50));

  const loadSchools = useCallback(async (page = schoolPage) => {
    setLoadingSchools(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "40",
        q: schoolQuery.trim(),
        status: schoolStatus,
      });
      const result = await adminRequest<ListResponse<School>>(
        `/api/admin/campus-directory/schools?${params.toString()}`,
      );
      setSchools(result.items || []);
      setSchoolTotal(result.total || 0);
      setSchoolPage(result.page || page);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoadingSchools(false);
    }
  }, [schoolPage, schoolQuery, schoolStatus]);

  const loadSummary = useCallback(async (schoolId: string) => {
    const result = await adminRequest<SchoolSummary>(
      `/api/admin/campus-directory/schools/${encodeURIComponent(schoolId)}/summary`,
    );
    setSummary(result);
    setSelectedSchool(result.school);
  }, []);

  const loadCampuses = useCallback(async (schoolId: string) => {
    const params = new URLSearchParams({ school_id: schoolId, status: "all", limit: "100" });
    const result = await adminRequest<ListResponse<Campus>>(
      `/api/admin/campus-directory/campuses?${params.toString()}`,
    );
    setCampuses(result.items || []);
  }, []);

  const loadCanteens = useCallback(async (schoolId: string, campusId: string) => {
    const params = new URLSearchParams({ school_id: schoolId, campus_id: campusId, status: "all", limit: "100" });
    const result = await adminRequest<ListResponse<Canteen>>(
      `/api/admin/campus-directory/canteens?${params.toString()}`,
    );
    setCanteens(result.items || []);
  }, []);

  const loadWindows = useCallback(async (canteenId: string) => {
    const params = new URLSearchParams({ canteen_id: canteenId, status: "all", limit: "100" });
    const result = await adminRequest<ListResponse<WindowItem>>(
      `/api/admin/campus-directory/windows?${params.toString()}`,
    );
    setWindows(result.items || []);
  }, []);

  const loadDishes = useCallback(async (
    schoolId: string,
    canteenId: string,
    windowId: string | undefined,
    page = dishPage,
  ) => {
    const params = new URLSearchParams({
      school_id: schoolId,
      canteen_id: canteenId,
      page: String(page),
      limit: "50",
      status: dishStatus,
      q: dishQuery.trim(),
    });
    if (windowId) params.set("window_id", windowId);
    const result = await adminRequest<ListResponse<CatalogItem>>(
      `/api/admin/campus-food-collection/items?${params.toString()}`,
    );
    setDishes(result.items || []);
    setDishTotal(result.total || 0);
    setDishPage(result.page || page);
    setSelectedDishIds([]);
  }, [dishPage, dishQuery, dishStatus]);

  const loadAnalysisProgress = useCallback(async (silent = false) => {
    if (!silent) setLoadingAnalysisProgress(true);
    try {
      const result = await adminRequest<AnalysisProgress>("/api/admin/campus-food-collection/analysis-progress");
      setAnalysisProgress(result);
    } catch (error) {
      if (!silent) toast.error(errorMessage(error));
    } finally {
      if (!silent) setLoadingAnalysisProgress(false);
    }
  }, []);

  useEffect(() => {
    void loadSchools(1);
  }, [schoolStatus]);

  useEffect(() => {
    void loadAnalysisProgress();
  }, [loadAnalysisProgress]);

  useEffect(() => {
    if (!analysisProgress?.status_counts.analysis_pending) return;
    const timer = window.setInterval(() => void loadAnalysisProgress(true), 5000);
    return () => window.clearInterval(timer);
  }, [analysisProgress?.status_counts.analysis_pending, loadAnalysisProgress]);

  async function runContent(task: () => Promise<void>) {
    setLoadingContent(true);
    try {
      await task();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoadingContent(false);
    }
  }

  async function openSchool(school: School) {
    setSelectedSchool(school);
    setSelectedCampus(null);
    setSelectedCanteen(null);
    setSelectedWindow(null);
    setViewLevel("campuses");
    setSummary(null);
    await runContent(async () => {
      await Promise.all([loadSummary(school.id), loadCampuses(school.id)]);
    });
  }

  async function openCampus(campus: Campus) {
    if (!selectedSchool) return;
    setSelectedCampus(campus);
    setSelectedCanteen(null);
    setSelectedWindow(null);
    setViewLevel("canteens");
    await runContent(() => loadCanteens(selectedSchool.id, campus.id));
  }

  async function openCanteen(canteen: Canteen) {
    setSelectedCanteen(canteen);
    setSelectedWindow(null);
    setViewLevel("windows");
    await runContent(() => loadWindows(canteen.id));
  }

  async function openDishes(windowItem?: WindowItem) {
    if (!selectedSchool || !selectedCanteen) return;
    setSelectedWindow(windowItem || null);
    setViewLevel("dishes");
    setDishPage(1);
    await runContent(() => loadDishes(selectedSchool.id, selectedCanteen.id, windowItem?.id, 1));
  }

  async function refreshCurrent() {
    if (!selectedSchool) {
      await loadSchools();
      return;
    }
    await runContent(async () => {
      await loadSummary(selectedSchool.id);
      if (viewLevel === "campuses") await loadCampuses(selectedSchool.id);
      if (viewLevel === "canteens" && selectedCampus) await loadCanteens(selectedSchool.id, selectedCampus.id);
      if (viewLevel === "windows" && selectedCanteen) await loadWindows(selectedCanteen.id);
      if (viewLevel === "dishes" && selectedCanteen) {
        await loadDishes(selectedSchool.id, selectedCanteen.id, selectedWindow?.id, dishPage);
      }
    });
  }

  function goTo(level: ViewLevel) {
    if (level === "campuses") {
      setSelectedCampus(null);
      setSelectedCanteen(null);
      setSelectedWindow(null);
    } else if (level === "canteens") {
      setSelectedCanteen(null);
      setSelectedWindow(null);
    } else if (level === "windows") {
      setSelectedWindow(null);
    }
    setViewLevel(level);
  }

  function openCreate(kind: EntityKind) {
    setEditor({ mode: "create", kind, value: blankEntity(kind, selectedSchool, selectedCampus, selectedCanteen) });
  }

  function openEdit(kind: EntityKind, item: School | Campus | Canteen | WindowItem) {
    setEditor({ mode: "edit", kind, id: item.id, value: normalizeRecord(item) });
  }

  async function saveEntity(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const endpoint = entityEndpoint(editor.kind, editor.id);
    setSaving(true);
    try {
      await adminRequest(endpoint, {
        method: editor.mode === "create" ? "POST" : "PATCH",
        body: JSON.stringify(entityPayload(editor.kind, editor.value)),
      });
      toast.success(editor.mode === "create" ? "创建成功" : "保存成功");
      setEditor(null);
      await refreshCurrent();
      if (editor.kind === "school") await loadSchools();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntity(kind: EntityKind, id: string, name: string) {
    if (!window.confirm(`确认删除“${name}”？删除后不会在正常目录中显示。`)) return;
    try {
      await adminRequest(entityEndpoint(kind, id), { method: "DELETE" });
      toast.success("已删除");
      setEditor(null);
      if (kind === "school") {
        setSelectedSchool(null);
        setSummary(null);
        await loadSchools();
      } else if (kind === "campus" && selectedSchool) {
        setSelectedCampus(null);
        setSelectedCanteen(null);
        setSelectedWindow(null);
        setViewLevel("campuses");
        await Promise.all([loadSummary(selectedSchool.id), loadCampuses(selectedSchool.id)]);
      } else if (kind === "canteen" && selectedSchool && selectedCampus) {
        setSelectedCanteen(null);
        setSelectedWindow(null);
        setViewLevel("canteens");
        await Promise.all([loadSummary(selectedSchool.id), loadCanteens(selectedSchool.id, selectedCampus.id)]);
      } else if (kind === "window" && selectedSchool && selectedCanteen) {
        setSelectedWindow(null);
        setViewLevel("windows");
        await Promise.all([loadSummary(selectedSchool.id), loadWindows(selectedCanteen.id)]);
      } else {
        await refreshCurrent();
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function openDishEdit(item: CatalogItem) {
    setDishEditor({ mode: "edit", item, value: dishDraft(item) });
  }

  function openDishCreate() {
    setDishEditor({ mode: "create", value: dishDraft() });
  }

  async function saveDish(event: FormEvent) {
    event.preventDefault();
    if (!dishEditor || !selectedSchool || !selectedCanteen) return;
    setSaving(true);
    try {
      if (dishEditor.mode === "edit" && dishEditor.item) {
        await adminRequest(`/api/admin/campus-food-collection/items/${encodeURIComponent(dishEditor.item.id)}`, {
          method: "PATCH",
          body: JSON.stringify(catalogItemPayload(dishEditor.item, dishEditor.value, selectedWindow)),
        });
      } else {
        const value = dishEditor.value;
        await adminRequest("/api/admin/campus-food-collection/batches", {
          method: "POST",
          body: JSON.stringify({
            client_batch_key: `admin-hierarchy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            batch_name: `管理端新增-${String(value.name || "菜品")}`,
            venue_type: "university",
            school_id: selectedSchool.id,
            campus_id: selectedCampus?.id || undefined,
            canteen_id: selectedCanteen.id,
            default_window_id: selectedWindow?.id || undefined,
            organization_name: selectedSchool.name,
            area_name: selectedCampus?.name || "",
            canteen_name: selectedCanteen.name,
            default_floor: selectedWindow?.floor || selectedCanteen.building_or_floor || "",
            default_window_name: selectedWindow?.name || "",
            default_window_layout: "unknown",
            default_service_mode: "unknown",
            default_meal_periods: ["unknown"],
            collector_name: "管理端逐级新增",
            source_note: "校园食堂层级管理页新增",
            entries: [catalogItemPayload(undefined, value, selectedWindow)],
          }),
        });
      }
      toast.success(dishEditor.mode === "create" ? "菜品已创建为草稿" : "菜品已保存");
      setDishEditor(null);
      await refreshCurrent();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function uploadDishImages(files: FileList | null) {
    if (!dishEditor || !files?.length) return;
    setDishImageUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const formData = new FormData();
        formData.append("file", file);
        const result = await adminUpload<{ image_url: string }>("/api/admin/campus-food-collection/images", formData);
        uploaded.push(result.image_url);
      }
      const current = Array.isArray(dishEditor.value.image_paths) ? dishEditor.value.image_paths as string[] : [];
      setDishEditor({ ...dishEditor, value: { ...dishEditor.value, image_paths: [...current, ...uploaded].slice(0, 6) } });
      toast.success(`已上传 ${uploaded.length} 张图片`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDishImageUploading(false);
    }
  }

  async function deleteDish(item: CatalogItem) {
    if (!window.confirm(`确认删除菜品“${item.name || "未命名菜品"}”？`)) return;
    try {
      await adminRequest(`/api/admin/campus-food-collection/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      toast.success("菜品已删除");
      await refreshCurrent();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function publishItems(items: CatalogItem[]) {
    const publishable = items.filter(isPublishable);
    if (!publishable.length) return;
    setPublishingIds(publishable.map((item) => item.id));
    const failed: string[] = [];
    await runWithConcurrency(publishable, 3, async (item) => {
      try {
        await adminRequest(`/api/admin/campus-food-collection/items/${encodeURIComponent(item.id)}/publish`, { method: "POST" });
      } catch {
        failed.push(item.id);
      }
    });
    setPublishingIds([]);
    setSelectedDishIds(failed);
    toast[failed.length ? "error" : "success"](
      failed.length ? `${publishable.length - failed.length} 条已提交，${failed.length} 条失败` : `${publishable.length} 条已提交 AI 分析`,
    );
    await Promise.all([refreshCurrent(), loadAnalysisProgress(true)]);
  }

  const selectedPublishableDishes = useMemo(() => {
    const ids = new Set(selectedDishIds);
    return dishes.filter((item) => ids.has(item.id) && isPublishable(item));
  }, [dishes, selectedDishIds]);

  const hasPendingAnalysis = dishes.some((item) => item.status === "analysis_pending");
  useEffect(() => {
    if (viewLevel !== "dishes" || !hasPendingAnalysis || !selectedSchool || !selectedCanteen) return;
    const timer = window.setInterval(() => {
      void loadDishes(selectedSchool.id, selectedCanteen.id, selectedWindow?.id, dishPage);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [dishPage, hasPendingAnalysis, loadDishes, selectedCanteen, selectedSchool, selectedWindow, viewLevel]);

  return (
    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1640px] grid-cols-[256px_minmax(0,1fr)] gap-8 px-4 py-4">
      <AdminSidebar activeMenu="campus-directory" onLogout={onLogout} onMenuChange={onMenuChange} />
      <main className="min-w-0">
        <section className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card/90 p-6">
          <div>
            <p className="text-sm text-muted-foreground">API：{apiBase}</p>
            <h1 className="mt-1 text-3xl font-semibold">校园食堂</h1>
            <p className="mt-2 text-sm text-muted-foreground">按学校逐级管理校区、食堂、窗口与菜品。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/campus-directory/governance")}>审核与来源</Button>
            <Button variant="outline" onClick={() => navigate("/campus-food-collection")}>进入食堂采集</Button>
          </div>
        </section>

        <AnalysisProgressPanel progress={analysisProgress} loading={loadingAnalysisProgress} onRefresh={() => void loadAnalysisProgress()} />

        <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-2xl border bg-card/90 p-4">
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void loadSchools(1); }}>
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <input className={`${inputClass} pl-9`} value={schoolQuery} onChange={(event) => setSchoolQuery(event.target.value)} placeholder="搜索学校、城市或省份" />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select className={inputClass} value={schoolStatus} onChange={(event) => setSchoolStatus(event.target.value)}>
                  <option value="active">已启用</option>
                  <option value="pending_review">待审核</option>
                  <option value="inactive">已停用</option>
                  <option value="all">全部状态</option>
                </select>
                <Button type="submit" variant="outline" disabled={loadingSchools} aria-label="筛选学校">
                  {loadingSchools ? <Loader2 className="size-4 animate-spin" /> : "筛选"}
                </Button>
              </div>
            </form>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">共 {schoolTotal} 所</span>
              <Button size="sm" onClick={() => openCreate("school")}><Plus className="size-4" />新建学校</Button>
            </div>

            <div className="mt-3 max-h-[64vh] space-y-2 overflow-y-auto pr-1">
              {schools.map((school) => (
                <button key={school.id} type="button" onClick={() => void openSchool(school)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedSchool?.id === school.id ? "border-primary bg-primary/10" : "hover:bg-accent"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <strong className="min-w-0 text-sm">{school.name}</strong>
                    <StatusBadge status={school.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{[school.province, school.city, school.is_985 ? "985" : "", school.is_211 ? "211" : ""].filter(Boolean).join(" · ") || "地区待补充"}</p>
                </button>
              ))}
              {!loadingSchools && schools.length === 0 ? <EmptyState text="没有符合条件的学校" /> : null}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <Button variant="outline" size="sm" disabled={schoolPage <= 1 || loadingSchools} onClick={() => void loadSchools(schoolPage - 1)}>上一页</Button>
              <span>{schoolPage} / {schoolPages}</span>
              <Button variant="outline" size="sm" disabled={schoolPage >= schoolPages || loadingSchools} onClick={() => void loadSchools(schoolPage + 1)}>下一页</Button>
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border bg-card/90 p-5">
            {!selectedSchool ? (
              <div className="flex min-h-[65vh] items-center justify-center text-center">
                <div>
                  <Building2 className="mx-auto size-10 text-muted-foreground" />
                  <h2 className="mt-4 text-lg font-semibold">先选择一所学校</h2>
                  <p className="mt-2 text-sm text-muted-foreground">右侧会显示该学校完整的数据层级和数量。</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-semibold">{selectedSchool.name}</h2>
                      <StatusBadge status={selectedSchool.status} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{[selectedSchool.province, selectedSchool.city, selectedSchool.level].filter(Boolean).join(" · ") || "地区和层级待补充"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void refreshCurrent()} disabled={loadingContent}><RefreshCw className={`size-4 ${loadingContent ? "animate-spin" : ""}`} />刷新</Button>
                    <Button size="sm" onClick={() => openEdit("school", selectedSchool)}><Save className="size-4" />编辑学校</Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard label="学校" value="1" />
                  <StatCard label="校区" value={String(summary?.counts.campuses ?? "-")} />
                  <StatCard label="食堂" value={String(summary?.counts.canteens ?? "-")} />
                  <StatCard label="窗口" value={String(summary?.counts.windows ?? "-")} />
                  <StatCard label="菜品" value={String(summary?.counts.dishes ?? "-")} />
                </div>

                <Breadcrumbs school={selectedSchool} campus={selectedCampus} canteen={selectedCanteen} windowItem={selectedWindow} viewLevel={viewLevel} onGo={goTo} />

                <div className="mt-5">
                  {loadingContent ? (
                    <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-7 animate-spin text-primary" /></div>
                  ) : viewLevel === "campuses" ? (
                    <EntityList title="校区" subtitle="点击校区进入该校区的食堂" onCreate={() => openCreate("campus")}>
                      {campuses.map((campus) => <HierarchyCard key={campus.id} title={campus.name} meta={[campus.address, campus.campus_type].filter(Boolean).join(" · ")} status={campus.status} onOpen={() => void openCampus(campus)} onEdit={() => openEdit("campus", campus)} />)}
                      {!campuses.length ? <EmptyState text="该学校还没有校区" /> : null}
                    </EntityList>
                  ) : viewLevel === "canteens" ? (
                    <EntityList title="食堂" subtitle={`当前校区：${selectedCampus?.name || "-"}`} onCreate={() => openCreate("canteen")}>
                      {canteens.map((canteen) => <HierarchyCard key={canteen.id} title={canteen.name} meta={[canteen.location_text, canteen.building_or_floor].filter(Boolean).join(" · ")} status={canteen.status} onOpen={() => void openCanteen(canteen)} onEdit={() => openEdit("canteen", canteen)} />)}
                      {!canteens.length ? <EmptyState text="该校区还没有食堂" /> : null}
                    </EntityList>
                  ) : viewLevel === "windows" ? (
                    <EntityList title="窗口" subtitle={`当前食堂：${selectedCanteen?.name || "-"}`} onCreate={() => openCreate("window")} extra={<Button variant="outline" onClick={() => void openDishes()}>查看该食堂全部菜品</Button>}>
                      {windows.map((windowItem) => <HierarchyCard key={windowItem.id} title={windowItem.name} meta={windowItem.floor || "楼层待补充"} status={windowItem.status} onOpen={() => void openDishes(windowItem)} onEdit={() => openEdit("window", windowItem)} />)}
                      {!windows.length ? <EmptyState text="该食堂还没有窗口，可先查看全部菜品或新建窗口" /> : null}
                    </EntityList>
                  ) : (
                    <DishList
                      dishes={dishes}
                      total={dishTotal}
                      page={dishPage}
                      pages={dishPages}
                      query={dishQuery}
                      status={dishStatus}
                      selectedIds={selectedDishIds}
                      publishingIds={publishingIds}
                      selectedPublishableCount={selectedPublishableDishes.length}
                      scopeName={selectedWindow?.name || `${selectedCanteen?.name || "食堂"}全部菜品`}
                      onQuery={setDishQuery}
                      onStatus={setDishStatus}
                      onSearch={() => selectedSchool && selectedCanteen && void runContent(() => loadDishes(selectedSchool.id, selectedCanteen.id, selectedWindow?.id, 1))}
                      onPage={(page) => selectedSchool && selectedCanteen && void runContent(() => loadDishes(selectedSchool.id, selectedCanteen.id, selectedWindow?.id, page))}
                      onCreate={openDishCreate}
                      onEdit={openDishEdit}
                      onDelete={(item) => void deleteDish(item)}
                      onPublish={(item) => void publishItems([item])}
                      onPublishSelected={() => void publishItems(selectedPublishableDishes)}
                      onToggle={(item) => setSelectedDishIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                      onToggleAll={() => {
                        const ids = dishes.filter(isPublishable).map((item) => item.id);
                        setSelectedDishIds(ids.length && ids.every((id) => selectedDishIds.includes(id)) ? [] : ids);
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </section>
      </main>

      {editor ? <EntityDialog editor={editor} saving={saving} onChange={(value) => setEditor({ ...editor, value })} onClose={() => setEditor(null)} onSave={saveEntity} onDelete={editor.mode === "edit" && editor.id ? () => void deleteEntity(editor.kind, editor.id!, String(editor.value.name || "未命名")) : undefined} /> : null}
      {dishEditor ? <DishDialog editor={dishEditor} saving={saving} uploading={dishImageUploading} onUpload={(files) => void uploadDishImages(files)} onChange={(value) => setDishEditor({ ...dishEditor, value })} onClose={() => setDishEditor(null)} onSave={saveDish} /> : null}
    </div>
  );
}

function AnalysisProgressPanel({ progress, loading, onRefresh }: { progress: AnalysisProgress | null; loading: boolean; onRefresh: () => void }) {
  const counts = progress?.status_counts || {};
  const percent = Math.max(0, Math.min(100, progress?.completed_percent || 0));
  const metrics = [
    { label: "已上线", value: counts.published || 0, className: "text-emerald-400" },
    { label: "AI 分析中", value: counts.analysis_pending || 0, className: "text-sky-300" },
    { label: "分析失败", value: counts.analysis_failed || 0, className: "text-red-300" },
    { label: "待补字段", value: counts.draft || 0, className: "text-amber-300" },
  ];
  return <section className="mb-5 rounded-2xl border bg-card/90 p-5" aria-label="校园菜品 AI 分析进度">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /><h2 className="text-lg font-semibold">校园菜品 AI 分析进度</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">分析成功后自动上线；失败和分析中的版本不会覆盖客户端已有可用数据。</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}刷新</Button>
    </div>
    {progress ? <>
      <div className="mt-5 flex items-end justify-between gap-3"><div><strong className="text-2xl">{percent.toFixed(1)}%</strong><span className="ml-2 text-sm text-muted-foreground">{progress.completed} / {progress.analyzable_total} 条已完成</span></div><span className="text-xs text-muted-foreground">目录共 {progress.total} 条</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <div key={metric.label} className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{metric.label}</p><p className={`mt-1 text-xl font-semibold ${metric.className}`}>{metric.value}</p></div>)}</div>
      {(counts.analysis_pending || 0) > 0 ? <p className="mt-3 text-xs text-sky-300">后台正在持续处理，页面每 5 秒自动更新。</p> : null}
    </> : <div className="mt-5 grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-muted/50" />)}</div>}
  </section>;
}

function Breadcrumbs({ school, campus, canteen, windowItem, viewLevel, onGo }: { school: School; campus: Campus | null; canteen: Canteen | null; windowItem: WindowItem | null; viewLevel: ViewLevel; onGo: (level: ViewLevel) => void }) {
  return <nav className="mt-5 flex flex-wrap items-center gap-1 border-y py-3 text-sm" aria-label="校园食堂层级">
    <button type="button" className="rounded px-2 py-1 font-medium hover:bg-accent" onClick={() => onGo("campuses")}>{school.name}</button>
    {campus ? <><ChevronRight className="size-4 text-muted-foreground" /><button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => onGo("canteens")}>{campus.name}</button></> : null}
    {canteen ? <><ChevronRight className="size-4 text-muted-foreground" /><button type="button" className="rounded px-2 py-1 hover:bg-accent" onClick={() => onGo("windows")}>{canteen.name}</button></> : null}
    {viewLevel === "dishes" ? <><ChevronRight className="size-4 text-muted-foreground" /><span className="rounded bg-primary/10 px-2 py-1 text-primary">{windowItem?.name || "全部菜品"}</span></> : null}
  </nav>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-1 block text-xl">{value}</strong></div>;
}

function StatusBadge({ status }: { status?: string }) {
  const normalized = status || "draft";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${STATUS_STYLES[normalized] || "bg-muted text-muted-foreground"}`}>{STATUS_LABELS[normalized] || normalized}</span>;
}

function ClientBadge({ status }: { status: string }) {
  const published = status === "published";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${published ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/20 text-slate-300"}`}>{published ? "客户端已上线" : "客户端未上线"}</span>;
}

function EntityList({ title, subtitle, onCreate, extra, children }: { title: string; subtitle: string; onCreate: () => void; extra?: ReactNode; children: ReactNode }) {
  return <section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div>
      <div className="flex gap-2">{extra}<Button onClick={onCreate}><Plus className="size-4" />新建{title}</Button></div>
    </div>
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{children}</div>
  </section>;
}

function HierarchyCard({ title, meta, status, onOpen, onEdit }: { title: string; meta: string; status?: string; onOpen: () => void; onEdit: () => void }) {
  return <article className="group rounded-xl border p-4 transition-colors hover:border-primary/60">
    <div className="flex items-start justify-between gap-3"><strong className="min-w-0">{title}</strong><StatusBadge status={status} /></div>
    <p className="mt-2 min-h-5 text-sm text-muted-foreground">{meta || "信息待补充"}</p>
    <div className="mt-4 flex gap-2"><Button className="flex-1" variant="outline" onClick={onOpen}>进入下一级<ChevronRight className="size-4" /></Button><Button variant="ghost" onClick={onEdit}>编辑</Button></div>
  </article>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="col-span-full rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function DishList(props: {
  dishes: CatalogItem[]; total: number; page: number; pages: number; query: string; status: string;
  selectedIds: string[]; publishingIds: string[]; selectedPublishableCount: number; scopeName: string;
  onQuery: (value: string) => void; onStatus: (value: string) => void; onSearch: () => void; onPage: (page: number) => void;
  onCreate: () => void; onEdit: (item: CatalogItem) => void; onDelete: (item: CatalogItem) => void; onPublish: (item: CatalogItem) => void;
  onPublishSelected: () => void; onToggle: (item: CatalogItem) => void; onToggleAll: () => void;
}) {
  const allSelected = props.dishes.filter(isPublishable).length > 0 && props.dishes.filter(isPublishable).every((item) => props.selectedIds.includes(item.id));
  return <section>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">菜品</h3><p className="mt-1 text-sm text-muted-foreground">{props.scopeName} · 共 {props.total} 条</p></div>
      <Button onClick={props.onCreate}><Plus className="size-4" />新建菜品草稿</Button>
    </div>
    <form className="mt-4 grid gap-2 md:grid-cols-[1fr_180px_auto]" onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}>
      <input className={inputClass} value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="搜索菜名、原始文字或窗口" />
      <select className={inputClass} value={props.status} onChange={(event) => props.onStatus(event.target.value)}>
        <option value="all">全部状态</option><option value="draft">草稿</option><option value="changes_pending">有更新待分析</option><option value="analysis_pending">AI 分析中</option><option value="analysis_failed">AI 分析失败</option><option value="published">已上线</option>
      </select>
      <Button type="submit" variant="outline">筛选</Button>
    </form>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allSelected} onChange={props.onToggleAll} />全选可分析菜品</label>
      <Button disabled={!props.selectedPublishableCount || props.publishingIds.length > 0} onClick={props.onPublishSelected}><Sparkles className="size-4" />批量提交 AI 分析并上线（{props.selectedPublishableCount}）</Button>
    </div>
    <div className="mt-4 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="bg-muted/30 text-left text-muted-foreground"><tr><th className="p-3">选择</th><th className="p-3">图片</th><th className="p-3">菜品</th><th className="p-3">价格</th><th className="p-3">分量</th><th className="p-3">营养</th><th className="p-3">AI / 客户端</th><th className="p-3">操作</th></tr></thead>
        <tbody>{props.dishes.map((item) => {
          const publishing = props.publishingIds.includes(item.id);
          return <tr key={item.id} className="border-t align-top">
            <td className="p-3"><input type="checkbox" checked={props.selectedIds.includes(item.id)} disabled={!isPublishable(item) || props.publishingIds.length > 0} onChange={() => props.onToggle(item)} /></td>
            <td className="p-3">{item.image_paths?.[0] ? <img className="size-16 rounded-lg object-cover" src={item.image_paths[0]} alt={item.name || "菜品图片"} /> : <div><div className="flex size-16 items-center justify-center rounded-lg bg-muted"><ImageOff className="size-5 text-muted-foreground" /></div><p className="mt-1 text-xs text-amber-300">待用户补图</p></div>}</td>
            <td className="p-3"><strong>{item.name || "未命名菜品"}</strong><p className="mt-1 max-w-56 text-xs text-muted-foreground">{[item.window_name, item.floor].filter(Boolean).join(" · ") || "窗口待关联"}</p></td>
            <td className="p-3">{formatPrice(item)}</td>
            <td className="p-3">{item.portion_description || "待补充"}</td>
            <td className="p-3 text-xs leading-6">{item.total_calories != null ? <><div>{formatNumber(item.total_calories)} kcal</div><div className="text-muted-foreground">蛋白 {formatNumber(item.total_protein)}g · 碳水 {formatNumber(item.total_carbs)}g · 脂肪 {formatNumber(item.total_fat)}g</div></> : <span className="text-muted-foreground">营养待分析</span>}</td>
            <td className="p-3"><StatusBadge status={item.status} /><div className="mt-2"><ClientBadge status={item.client_status || (item.status === "published" ? "published" : "")} /></div>{item.analysis_error ? <p className="mt-2 max-w-52 text-xs text-red-300" title={item.analysis_error}>{shortText(item.analysis_error, 52)}</p> : null}</td>
            <td className="p-3"><div className="flex max-w-44 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => props.onEdit(item)} disabled={item.status === "analysis_pending"}>编辑</Button><Button size="sm" onClick={() => props.onPublish(item)} disabled={!isPublishable(item) || publishing}>{publishing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{item.status === "analysis_failed" ? "重试" : "分析上线"}</Button><Button size="sm" variant="ghost" className="text-red-400" onClick={() => props.onDelete(item)} disabled={item.status === "analysis_pending"}><Trash2 className="size-4" /></Button></div></td>
          </tr>;
        })}</tbody>
      </table>
      {!props.dishes.length ? <EmptyState text="当前范围还没有菜品" /> : null}
    </div>
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground"><Button variant="outline" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>上一页</Button><span>{props.page} / {props.pages}</span><Button variant="outline" disabled={props.page >= props.pages} onClick={() => props.onPage(props.page + 1)}>下一页</Button></div>
  </section>;
}

function EntityDialog({ editor, saving, onChange, onClose, onSave, onDelete }: { editor: EditorState; saving: boolean; onChange: (value: Record<string, unknown>) => void; onClose: () => void; onSave: (event: FormEvent) => void; onDelete?: () => void }) {
  return <Dialog title={`${editor.mode === "create" ? "新建" : "编辑"}${entityLabel(editor.kind)}`} onClose={onClose}>
    <form onSubmit={onSave} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">{entityFields(editor.kind).map((field) => <Field key={field.key} field={field} value={editor.value[field.key]} onChange={(value) => onChange({ ...editor.value, [field.key]: value })} />)}</div>
      <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><div>{onDelete ? <Button type="button" variant="destructive" onClick={onDelete}><Trash2 className="size-4" />删除</Button> : null}</div><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存</Button></div></div>
    </form>
  </Dialog>;
}

function DishDialog({ editor, saving, uploading, onUpload, onChange, onClose, onSave }: { editor: DishEditorState; saving: boolean; uploading: boolean; onUpload: (files: FileList | null) => void; onChange: (value: Record<string, unknown>) => void; onClose: () => void; onSave: (event: FormEvent) => void }) {
  const field = (key: string, label: string, type: "text" | "number" | "textarea" = "text") => <Field field={{ key, label, type, wide: type === "textarea" }} value={editor.value[key]} onChange={(value) => onChange({ ...editor.value, [key]: value })} />;
  const images = Array.isArray(editor.value.image_paths) ? editor.value.image_paths as string[] : [];
  return <Dialog title={editor.mode === "create" ? "新建菜品草稿" : "编辑菜品"} onClose={onClose}>
    <form onSubmit={onSave} className="space-y-4"><div className="grid gap-3 md:grid-cols-2">{field("name", "菜品名称")}{field("entry_type", "条目类型")}{field("price", "价格", "number")}{field("price_unit", "价格单位")}{field("price_text", "价格原文")}{field("portion_description", "分量")}{field("description", "描述", "textarea")}{field("raw_text", "原始文字", "textarea")}{field("notes", "备注", "textarea")}<div className="grid gap-2 md:col-span-2"><span className="text-xs font-medium text-muted-foreground">菜品图片（最多 6 张）</span><div className="flex flex-wrap gap-2">{images.map((url, index) => <div key={`${url}-${index}`} className="relative"><img src={url} alt={`菜品图片 ${index + 1}`} className="size-20 rounded-lg object-cover" /><button type="button" className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white" aria-label="删除图片" onClick={() => onChange({ ...editor.value, image_paths: images.filter((_, current) => current !== index) })}><X className="size-3" /></button></div>)}</div><label className="flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent">{uploading ? <Loader2 className="size-4 animate-spin" /> : "选择图片上传"}<input className="sr-only" type="file" accept="image/*" multiple disabled={uploading || images.length >= 6} onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }} /></label></div></div><div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={saving || uploading}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存</Button></div></form>
  </Dialog>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭"><X className="size-5" /></Button></div>{children}</div></div>;
}

type FieldSpec = { key: string; label: string; type?: "text" | "number" | "boolean" | "textarea" | "status"; wide?: boolean; readOnly?: boolean };
function Field({ field, value, onChange }: { field: FieldSpec; value: unknown; onChange: (value: unknown) => void }) {
  return <label className={`grid gap-1 ${field.wide ? "md:col-span-2" : ""}`}><span className="text-xs font-medium text-muted-foreground">{field.label}</span>{field.type === "textarea" ? <textarea className={textareaClass} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /> : field.type === "boolean" ? <select className={inputClass} value={value ? "true" : "false"} onChange={(event) => onChange(event.target.value === "true")}><option value="true">是</option><option value="false">否</option></select> : field.type === "status" ? <select className={inputClass} value={String(value || "active")} onChange={(event) => onChange(event.target.value)}><option value="active">已启用</option><option value="pending_review">待审核</option><option value="inactive">已停用</option><option value="rejected">已拒绝</option></select> : <input className={`${inputClass} ${field.readOnly ? "cursor-not-allowed opacity-60" : ""}`} readOnly={field.readOnly} type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />}</label>;
}

function entityFields(kind: EntityKind): FieldSpec[] {
  if (kind === "school") return [{ key: "name", label: "学校名称", wide: true }, { key: "province", label: "省份" }, { key: "city", label: "城市" }, { key: "level", label: "层级" }, { key: "location_type", label: "类型" }, { key: "status", label: "状态", type: "status" }, { key: "is_985", label: "985", type: "boolean" }, { key: "is_211", label: "211", type: "boolean" }];
  if (kind === "campus") return [{ key: "school_id", label: "所属学校 ID", wide: true, readOnly: true }, { key: "name", label: "校区名称" }, { key: "status", label: "状态", type: "status" }, { key: "address", label: "地址", wide: true }, { key: "campus_type", label: "校区类型" }, { key: "sort_order", label: "排序", type: "number" }, { key: "source_url", label: "证据 URL", wide: true }];
  if (kind === "canteen") return [{ key: "school_id", label: "所属学校 ID", wide: true, readOnly: true }, { key: "campus_id", label: "所属校区 ID", wide: true, readOnly: true }, { key: "name", label: "食堂名称" }, { key: "status", label: "状态", type: "status" }, { key: "location_text", label: "位置", wide: true }, { key: "building_or_floor", label: "楼栋/楼层" }, { key: "service_type", label: "服务类型" }, { key: "opening_hours_raw", label: "营业时间", type: "textarea", wide: true }, { key: "source_url", label: "证据 URL", wide: true }, { key: "review_note", label: "审核备注", type: "textarea", wide: true }];
  return [{ key: "school_id", label: "所属学校 ID", wide: true, readOnly: true }, { key: "campus_id", label: "所属校区 ID", wide: true, readOnly: true }, { key: "canteen_id", label: "所属食堂 ID", wide: true, readOnly: true }, { key: "name", label: "窗口名称" }, { key: "status", label: "状态", type: "status" }, { key: "floor", label: "楼层" }, { key: "sort_order", label: "排序", type: "number" }, { key: "source_url", label: "证据 URL", wide: true }];
}

function blankEntity(kind: EntityKind, school: School | null, campus: Campus | null, canteen: Canteen | null): Record<string, unknown> {
  if (kind === "school") return { name: "", location_type: "university", province: "", city: "", level: "", is_985: false, is_211: false, status: "active" };
  if (kind === "campus") return { school_id: school?.id || "", name: "", address: "", campus_type: "", source_url: "", status: "pending_review", sort_order: 0 };
  if (kind === "canteen") return { school_id: school?.id || "", campus_id: campus?.id || "", name: "", location_text: "", building_or_floor: "", service_type: "", opening_hours_raw: "", source_url: "", status: "pending_review", review_note: "", sort_order: 0 };
  return { school_id: school?.id || "", campus_id: campus?.id || "", canteen_id: canteen?.id || "", name: "", floor: "", source_url: "", status: "pending_review", sort_order: 0 };
}

function entityEndpoint(kind: EntityKind, id?: string) {
  const segment = kind === "school" ? "schools" : kind === "campus" ? "campuses" : kind === "canteen" ? "canteens" : "windows";
  return `/api/admin/campus-directory/${segment}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

function entityLabel(kind: EntityKind) { return kind === "school" ? "学校" : kind === "campus" ? "校区" : kind === "canteen" ? "食堂" : "窗口"; }
function normalizeRecord(item: object) { return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value ?? ""])); }
function cleanPayload(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, typeof raw === "string" ? raw.trim() : raw])); }
function entityPayload(kind: EntityKind, value: Record<string, unknown>) {
  const allowed = new Set(entityFields(kind).map((field) => field.key));
  return cleanPayload(Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key))));
}

function dishDraft(item?: CatalogItem): Record<string, unknown> {
  return { name: item?.name || "", entry_type: item?.entry_type || "menu_item", price: item?.price ?? "", price_unit: item?.price_unit || "元/份", price_text: item?.price_text || "", portion_description: item?.portion_description || "", description: item?.description || "", raw_text: item?.raw_text || "", notes: item?.notes || "", image_paths: item?.image_paths || [] };
}

function catalogItemPayload(item: CatalogItem | undefined, value: Record<string, unknown>, windowItem?: WindowItem | null) {
  const numericPrice = value.price === "" || value.price == null ? undefined : Number(value.price);
  return {
    entry_type: String(value.entry_type || item?.entry_type || "menu_item"), name: String(value.name || ""), description: String(value.description || ""),
    window_id: windowItem?.id || item?.window_id || undefined, floor: windowItem?.floor || item?.floor || "", window_name: windowItem?.name || item?.window_name || "",
    window_layout: item?.window_layout || "unknown", service_mode: item?.service_mode || "unknown", meal_periods: item?.meal_periods || ["unknown"],
    available_weekdays: item?.available_weekdays || [], availability_note: item?.availability_note || "", price_type: numericPrice != null ? "fixed" : item?.price_type || "unknown",
    price: Number.isFinite(numericPrice) ? numericPrice : undefined, price_min: item?.price_min, price_max: item?.price_max, price_unit: String(value.price_unit || item?.price_unit || ""),
    price_text: String(value.price_text || ""), price_options: item?.price_options || {}, portion_description: String(value.portion_description || ""), image_paths: Array.isArray(value.image_paths) ? value.image_paths : item?.image_paths || [],
    image_kind: item?.image_kind || "other", source_filename: item?.source_filename || "", raw_text: String(value.raw_text || ""), notes: String(value.notes || ""),
  };
}

function isPublishable(item: CatalogItem) { return item.status !== "published" && item.status !== "analysis_pending" && (item.missing_fields || []).every((field) => field === "image"); }
function formatPrice(item: CatalogItem) { if (item.price != null) return `${formatNumber(item.price)}${item.price_unit || "元"}`; if (item.price_min != null || item.price_max != null) return `${formatNumber(item.price_min)}–${formatNumber(item.price_max)}${item.price_unit || "元"}`; if (item.price_text) return item.price_text; return "待补充"; }
function formatNumber(value?: number) { return value == null ? "0" : Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1); }
function shortText(value: string, length: number) { return value.length > length ? `${value.slice(0, length)}…` : value; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "请求失败"; }

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() { while (cursor < items.length) { const index = cursor++; await worker(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}
