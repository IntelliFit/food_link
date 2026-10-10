import {
  View,
  Text,
  ScrollView,
  Image,
  Input,
  Button,
} from "@tarojs/components";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { withAuth } from "../../../utils/withAuth";
import {
  getAccessToken,
  getPublicFoodLibraryList,
  getSchoolCampuses,
  getSchoolCanteens,
  getUserProfile,
  showUnifiedApiError,
  submitStructuredFeedback,
  type FeedbackSource,
  type PublicFoodLibraryItem,
  type CanteenWindowItem,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
  type CanteenScope,
} from "../../../utils/api";
import "./index.scss";
import { extraPkgUrl } from "../../../utils/subpackage-extra";
import { useAppColorScheme } from "../../../components/AppColorSchemeContext";
import { applyThemeNavigationBar } from "../../../utils/theme-navigation-bar";
import { FlPageThemeRoot } from "../../../components/FlPageThemeRoot";
import SchoolPicker from "../../../components/SchoolPicker";
import CampusPicker from "../../../components/CampusPicker";
import CanteenPicker from "../../../components/CanteenPicker";
import FloorPicker from "../../../components/FloorPicker";
import WindowPicker from "../../../components/WindowPicker";
import { ArrowDown, ArrowRight, Ellipsis, FilterOutlined, Plus, Search } from "@taroify/icons";
import "@taroify/icons/style";
import { campusNutritionState } from "../../../utils/campus-nutrition";

type SortBy = "hot" | "high_protein" | "low_calorie" | "value";

