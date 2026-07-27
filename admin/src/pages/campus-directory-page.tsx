import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Building2, Check, Loader2, Plus, Save, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AdminSidebar, type AdminMenuId } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import { adminRequest, displayApiBase } from "@/lib/api";

type CampusDirectoryPageProps = {
  onLogout: () => void;
  onMenuChange: (menu: AdminMenuId) => void;
};

type TabId =
  | "schools"
  | "campuses"
  | "canteens"
  | "drafts"
  | "windows"
  | "applications"
  | "import-batches"
  | "imports";

type ListResponse<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

type School = {
  id: string;
  name: string;
  location_type?: "university" | "company" | "community";
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
  source_count?: number;
  sort_order?: number;
};

type ImportBatch = {
  id: string;
  name: string;
  region?: string;
  source_scope?: string;
  status?: string;
  total_schools?: number;
  total_campuses?: number;
  total_canteens?: number;
  total_windows?: number;
  total_sources?: number;
  notes?: string;
  created_at?: string;
};

type Window = {
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

type Application = {
  id: string;
  user_id: string;
  school_id: string;
  campus_id?: string | null;
  canteen_id?: string | null;
  requested_school_name: string;
  requested_campus_name?: string;
  requested_canteen_name: string;
  location_text?: string;
  evidence_url?: string;
  applicant_note?: string;
  status: string;
  review_note?: string;
  created_at?: string;
};

type ImportSource = {
  id: string;
  batch_id?: string | null;
  school_id: string;
  campus_id?: string | null;
  canteen_id?: string | null;
  source_url: string;
  source_title?: string;
  source_org?: string;
  source_type?: string;
  evidence_level?: string;
  evidence_excerpt?: string;
  review_status: string;
  created_at?: string;
};

type DirectoryItem =
  | School
  | Campus
  | Canteen
  | Window
  | Application
  | ImportBatch
  | ImportSource;

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "schools", label: "学校" },
  { id: "campuses", label: "校区" },
  { id: "canteens", label: "食堂" },
  { id: "drafts", label: "食堂草稿" },
  { id: "windows", label: "窗口" },
  { id: "applications", label: "申请审核" },
  { id: "import-batches", label: "采集批次" },
  { id: "imports", label: "证据来源" },
];

const inputClass =
  "min-h-10 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";
const textareaClass =
  "min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

function blankForTab(tab: TabId): Record<string, unknown> {
  switch (tab) {
    case "schools":
      return {
        name: "",
        location_type: "university",
        province: "",
        city: "",
        level: "",
        is_985: false,
        is_211: false,
        status: "active",
      };
    case "campuses":
      return {
        school_id: "",
        name: "",
        address: "",
        campus_type: "",
        source_url: "",
        status: "pending_review",
        sort_order: 0,
      };
    case "canteens":
    case "drafts":
      return {
        school_id: "",
        campus_id: "",
        name: "",
        location_text: "",
        building_or_floor: "",
        service_type: "",
        audience: "",
        opening_hours_raw: "",
        source_url: "",
        source_org: "",
        source_type: "manual",
        confidence_level: "B",
        status: "pending_review",
        sort_order: 0,
      };
    case "import-batches":
      return {
        name: "",
        region: "",
        source_scope: "985/211 官方来源采集",
        status: "pending_review",
        total_schools: 0,
        total_campuses: 0,
        total_canteens: 0,
        total_windows: 0,
        total_sources: 0,
        notes: "",
      };
    case "windows":
      return {
        school_id: "",
        campus_id: "",
        canteen_id: "",
        name: "",
        floor: "",
        source_url: "",
        status: "active",
        sort_order: 0,
      };
    case "imports":
      return {
        batch_id: "",
        school_id: "",
        campus_id: "",
        canteen_id: "",
        source_url: "",
        source_title: "",
        source_org: "",
        source_type: "official",
        evidence_level: "B",
        evidence_excerpt: "",
        review_status: "pending_review",
      };
    default:
      return {};
  }
}

function itemTitle(item: DirectoryItem, tab: TabId): string {
  if (tab === "applications")
    return (item as Application).requested_canteen_name || "未命名申请";
  if (tab === "import-batches")
    return (item as ImportBatch).name || "未命名批次";
  if (tab === "imports")
    return (
      (item as ImportSource).source_title ||
      (item as ImportSource).source_url ||
      "未命名来源"
    );
  return (item as { name?: string }).name || "未命名";
}