function normalizeText(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getLocationText(item: PublicFoodLibraryItem): string {
  if (item.campus_location_text) return item.campus_location_text;
  return [
    item.school_name,
    item.campus_name,
    item.canteen_name,
    item.floor,
    item.window_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getPriceText(item: PublicFoodLibraryItem): string {
  const type = item.price_type || "fixed";
  if (type === "unknown") return "价格待补充";
  if (type === "range" && item.price_min != null && item.price_max != null) {
    return `${item.price_min}-${item.price_max}元`;
  }
  if (item.price == null || item.price <= 0) return "价格待补充";
  const unit =
    item.price_unit ||
    (type === "weight" ? "元/kg" : type === "combo" ? "元/套餐" : "元/份");
  return `${item.price}${unit.replace(/^\d+/, "")}`;
}

function isAnalyzingItem(item: PublicFoodLibraryItem): boolean {
  return campusNutritionState(item).analyzing;
}

function isAnalysisFailedItem(item: PublicFoodLibraryItem): boolean {
  return campusNutritionState(item).failed;
}

function isClientReadyCampusItem(item: PublicFoodLibraryItem): boolean {
  const publicationStatus = normalizeText(item.status);
  if (publicationStatus && publicationStatus !== "published") return false;
  // 社区资料先发布，营养状态独立推进；pending/stale/failed 也必须可见，
  // 否则用户刚上传或刚纠错的菜会像“消失”一样。
  return Boolean(item.food_name);
}

function sortCampusItemsByPopularity(
  items: PublicFoodLibraryItem[],
): PublicFoodLibraryItem[] {
  return [...items].sort((a, b) => {
    const imageDiff = Number(hasCampusImage(b)) - Number(hasCampusImage(a));
    if (imageDiff !== 0) return imageDiff;

    const engagementDiff =
      (b.like_count || 0) + (b.collection_count || 0) -
      ((a.like_count || 0) + (a.collection_count || 0));
    if (engagementDiff !== 0) return engagementDiff;

    const aPublishedAt = Date.parse(a.published_at || a.created_at || "");
    const bPublishedAt = Date.parse(b.published_at || b.created_at || "");
    const publishedDiff =
      (Number.isFinite(bPublishedAt) ? bPublishedAt : 0) -
      (Number.isFinite(aPublishedAt) ? aPublishedAt : 0);
    return publishedDiff || a.id.localeCompare(b.id);
  });
}

function hasCampusImage(item: PublicFoodLibraryItem): boolean {
  return Boolean(item.image_path || item.image_paths?.some((path) => !!path));
}

function CampusCanteenPage() {
  const { scheme } = useAppColorScheme();
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken());
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<PublicFoodLibraryItem[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("hot");
  const [canteenScope, setCanteenScope] = useState<CanteenScope>("all");
  const campusScope = canteenScope === "campus";
  const [searchKeyword, setSearchKeyword] = useState("");
  const [appliedSearchKeyword, setAppliedSearchKeyword] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolItem | null>(null);
  const [selectedCampus, setSelectedCampus] = useState<SchoolCampusItem | null>(
    null,
  );
  const [selectedCanteen, setSelectedCanteen] =
    useState<SchoolCanteenItem | null>(null);
  const [directoryCampuses, setDirectoryCampuses] = useState<
    SchoolCampusItem[]
  >([]);
  const [directoryCanteens, setDirectoryCanteens] = useState<
    SchoolCanteenItem[]
  >([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [floorName, setFloorName] = useState("");
  const [windowName, setWindowName] = useState("");
  const [selectedWindow, setSelectedWindow] = useState<CanteenWindowItem | null>(null);
  const [showSchoolPicker, setShowSchoolPicker] = useState(false);
  const [showCampusPicker, setShowCampusPicker] = useState(false);
  const [showCanteenPicker, setShowCanteenPicker] = useState(false);
  const [showFloorPicker, setShowFloorPicker] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [directoryExpanded, setDirectoryExpanded] = useState(false);
  const [listError, setListError] = useState(false);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const schoolChosenByUser = useRef(false);
  const listRequestId = useRef(0);
  const [listScope, setListScope] = useState("");
  const scopeKey = [canteenScope, campusScope ? selectedSchool?.id : "", selectedCampus?.id, selectedCanteen?.id,
    selectedWindow?.id, floorName, windowName, sortBy, appliedSearchKeyword].join("|");
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const lastRefreshTime = useRef<number>(0);

  const fetchReadyCampusItems = useCallback(
    async (keyword = appliedSearchKeyword) => {
      const directoryFilter = !campusScope ? {} : selectedWindow?.id
        ? { window_id: selectedWindow.id }
        : selectedCanteen?.id
        ? { canteen_id: selectedCanteen.id }
        : selectedCampus?.id
          ? { campus_id: selectedCampus.id }
          : selectedSchool?.id
            ? { school_id: selectedSchool.id }
            : {};
      const request = {
        canteen_scope: canteenScope,
        ...directoryFilter,
        keyword: keyword || undefined,
        floor: floorName || undefined,
        window_name: selectedWindow?.id ? undefined : windowName || undefined,
        sort_by: sortBy,
        limit: 80,
      };
      const fetchHotFallback = async () => {
        const fallback = await getPublicFoodLibraryList({
          ...request,
          sort_by: "high_protein",
        });
        return sortCampusItemsByPopularity(
          (fallback.list || []).filter(isClientReadyCampusItem),
        );
      };

      try {
        const res = await getPublicFoodLibraryList(request);
        const readyItems = (res.list || []).filter(isClientReadyCampusItem);
        if (sortBy !== "hot" || readyItems.length > 0) return readyItems;
        return fetchHotFallback();
      } catch (error) {
        if (sortBy !== "hot") throw error;
        return fetchHotFallback();
      }
    },
    [
      appliedSearchKeyword,
      canteenScope,
      campusScope,
      floorName,
      selectedSchool,
      selectedCampus,
      selectedCanteen,
      selectedWindow?.id,
      sortBy,
      windowName,
    ],
  );

  const loadList = useCallback(
    async (
      silent = false,
      force = false,
      keyword = appliedSearchKeyword,
    ) => {
      if (!getAccessToken()) {
        listRequestId.current += 1;
        setList([]);
        setLoading(false);
        return;
      }
      const now = Date.now();
      if (!force && now - lastRefreshTime.current < 30000) return;
      const requestId = ++listRequestId.current;
      if (!silent) setLoading(true);
      setListError(false);
      try {
        const items = await fetchReadyCampusItems(keyword);
        if (requestId !== listRequestId.current || currentScope.current !== scopeKey) return;
        setList(items);
        setListScope(scopeKey);
        lastRefreshTime.current = Date.now();
      } catch (e: any) {
        if (requestId !== listRequestId.current || currentScope.current !== scopeKey) return;
        console.error("获取食堂菜品失败:", e);
        setListError(true);
        // 同范围手动刷新失败时保留旧菜品，不清空列表或改变滚动位置。
        if (!silent) {
          await showUnifiedApiError(e, "获取列表失败");
        }
      } finally {
        if (requestId === listRequestId.current && currentScope.current === scopeKey) {
          if (!silent) setLoading(false);
        }
      }
    },
    [fetchReadyCampusItems, appliedSearchKeyword, scopeKey],
  );

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getUserProfile()
      .then((profile) => {
        if (cancelled || schoolChosenByUser.current) return;
        const condition = profile.health_condition;
        const preference = condition?.campus_dining_preference;
        if (condition?.is_student !== true || !preference?.school_id || !preference.school_name) return;
        setSelectedSchool({ id: preference.school_id, name: preference.school_name });
        // 校区需在真实目录中核验；不凭名称构造不存在的校区。
      })
      .catch(() => { /* 偏好只预填校园筛选，不改变默认全部食堂范围。 */ });
    return () => { cancelled = true; };
  }, [loggedIn]);

  useDidShow(() => {
    applyThemeNavigationBar(scheme);
    const hasToken = !!getAccessToken();
    setLoggedIn(hasToken);
  });

  useEffect(() => {
    applyThemeNavigationBar(scheme);
  }, [scheme]);

  useEffect(() => {
    if (loggedIn) {
      loadList(false, true);
    }
  }, [
    loggedIn,
    loadList,
  ]);

  useEffect(() => {
    let cancelled = false;
    const schoolId = selectedSchool?.id;
    if (!loggedIn || !campusScope || !schoolId) {
      setDirectoryCampuses([]);
      setDirectoryCanteens([]);
      setDirectoryLoading(false);
      setDirectoryError(false);
      return () => {
        cancelled = true;
      };
    }

    setDirectoryLoading(true);
    setDirectoryError(false);
    setDirectoryCampuses([]);
    setDirectoryCanteens([]);
    Promise.all([getSchoolCampuses(schoolId), getSchoolCanteens(schoolId)])
      .then(([campuses, canteens]) => {
        if (cancelled) return;
        setDirectoryCampuses(campuses);
        setDirectoryCanteens(canteens);
      })
      .catch(async (e: any) => {
        if (cancelled) return;
        console.error("加载已收录食堂目录失败:", e);
        setDirectoryCampuses([]);
        setDirectoryCanteens([]);
        setDirectoryError(true);
        await showUnifiedApiError(e, "获取食堂目录失败");
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loggedIn, campusScope, selectedSchool?.id, directoryRevision]);

  useEffect(() => {
    const keyword = searchKeyword.trim();
    if (keyword === appliedSearchKeyword) return;
    const timer = setTimeout(() => {
      lastRefreshTime.current = 0;
      setAppliedSearchKeyword(keyword);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchKeyword, appliedSearchKeyword]);

  const handleSearch = (value = searchKeyword) => {
    const kw = value.trim();
    setSearchKeyword(value);
    lastRefreshTime.current = 0;
    if (kw === appliedSearchKeyword) {
      void loadList(false, true, kw);
      return;
    }
    setAppliedSearchKeyword(kw);
  };

  const clearSearch = () => {
    setSearchKeyword("");
    if (!appliedSearchKeyword) return;
    lastRefreshTime.current = 0;
    setAppliedSearchKeyword("");
  };

  const handleLocationFeedback = async () => {
    const modalResult = await Taro.showModal({
      title: "食堂地点纠错",
      content: "",
      editable: true,
      placeholderText: "请说明食堂名称、地址或楼层哪里不对…",
      confirmText: "提交",
      cancelText: "取消",
      confirmColor: "#00bc7d",
    } as any);
    const { confirm } = modalResult;
    const content = String((modalResult as any).content || "").trim();
    if (!confirm) return;
    const trimmed = content;
    if (!trimmed) {
      Taro.showToast({ title: "请填写反馈内容", icon: "none" });
      return;
    }
    Taro.showLoading({ title: "", mask: true });
    try {
      await submitStructuredFeedback({
        source: "campus_location" as FeedbackSource,
        content: trimmed,
        extra: {
          school_id: selectedSchool?.id || null,
          school_name: selectedSchool?.name || null,
          campus_id: selectedCampus?.id || null,
          campus_name: selectedCampus?.name || null,
          canteen_id: selectedCanteen?.id || null,
          canteen_name: selectedCanteen?.name || null,
          floor: floorName || null,
          window_name: windowName || null,
        },
      });
      Taro.showToast({ title: "反馈已提交", icon: "success" });
    } catch (e: any) {
      await showUnifiedApiError(e, "提交失败");
    } finally {
      Taro.hideLoading();
    }
  };

  const goDetail = (itemId: string, campus = true) => {
    Taro.navigateTo({
      url: `${extraPkgUrl("/pages/food-library-detail/index")}?id=${itemId}${campus ? "&scene=campus" : ""}`,
    });
  };

  const goUpload = () => {
    Taro.navigateTo({ url: extraPkgUrl(campusScope ? "/pages/campus-food-share/index" : "/pages/food-library-share/index") });
  };

  const goCollector = () => {
    Taro.navigateTo({ url: extraPkgUrl("/pages/campus-food-collector/index") });
  };

  const openMore = async () => {
    const actions = [
      { label: "补充菜品", run: goUpload },
      ...(campusScope ? [{ label: "批量采集", run: goCollector }] : []),
      { label: "地点纠错", run: () => void handleLocationFeedback() },
      { label: "刷新菜品", run: () => void loadList(false, true) },
    ];
    try {
      const { tapIndex } = await Taro.showActionSheet({
        itemList: actions.map((action) => action.label),
      });
      actions[tapIndex]?.run();
    } catch { /* 取消更多菜单不执行操作。 */ }
  };

  const openCanteenPicker = () => {
    if (!selectedSchool?.id) {
      Taro.showToast({ title: "请先选择学校", icon: "none" });
      return;
    }
    setShowCanteenPicker(true);
  };

  const openCampusPicker = () => {
    if (!selectedSchool?.id) {
      Taro.showToast({ title: "请先选择学校", icon: "none" });
      return;
    }
    setShowCampusPicker(true);
  };

  const quickRecord = (e: any, item: PublicFoodLibraryItem) => {
    e.stopPropagation();
    if (campusNutritionState(item).estimated) {
      goDetail(item.id, item.type === "campus" || !!item.is_campus_food);
      return;
    }
    if (isAnalyzingItem(item)) {
      Taro.showToast({ title: "营养信息分析中", icon: "none" });
      return;
    }
    if (isAnalysisFailedItem(item)) {
      Taro.showToast({ title: "分析失败，暂不能记录", icon: "none" });
      return;
    }
    if (!campusNutritionState(item).canRecord) {
      Taro.showToast({ title: "营养信息待更新，暂不能记录", icon: "none" });
      return;
    }
    Taro.setStorageSync("campus_quick_record_item", JSON.stringify(item));
    Taro.setStorageSync("campus_quick_record_source", "campus_canteen");
    Taro.navigateTo({
      url: `${extraPkgUrl("/pages/record-manual/index")}?campus_quick=1`,
    });
  };

  const selectedSchoolName = selectedSchool?.name || "选择学校";
  const changeCanteenScope = (scope: CanteenScope) => {
    if (scope === canteenScope) return;
    schoolChosenByUser.current = true;
    lastRefreshTime.current = 0;
    setCanteenScope(scope);
    setSelectedCampus(null);
    setSelectedCanteen(null);
    setSelectedWindow(null);
    setFloorName("");
    setWindowName("");
    setFiltersExpanded(false);
    setDirectoryExpanded(false);
    // 保留搜索词，切换场所类型仍可查同一道菜；不修改个人学校档案。
  };
  const hasActiveFilters = Boolean(
    selectedCampus ||
      selectedCanteen ||
      floorName ||
      selectedWindow ||
      appliedSearchKeyword,
  );
  const clearFilters = () => {
    lastRefreshTime.current = 0;
    setSearchKeyword("");
    setAppliedSearchKeyword("");
    // 重置当前学校内的范围，不清除学校或修改个人档案。
    setSelectedCampus(null);
    setSelectedCanteen(null);
    setSelectedWindow(null);
    setFloorName("");
    setWindowName("");
  };
  const visibleList = useMemo(() => {
    const floorKeyword = normalizeText(floorName);
    const windowKeyword = normalizeText(windowName);
    return (listScope === scopeKey ? list : []).filter((item) => {
      if (!isClientReadyCampusItem(item)) return false;
      if (
        floorKeyword &&
        !normalizeText(item.floor).includes(floorKeyword) &&
        !normalizeText(getLocationText(item)).includes(floorKeyword)
      ) {
        return false;
      }
      if (
        windowKeyword &&
        !normalizeText(item.window_name).includes(windowKeyword) &&
        !normalizeText(getLocationText(item)).includes(windowKeyword)
      ) {
        return false;
      }
      return true;
    });
  }, [floorName, list, windowName, listScope, scopeKey]);
  const visibleDirectoryCanteens = useMemo(
    () =>
      selectedCampus?.id
        ? directoryCanteens.filter(
            (canteen) => canteen.campus_id === selectedCampus.id,
          )
        : directoryCanteens,
    [directoryCanteens, selectedCampus?.id],
  );
  const selectDirectoryCanteen = (canteen: SchoolCanteenItem) => {
    const campus = canteen.campus_id
      ? directoryCampuses.find((item) => item.id === canteen.campus_id) || null
      : null;
    setSelectedCampus(campus);
    setSelectedCanteen(canteen);
    setSelectedWindow(null);
    setFloorName("");
    setWindowName("");
    setDirectoryExpanded(false);
  };
  const searchWholeSchool = () => {
    setSelectedCampus(null);
    setSelectedCanteen(null);
    setSelectedWindow(null);
    setFloorName("");
    setWindowName("");
  };

  const openMealMore = async (e: any, item: PublicFoodLibraryItem) => {
    e.stopPropagation();
    const nutrition = campusNutritionState(item);
    const actions = [{ label: "查看详情", run: () => goDetail(item.id, item.type === "campus" || !!item.is_campus_food) }];
    if (nutrition.canRecord || nutrition.estimated) {
      actions.push({
        label: nutrition.estimated ? "查看营养估算" : "记录这道菜",
        run: () => quickRecord(e, item),
      });
    }
    const authorId = item.author?.id;
    if (authorId) {
      actions.push({ label: "查看贡献者", run: () => {
        Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(authorId)}`) });
      } });
    }
    try {
      const { tapIndex } = await Taro.showActionSheet({ itemList: actions.map((action) => action.label) });
      actions[tapIndex]?.run();
    } catch { /* 关闭菜单不保存记录或跳转。 */ }
  };

  const renderCampusCard = (item: PublicFoodLibraryItem) => {
    const nutrition = campusNutritionState(item);
    const photo = item.image_path || item.image_paths?.find(Boolean);
    const location = [item.canteen_name, item.floor, item.window_name].filter(Boolean).join(" · ")
      || item.campus_location_text || item.merchant_name || item.detail_address || item.merchant_address || item.campus_name || "地点待补充";
    const nutritionText = nutrition.displayNutrition
      ? `${nutrition.estimated || nutrition.pending ? "约 " : ""}${item.total_calories.toFixed(0)} kcal`
      : nutrition.failed ? "营养待重试" : "营养待更新";
    return (
      <View
        key={item.id}
        className='campus-meal-card'
        onClick={() => goDetail(item.id, item.type === "campus" || !!item.is_campus_food)}
      >
        <View className='campus-meal-image'>
          {photo ? (
            <Image className='campus-meal-photo' src={photo} mode='aspectFill' />
          ) : (
            <View className='campus-meal-no-photo'>
              <Text className='iconfont icon-shiwu' />
              <Text>暂无餐照</Text>
            </View>
          )}
          <Button className='campus-meal-record' ariaLabel='餐食详情、记录与贡献者' onClick={(e) => void openMealMore(e, item)}>
            <Ellipsis />
          </Button>
        </View>
        <View className='campus-meal-body'>
          <Text className='campus-meal-name'>{item.food_name || "未命名菜品"}</Text>
          <Text className='campus-meal-location'>{location}</Text>
          <Text className='campus-meal-price'>{getPriceText(item)}</Text>
          <Text className='campus-meal-nutrition'>{nutritionText}</Text>
        </View>
      </View>
    );
  };

  if (!loggedIn) {
    return (
      <FlPageThemeRoot>
        <View className='campus-canteen-page'>
          <View className='login-tip'>
            <Text className='login-tip-text'>登录后查看校园与社区食堂</Text>
            <Button
              className='login-tip-btn'
              onClick={() => Taro.switchTab({ url: "/pages/profile/index" })}
            >
              去登录
            </Button>
          </View>
        </View>
      </FlPageThemeRoot>
    );
  }

  return (
    <FlPageThemeRoot>
      <View className='campus-canteen-page campus-canteen-page--directory'>
        <View className='campus-browse-header'>
          <View className='canteen-scope-tabs'>
            {([["all", "全部食堂"], ["campus", "校园"], ["community", "社区·园区"]] as const).map(([value, label]) => (
              <Button key={value} id={`canteen-scope-${value}`} ariaLabel={`${label}${canteenScope === value ? "，已选中" : ""}`} className={`canteen-scope-tab ${canteenScope === value ? "active" : ""}`} onClick={() => changeCanteenScope(value)}>{label}</Button>
            ))}
          </View>
          {campusScope && (
          <View className='campus-school-row'>
            <View className='campus-school-select' onClick={() => setShowSchoolPicker(true)}>
              <Text className='campus-school-name'>{selectedSchoolName}</Text>
              <ArrowDown className='campus-chevron' />
            </View>
            <Button className='campus-more-button' ariaLabel={selectedSchool ? "补充食堂菜品" : "食堂更多操作"} onClick={() => selectedSchool ? goUpload() : void openMore()}>
              {selectedSchool ? <Plus /> : <Ellipsis />}
            </Button>
          </View>
          )}
          <View className='campus-browse-search'>
            <View className='search-input-wrap'>
              <Search className='search-input-icon' />
              <Input className='search-input' placeholder='搜菜名、食堂、地点' value={searchKeyword}
                confirmType='search' onInput={(e) => setSearchKeyword(e.detail.value)} onConfirm={(e) => handleSearch(e.detail.value)}
              />
              <Button className='campus-search-submit' onClick={() => handleSearch()}>搜索</Button>
            </View>
            {campusScope && selectedSchool && <Button className='campus-area-button' onClick={openCampusPicker}>
              <Text>{selectedCampus?.name || "校区"}</Text>
              <ArrowDown className='campus-chevron' />
            </Button>}
          </View>
          {appliedSearchKeyword && (
            <View className='search-active-row'>
              <Text className='search-active-text'>“{appliedSearchKeyword}”的结果</Text>
              <Text className='search-active-clear' onClick={clearSearch}>清除</Text>
            </View>
          )}
        </View>

        {/* 列表 */}
        <ScrollView
          className='list-scroll'
          scrollY
          enhanced
          showScrollbar={false}
          refresherEnabled={false}
        >
          <View className='list-content'>
            {campusScope && selectedSchool && (
              <View className='campus-directory-section'>
                <View className='section-head campus-directory-head'>
                  <Text className='section-title'>食堂</Text>
                  {selectedCanteen ? (
                    <Text className='campus-text-button' onClick={() => setDirectoryExpanded(!directoryExpanded)}>
                      {directoryExpanded ? "收起" : "换食堂"}
                    </Text>
                  ) : visibleDirectoryCanteens.length > 4 && (
                    <Text className='campus-text-button' onClick={() => setDirectoryExpanded(!directoryExpanded)}>
                      {directoryExpanded ? "收起" : "全部食堂"}
                    </Text>
                  )}
                </View>
                {directoryLoading ? (
                  <View className='campus-directory-loading'>
                    <View className='loading-spinner-md' />
                  </View>
                ) : directoryError ? (
                  <View className='campus-directory-empty'>
                    <Text>食堂目录暂时不可用</Text>
                    <Text className='campus-text-button' onClick={() => setDirectoryRevision((n) => n + 1)}>重试</Text>
                  </View>
                ) : visibleDirectoryCanteens.length === 0 ? (
                  <View className='campus-directory-empty'>
                    该学校暂无已审核食堂
                  </View>
                ) : (!selectedCanteen || directoryExpanded) && (
                    <View className='campus-directory-list'>
                      {(directoryExpanded ? visibleDirectoryCanteens : visibleDirectoryCanteens.slice(0, 4)).map((canteen) => {
                        const locationText = [
                          canteen.campus_name,
                          canteen.building_or_floor,
                          canteen.location_text,
                        ]
                          .filter(Boolean)
                          .filter(
                            (value, index, values) =>
                              values.indexOf(value) === index,
                          )
                          .join(" · ");
                        const isSelected = selectedCanteen?.id === canteen.id;
                        return (
                          <View
                            key={canteen.id}
                            className={`campus-directory-card ${isSelected ? "active" : ""}`}
                            onClick={() => selectDirectoryCanteen(canteen)}
                          >
                            <Text className='iconfont icon-shiwu campus-directory-icon' />
                            <View className='campus-directory-card-copy'>
                              <Text className='campus-directory-name'>
                                {canteen.name}
                              </Text>
                            <Text className='campus-directory-location'>
                              {locationText || "位置待补充"}
                            </Text>
                            </View>
                            <ArrowRight className='campus-directory-arrow' />
                          </View>
                        );
                      })}
                    </View>
                )}
              </View>
            )}

              <View className='campus-results-header'>
                <View className='campus-results-copy'>
                  <Text className='campus-results-title'>{selectedCanteen?.name || (canteenScope === "community" ? "社区与园区菜品" : campusScope ? "校园菜品" : "食堂菜品")}</Text>
                  {campusScope && selectedSchool && <Text className='campus-results-location'>
                    {[selectedSchool.name, selectedCampus?.name, floorName, windowName].filter(Boolean).join(" · ")}
                  </Text>}
                </View>
                {loading && visibleList.length > 0 && <View className='campus-refresh-indicator'><View className='loading-spinner-md' /></View>}
                <Button className='campus-more-button' ariaLabel='菜品更多操作' onClick={() => void openMore()}><Ellipsis /></Button>
              </View>
              <View className='campus-sort-row'>
                {([
                  ["hot", "热门"], ["high_protein", "高蛋白"], ["low_calorie", "低热量"], ["value", "性价比"],
                ] as const).map(([value, label]) => (
                  <View key={value} id={`canteen-sort-${value}`} className={`campus-sort-tab ${sortBy === value ? "active" : ""}`} onClick={() => setSortBy(value)}>{label}</View>
                ))}
                {campusScope && selectedSchool && <View className={`campus-filter-toggle ${filtersExpanded || hasActiveFilters ? "active" : ""}`} onClick={() => setFiltersExpanded(!filtersExpanded)}>
                  <FilterOutlined className='campus-filter-icon' /><Text>筛选</Text>
                </View>}
              </View>
              {campusScope && selectedSchool && filtersExpanded && (
                <View className='campus-filter-panel'>
                  <View className='filter-row filter-row--equal'>
                    <View className='filter-chip' onClick={openCampusPicker}><Text className='filter-chip-text'>{selectedCampus?.name || "全部校区"}</Text><ArrowDown className='filter-chip-arrow' /></View>
                    <View className='filter-chip' onClick={openCanteenPicker}><Text className='filter-chip-text'>{selectedCanteen?.name || "全部食堂"}</Text><ArrowDown className='filter-chip-arrow' /></View>
                  </View>
                  <View className='filter-row filter-row--equal'>
                    <View className='filter-chip' onClick={() => selectedCanteen?.id ? setShowFloorPicker(true) : openCanteenPicker()}><Text className='filter-chip-text'>{floorName || "楼层"}</Text><ArrowDown className='filter-chip-arrow' /></View>
                    <View className='filter-chip' onClick={() => !selectedCanteen?.id ? openCanteenPicker() : !floorName ? setShowFloorPicker(true) : setShowWindowPicker(true)}><Text className='filter-chip-text'>{windowName || "窗口"}</Text><ArrowDown className='filter-chip-arrow' /></View>
                  </View>
                  <View className='campus-filter-actions'>
                    <Text className='campus-text-button' onClick={clearFilters}>重置</Text>
                    <Text className='campus-text-button' onClick={() => setFiltersExpanded(false)}>收起筛选</Text>
                  </View>
                </View>
              )}
            {listError && visibleList.length > 0 && (
              <View className='campus-refresh-error'>
                <Text>刷新未成功，已保留原列表</Text>
                <Text className='campus-text-button' onClick={() => void loadList(false, true)}>重试</Text>
              </View>
            )}
            {(loading && visibleList.length === 0) || (listScope !== scopeKey && !listError) ? (
              <View className='loading-state'>
                <View className='loading-spinner-md' />
              </View>
            ) : listError && visibleList.length === 0 ? (
              <View className='empty-state'>
                <Text className='empty-text'>菜品暂时不可用</Text>
                <Button className='campus-primary-button' onClick={() => void loadList(false, true)}>重试</Button>
              </View>
            ) : visibleList.length === 0 ? (
              <View className='empty-state'>
                <Text className='empty-icon iconfont icon-shiwu' />
                <Text className='empty-text'>
                  {appliedSearchKeyword || floorName || windowName ? "没有找到匹配的菜品" : "这里还没有收录菜品"}
                </Text>
                <Text className='empty-subtext'>
                  {hasActiveFilters ? "试试换个食堂或重置筛选" : "你可以补充第一份菜品"}
                </Text>
                <Button className='campus-primary-button' onClick={hasActiveFilters ? clearFilters : goUpload}>{hasActiveFilters ? "重置筛选" : "补充菜品"}</Button>
                {appliedSearchKeyword && (selectedCampus || selectedCanteen || floorName || selectedWindow) && (
                  <Button className='campus-school-search-button' onClick={searchWholeSchool}>搜索全校</Button>
                )}
              </View>
            ) : (
              <View className='campus-meal-grid'>{visibleList.map(renderCampusCard)}</View>
            )}
          </View>
        </ScrollView>

        <SchoolPicker
          visible={showSchoolPicker}
          value={selectedSchool?.id}
          onSelect={(school) => {
            schoolChosenByUser.current = true;
            setSelectedSchool(school);
            setSelectedCampus(null);
            setSelectedCanteen(null);
            setSelectedWindow(null);
            setShowSchoolPicker(false);
            setFloorName("");
            setWindowName("");
            setDirectoryExpanded(false);
          }}
          onCancel={() => setShowSchoolPicker(false)}
        />
        <CampusPicker
          visible={showCampusPicker}
          school={selectedSchool}
          value={selectedCampus?.id}
          onSelect={(campus) => {
            setSelectedCampus(campus);
            setSelectedCanteen(null);
            setSelectedWindow(null);
            setFloorName("");
            setWindowName("");
            setShowCampusPicker(false);
            setDirectoryExpanded(false);
          }}
          onCancel={() => setShowCampusPicker(false)}
        />
        <CanteenPicker
          visible={showCanteenPicker}
          school={selectedSchool}
          campus={selectedCampus}
          value={selectedCanteen?.id}
          onSelect={({ campus, canteen }) => {
            setSelectedCampus(campus);
            setSelectedCanteen(canteen);
            setSelectedWindow(null);
            setFloorName("");
            setWindowName("");
            setShowCanteenPicker(false);
            setDirectoryExpanded(false);
          }}
          onCancel={() => setShowCanteenPicker(false)}
        />
        <FloorPicker visible={showFloorPicker} canteen={selectedCanteen} value={floorName} onSelect={(floor) => { setFloorName(floor); setWindowName(''); setSelectedWindow(null); setShowFloorPicker(false); }} onCancel={() => setShowFloorPicker(false)} />
        <WindowPicker visible={showWindowPicker} canteen={selectedCanteen} floor={floorName} value={selectedWindow?.id} onSelect={(window) => { setSelectedWindow(window); setWindowName(window.name); setFloorName(window.floor || floorName); setShowWindowPicker(false); }} onCancel={() => setShowWindowPicker(false)} />
      </View>
    </FlPageThemeRoot>
  );
}

export default withAuth(CampusCanteenPage);