function itemMeta(item: DirectoryItem, tab: TabId): string {
  if (tab === "schools") {
    const row = item as School;
    return [
      row.province,
      row.city,
      row.is_985 ? "985" : "",
      row.is_211 ? "211" : "",
      row.status,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (tab === "applications") {
    const row = item as Application;
    return [row.requested_school_name, row.requested_campus_name, row.status]
      .filter(Boolean)
      .join(" · ");
  }
  if (tab === "imports") {
    const row = item as ImportSource;
    return [
      row.source_org,
      row.source_type,
      row.evidence_level,
      row.review_status,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (tab === "import-batches") {
    const row = item as ImportBatch;
    return [
      row.region,
      row.source_scope,
      row.status,
      row.total_canteens != null ? `${row.total_canteens} 食堂` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const row = item as Campus | Canteen | Window;
  return [
    row.status,
    "campus_name" in row ? row.campus_name : "",
    "source_count" in row && row.source_count ? `${row.source_count} 来源` : "",
    "floor" in row ? row.floor : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const VALID_TABS: TabId[] = [
  "schools",
  "campuses",
  "canteens",
  "drafts",
  "windows",
  "applications",
  "import-batches",
  "imports",
];

function parseTab(value: string | null): TabId {
  return value && VALID_TABS.includes(value as TabId) ? (value as TabId) : "schools";
}

export function CampusDirectoryPage({
  onLogout,
  onMenuChange,
}: CampusDirectoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = parseTab(searchParams.get("tab"));
  const [tab, setTab] = useState<TabId>(initialTab);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [page, setPage] = useState(1);
  const initialSelectedId = searchParams.get("id") ?? "";
  const pendingSelectId = useMemo(() => initialSelectedId, []);
  const limit = 40;
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<DirectoryItem | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(
    blankForTab("schools"),
  );
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>(
    blankForTab("schools"),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");

  const apiBase = displayApiBase();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const skipInitialTabEffect = useRef(true);

  useEffect(() => {
    if (skipInitialTabEffect.current) {
      skipInitialTabEffect.current = false;
      return;
    }
    setSelected(null);
    setDraft(blankForTab(tab));
    setCreateDraft(blankForTab(tab));
    setStatus(
      tab === "applications"
        ? "pending"
        : tab === "imports" || tab === "drafts"
          ? "pending_review"
          : "all",
    );
    setPage(1);
    setReviewNote("");
    setMergeTargetId("");
  }, [tab]);

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page, status]);

  useEffect(() => {
    if (selected) setDraft(normalizeItem(selected));
  }, [selected]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const q = query.trim();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    if (page !== 1) params.set("page", String(page));
    if (selected?.id) params.set("id", selected.id);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, status, page, selected?.id]);

  const endpoint = useMemo(() => `/api/admin/campus-directory/${tab}`, [tab]);

  async function loadList(nextPage = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
        q: query.trim(),
      });
      if (status !== "all") {
        params.set(tab === "imports" ? "review_status" : "status", status);
      }
      const data = await adminRequest<ListResponse<DirectoryItem>>(
        `${endpoint}?${params.toString()}`,
      );
      const nextItems = data.items || [];
      setItems(nextItems);
      setTotal(data.total || 0);
      setPage(data.page || nextPage);
      if (pendingSelectId) {
        const target = nextItems.find((item) => item.id === pendingSelectId);
        setSelected(target || nextItems[0] || null);
      } else {
        setSelected((current) =>
          current && nextItems.some((item) => item.id === current.id)
            ? current
            : nextItems[0] || null,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取失败");
      setItems([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected(event: FormEvent) {
    event.preventDefault();
    if (!selected || tab === "applications") return;
    setSaving(true);
    try {
      const saveEndpoint =
        tab === "drafts"
          ? `/api/admin/campus-directory/canteens/${encodeURIComponent(selected.id)}`
          : `${endpoint}/${encodeURIComponent(selected.id)}`;
      await adminRequest(saveEndpoint, {
        method: "PATCH",
        body: JSON.stringify(cleanPayload(draft)),
      });
      toast.success("保存成功");
      await loadList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createItem(event: FormEvent) {
    event.preventDefault();
    if (tab === "applications" || tab === "drafts") return;
    setCreating(true);
    try {
      await adminRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(cleanPayload(createDraft)),
      });
      toast.success("创建成功");
      setCreateDraft(blankForTab(tab));
      await loadList(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function reviewApplication(statusValue: "approved" | "rejected") {
    if (!selected || tab !== "applications") return;
    const row = selected as Application;
    if (statusValue === "rejected" && !reviewNote.trim()) {
      toast.error("拒绝时请填写审核备注");
      return;
    }
    setSaving(true);
    try {
      await adminRequest(`${endpoint}/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: statusValue,
          review_note: reviewNote.trim() || undefined,
        }),
      });
      toast.success(statusValue === "approved" ? "已通过并绑定食堂" : "已拒绝");
      setReviewNote("");
      await loadList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审核失败");
    } finally {
      setSaving(false);
    }
  }

  async function reviewDraft(statusValue: "active" | "rejected") {
    if (!selected || tab !== "drafts") return;
    if (statusValue === "rejected" && !reviewNote.trim()) {
      toast.error("拒绝时请填写审核备注");
      return;
    }
    setSaving(true);
    try {
      await adminRequest(
        `/api/admin/campus-directory/canteens/${encodeURIComponent(selected.id)}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            status: statusValue,
            review_note: reviewNote.trim() || undefined,
          }),
        },
      );
      toast.success(statusValue === "active" ? "草稿已上线" : "草稿已拒绝");
      setReviewNote("");
      await loadList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审核失败");
    } finally {
      setSaving(false);
    }
  }

  async function mergeDraft() {
    if (!selected || tab !== "drafts") return;
    if (!mergeTargetId.trim()) {
      toast.error("请填写目标食堂 ID");
      return;
    }
    setSaving(true);
    try {
      await adminRequest(
        `/api/admin/campus-directory/canteens/${encodeURIComponent(selected.id)}/merge`,
        {
          method: "POST",
          body: JSON.stringify({
            target_canteen_id: mergeTargetId.trim(),
            review_note: reviewNote.trim() || undefined,
          }),
        },
      );
      toast.success("草稿已合并");
      setMergeTargetId("");
      setReviewNote("");
      await loadList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "合并失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-svh gap-6 p-6">
      <AdminSidebar
        activeMenu="campus-directory"
        onLogout={onLogout}
        onMenuChange={onMenuChange}
      />

      <main className="min-w-0 flex-1 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card/90 p-6 shadow-lg backdrop-blur-md">
          <div>
            <p className="text-sm text-muted-foreground">API：{apiBase}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">校园食堂</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              管理学校、校区、食堂、窗口和用户提交的食堂申请。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-muted-foreground">
            <Building2 className="size-4" />共 {total} 条
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${tab === item.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-4 rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md">
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                void loadList(1);
              }}
            >
              <input
                className={inputClass}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、位置或来源"
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  className={inputClass}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="active">active</option>
                  <option value="pending_review">pending_review</option>
                  <option value="pending">pending</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                  <option value="inactive">inactive</option>
                  <option value="deleted">deleted</option>
                </select>
                <Button type="submit" variant="outline" disabled={loading}>
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "筛选"
                  )}
                </Button>
              </div>
            </form>

            <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${selected?.id === item.id ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {itemTitle(item, tab)}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {(item as { status?: string; review_status?: string })
                        .status ||
                        (item as ImportSource).review_status ||
                        "draft"}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {itemMeta(item, tab)}
                  </p>
                </button>
              ))}
              {!loading && items.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  暂无数据
                </p>
              )}
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => void loadList(page - 1)}
              >
                上一页
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => void loadList(page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md">
            {tab === "applications" ? (
              <ApplicationReviewPanel
                selected={selected as Application | null}
                reviewNote={reviewNote}
                setReviewNote={setReviewNote}
                saving={saving}
                onReview={reviewApplication}
              />
            ) : tab === "drafts" ? (
              <DraftReviewPanel
                selected={selected as Canteen | null}
                draft={draft}
                setDraft={setDraft}
                saving={saving}
                reviewNote={reviewNote}
                setReviewNote={setReviewNote}
                mergeTargetId={mergeTargetId}
                setMergeTargetId={setMergeTargetId}
                onSave={saveSelected}
                onReview={reviewDraft}
                onMerge={mergeDraft}
              />
            ) : (
              <>
                <form className="space-y-4" onSubmit={saveSelected}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      编辑{tabs.find((item) => item.id === tab)?.label}
                    </h2>
                    <Button type="submit" disabled={!selected || saving}>
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      保存
                    </Button>
                  </div>
                  {selected ? (
                    renderEditor(tab, draft, setDraft)
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      请选择左侧条目。
                    </p>
                  )}
                </form>

                <form className="space-y-4 border-t pt-5" onSubmit={createItem}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      新建{tabs.find((item) => item.id === tab)?.label}
                    </h2>
                    <Button type="submit" variant="outline" disabled={creating}>
                      {creating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      创建
                    </Button>
                  </div>
                  {renderEditor(tab, createDraft, setCreateDraft)}
                </form>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ApplicationReviewPanel({
  selected,
  reviewNote,
  setReviewNote,
  saving,
  onReview,
}: {
  selected: Application | null;
  reviewNote: string;
  setReviewNote: (value: string) => void;
  saving: boolean;
  onReview: (status: "approved" | "rejected") => Promise<void>;
}) {
  if (!selected)
    return <p className="text-sm text-muted-foreground">请选择左侧申请。</p>;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">
          {selected.requested_canteen_name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {[
            selected.requested_school_name,
            selected.requested_campus_name,
            selected.location_text,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <Info label="申请人" value={selected.user_id} />
        <Info label="状态" value={selected.status} />
        <Info label="证据 URL" value={selected.evidence_url || "-"} />
        <Info label="食堂 ID" value={selected.canteen_id || "-"} />
      </dl>
      <div>
        <label className="mb-2 block text-sm font-medium">用户备注</label>
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          {selected.applicant_note || "无"}
        </p>
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium">审核备注</label>
        <textarea
          className={textareaClass}
          value={reviewNote}
          onChange={(event) => setReviewNote(event.target.value)}
          placeholder="拒绝时必填，通过时可写来源说明"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => void onReview("approved")}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          通过并创建/绑定食堂
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={saving}
          onClick={() => void onReview("rejected")}
        >
          <X className="size-4" />
          拒绝
        </Button>
      </div>
    </div>
  );
}

function DraftReviewPanel({
  selected,
  draft,
  setDraft,
  saving,
  reviewNote,
  setReviewNote,
  mergeTargetId,
  setMergeTargetId,
  onSave,
  onReview,
  onMerge,
}: {
  selected: Canteen | null;
  draft: Record<string, unknown>;
  setDraft: (value: Record<string, unknown>) => void;
  saving: boolean;
  reviewNote: string;
  setReviewNote: (value: string) => void;
  mergeTargetId: string;
  setMergeTargetId: (value: string) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onReview: (status: "active" | "rejected") => Promise<void>;
  onMerge: () => Promise<void>;
}) {
  if (!selected)
    return (
      <p className="text-sm text-muted-foreground">请选择左侧食堂草稿。</p>
    );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{selected.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {[
            selected.campus_name,
            selected.location_text,
            selected.source_type,
            selected.confidence_level,
          ]
            .filter(Boolean)
            .join(" · ") || "待审核食堂草稿"}
        </p>
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-3">
        <Info label="状态" value={selected.status || "-"} />
        <Info label="证据数量" value={String(selected.source_count || 0)} />
        <Info label="校区 ID" value={selected.campus_id || "-"} />
      </dl>

      <form className="space-y-4" onSubmit={onSave}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">草稿字段</h3>
          <Button type="submit" variant="outline" disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存字段
          </Button>
        </div>
        {renderEditor("drafts", draft, setDraft)}
      </form>

      <div className="space-y-3 border-t pt-5">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            审核备注
          </span>
          <textarea
            className={textareaClass}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="通过、拒绝或合并时记录依据"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => void onReview("active")}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            通过上线
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={saving}
            onClick={() => void onReview("rejected")}
          >
            <X className="size-4" />
            拒绝草稿
          </Button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-5">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            合并到已有食堂 ID
          </span>
          <input
            className={inputClass}
            value={mergeTargetId}
            onChange={(event) => setMergeTargetId(event.target.value)}
            placeholder="目标 active 食堂 ID"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={saving || !mergeTargetId.trim()}
          onClick={() => void onMerge()}
        >
          合并重复食堂
        </Button>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

function renderEditor(
  tab: TabId,
  value: Record<string, unknown>,
  setValue: (value: Record<string, unknown>) => void,
) {
  const fields = editorFields(tab);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) => (
        <label
          key={field.key}
          className={field.wide ? "grid gap-1 md:col-span-2" : "grid gap-1"}
        >
          <span className="text-xs font-medium text-muted-foreground">
            {field.label}
          </span>
          {field.type === "textarea" ? (
            <textarea
              className={textareaClass}
              value={String(value[field.key] ?? "")}
              onChange={(event) =>
                setValue({ ...value, [field.key]: event.target.value })
              }
            />
          ) : field.type === "boolean" ? (
            <select
              className={inputClass}
              value={value[field.key] ? "true" : "false"}
              onChange={(event) =>
                setValue({
                  ...value,
                  [field.key]: event.target.value === "true",
                })
              }
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : (
            <input
              className={inputClass}
              type={field.type === "number" ? "number" : "text"}
              value={String(value[field.key] ?? "")}
              onChange={(event) =>
                setValue({
                  ...value,
                  [field.key]:
                    field.type === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                })
              }
            />
          )}
        </label>
      ))}
    </div>
  );
}

function editorFields(
  tab: TabId,
): Array<{
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "textarea";
  wide?: boolean;
}> {
  switch (tab) {
    case "schools":
      return [
        { key: "name", label: "地点名称", wide: true },
        { key: "location_type", label: "类型（高校/公司/社区；内部值 university/company/community）", wide: true },
        { key: "province", label: "省份" },
        { key: "city", label: "城市" },
        { key: "level", label: "层级" },
        { key: "status", label: "状态" },
        { key: "is_985", label: "985", type: "boolean" },
        { key: "is_211", label: "211", type: "boolean" },
      ];
    case "campuses":
      return [
        { key: "school_id", label: "学校 ID", wide: true },
        { key: "name", label: "校区名称" },
        { key: "status", label: "状态" },
        { key: "address", label: "地址", wide: true },
        { key: "campus_type", label: "校区类型" },
        { key: "source_url", label: "证据 URL", wide: true },
        { key: "sort_order", label: "排序", type: "number" },
      ];
    case "canteens":
    case "drafts":
      return [
        { key: "school_id", label: "学校 ID", wide: true },
        { key: "campus_id", label: "校区 ID", wide: true },
        { key: "name", label: "食堂名称" },
        { key: "status", label: "状态" },
        { key: "location_text", label: "位置", wide: true },
        { key: "building_or_floor", label: "楼栋/楼层" },
        { key: "service_type", label: "服务类型" },
        { key: "audience", label: "开放对象" },
        {
          key: "opening_hours_raw",
          label: "营业时间原文",
          type: "textarea",
          wide: true,
        },
        { key: "source_url", label: "证据 URL", wide: true },
        { key: "source_org", label: "来源机构" },
        { key: "source_type", label: "来源类型" },
        { key: "confidence_level", label: "可信等级" },
        { key: "review_note", label: "审核备注", type: "textarea", wide: true },
        { key: "sort_order", label: "排序", type: "number" },
      ];
    case "import-batches":
      return [
        { key: "name", label: "批次名称", wide: true },
        { key: "region", label: "区域" },
        { key: "status", label: "状态" },
        { key: "source_scope", label: "采集范围", wide: true },
        { key: "total_schools", label: "学校数", type: "number" },
        { key: "total_campuses", label: "校区数", type: "number" },
        { key: "total_canteens", label: "食堂数", type: "number" },
        { key: "total_windows", label: "窗口数", type: "number" },
        { key: "total_sources", label: "证据数", type: "number" },
        { key: "notes", label: "备注", type: "textarea", wide: true },
      ];
    case "windows":
      return [
        { key: "school_id", label: "学校 ID", wide: true },
        { key: "campus_id", label: "校区 ID", wide: true },
        { key: "canteen_id", label: "食堂 ID", wide: true },
        { key: "name", label: "窗口名称" },
        { key: "floor", label: "楼层" },
        { key: "source_url", label: "证据 URL", wide: true },
        { key: "status", label: "状态" },
        { key: "sort_order", label: "排序", type: "number" },
      ];
    case "imports":
      return [
        { key: "batch_id", label: "采集批次 ID", wide: true },
        { key: "school_id", label: "学校 ID", wide: true },
        { key: "campus_id", label: "校区 ID", wide: true },
        { key: "canteen_id", label: "食堂 ID", wide: true },
        { key: "source_url", label: "来源 URL", wide: true },
        { key: "source_title", label: "来源标题", wide: true },
        { key: "source_org", label: "来源机构" },
        { key: "source_type", label: "来源类型" },
        { key: "evidence_level", label: "证据等级" },
        {
          key: "evidence_excerpt",
          label: "证据摘录",
          type: "textarea",
          wide: true,
        },
        { key: "review_status", label: "审核状态" },
      ];
    default:
      return [];
  }
}

function normalizeItem(item: DirectoryItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, value ?? ""]),
  );
}

function cleanPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (typeof value === "string") return [key, value.trim()];
      return [key, value];
    }),
  );
}
