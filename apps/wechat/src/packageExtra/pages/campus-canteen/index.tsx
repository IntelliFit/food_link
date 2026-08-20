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
  getMyMembership,
  getPublicFoodLibraryList,
  getSchoolCampuses,
  getSchoolCanteens,
  showUnifiedApiError,
  submitStructuredFeedback,
  type FeedbackSource,
  type MembershipStatus,
  type PublicFoodLibraryItem,
  type CanteenWindowItem,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
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
import CampusMembershipGate from "../../../components/CampusMembershipGate";
import { CAFETERIA_HERO_BG_URL } from "../../../utils/static-asset-cdn-url";

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

function getCampusTags(item: PublicFoodLibraryItem): string[] {
  if (isAnalyzingItem(item)) return ["正在分析中"];
  if (isAnalysisFailedItem(item)) return ["分析失败"];
  const tags: string[] = [];
  if (item.total_protein >= 25) tags.push("高蛋白");
  if (item.total_calories > 0 && item.total_calories <= 450)
    tags.push("低热量");
  if (item.suitable_for_fat_loss) tags.push("减脂友好");
  if (!item.price || item.price <= 0) tags.push("价格待补充");
  return tags.slice(0, 3);
}

function isAnalyzingItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeText(item.analysis_status);
  return status === "pending" || status === "processing";
}

function isAnalysisFailedItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeText(item.analysis_status);
  return status === "failed" || status === "timed_out";
}

function hasNutrition(item: PublicFoodLibraryItem): boolean {
  const items = item.items || [];
  return (
    (item.total_calories || 0) > 0 ||
    (item.total_protein || 0) > 0 ||
    items.some((food) => {
      const nutrients = food.nutrients;
      return (
        !!nutrients &&
        ((nutrients.calories || 0) > 0 || (nutrients.protein || 0) > 0)
      );
    })
  );
}

function needsNutritionUpdate(item: PublicFoodLibraryItem): boolean {
  return (
    !isAnalyzingItem(item) && !isAnalysisFailedItem(item) && !hasNutrition(item)
  );
}

function isClientReadyCampusItem(item: PublicFoodLibraryItem): boolean {
  const publicationStatus = normalizeText(item.status);
  if (publicationStatus && publicationStatus !== "published") return false;
  return !isAnalyzingItem(item) && !isAnalysisFailedItem(item) && hasNutrition(item);
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
  const [searchKeyword, setSearchKeyword] = useState("");
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
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshTime = useRef<number>(0);
  const isCampusMember = !!membershipStatus?.is_pro;

  const loadMembership = useCallback(async (forceRefresh = false) => {
    if (!getAccessToken()) {
      setMembershipStatus(null);
      return;
    }
    setMembershipLoading(true);
    try {
      const membership = await getMyMembership(undefined, { forceRefresh });
      setMembershipStatus(membership);
    } catch (e) {
      console.error("获取校园食堂会员状态失败:", e);
      setMembershipStatus(null);
    } finally {
      setMembershipLoading(false);
    }
  }, []);

  const fetchReadyCampusItems = useCallback(
    async (merchantName?: string) => {
      const directoryFilter = selectedCanteen?.id
        ? { canteen_id: selectedCanteen.id }
        : selectedCampus?.id
          ? { campus_id: selectedCampus.id }
          : selectedSchool?.id
            ? { school_id: selectedSchool.id }
            : {};
      const request = {
        type: "campus" as const,
        ...directoryFilter,
        merchant_name: merchantName,
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
    [sortBy, selectedSchool, selectedCampus, selectedCanteen],
  );

  const loadList = useCallback(
    async (silent = false, force = false) => {
      if (!getAccessToken()) return;
      if (!membershipStatus?.is_pro) return;
      const now = Date.now();
      if (!force && now - lastRefreshTime.current < 30000) return;
      if (!silent) setLoading(true);
      try {
        setList(await fetchReadyCampusItems());
        lastRefreshTime.current = Date.now();
      } catch (e: any) {
        console.error("加载校园食堂失败:", e);
        if (!silent) {
          await showUnifiedApiError(e, "获取列表失败");
        }
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [
      fetchReadyCampusItems,
      membershipStatus?.is_pro,
    ],
  );

  useDidShow(() => {
    applyThemeNavigationBar(scheme);
    const hasToken = !!getAccessToken();
    setLoggedIn(hasToken);
    if (!hasToken) {
      setMembershipStatus(null);
      return;
    }
    loadMembership(true);
  });

  useEffect(() => {
    applyThemeNavigationBar(scheme);
  }, [scheme]);

  useEffect(() => {
    if (loggedIn && isCampusMember) {
      loadList(false, true);
    }
  }, [
    loggedIn,
    isCampusMember,
    sortBy,
    selectedSchool,
    selectedCampus,
    selectedCanteen,
  ]);

  useEffect(() => {
    let cancelled = false;
    const schoolId = selectedSchool?.id;
    if (!loggedIn || !isCampusMember || !schoolId) {
      setDirectoryCampuses([]);
      setDirectoryCanteens([]);
      setDirectoryLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setDirectoryLoading(true);
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
        await showUnifiedApiError(e, "获取食堂目录失败");
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isCampusMember, loggedIn, selectedSchool?.id]);

  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    loadList(false, true);
  }, [loadList]);

  const handleSearch = () => {
    // 校园食堂列表中搜索：复用 merchant_name 参数做食物名搜索
    const kw = searchKeyword.trim();
    if (!isCampusMember) return;
    if (!kw) {
      loadList(false, true);
      return;
    }
    setLoading(true);
    fetchReadyCampusItems(kw)
      .then((items) => {
        setList(items);
      })
      .catch(async (e: any) => {
        await showUnifiedApiError(e, "搜索失败");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleLocationFeedback = async () => {
    if (!isCampusMember) return;
    const modalResult = await Taro.showModal({
      title: "校区/食堂信息纠错",
      content: "",
      editable: true,
      placeholderText: "请说明学校、校区或食堂信息哪里不对，我们会尽快核实…",
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
    Taro.showLoading({ title: "提交中...", mask: true });
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

  const goDetail = (itemId: string) => {
    Taro.navigateTo({
      url: `${extraPkgUrl("/pages/food-library-detail/index")}?id=${itemId}&scene=campus`,
    });
  };

  const goUpload = () => {
    if (!isCampusMember) {
      Taro.navigateTo({
        url: `${extraPkgUrl("/pages/pro-membership/index")}?source=campus_canteen`,
      });
      return;
    }
    Taro.navigateTo({ url: extraPkgUrl("/pages/campus-food-share/index") });
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
    if (isAnalyzingItem(item)) {
      Taro.showToast({ title: "营养信息分析中", icon: "none" });
      return;
    }
    if (isAnalysisFailedItem(item)) {
      Taro.showToast({ title: "分析失败，暂不能记录", icon: "none" });
      return;
    }
    if (needsNutritionUpdate(item)) {
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
  const visibleList = useMemo(() => {
    const floorKeyword = normalizeText(floorName);
    const windowKeyword = normalizeText(windowName);
    return list.filter((item) => {
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
  }, [floorName, list, windowName]);
  const visibleDirectoryCanteens = useMemo(
    () =>
      selectedCampus?.id
        ? directoryCanteens.filter(
            (canteen) => canteen.campus_id === selectedCampus.id,
          )
        : directoryCanteens,
    [directoryCanteens, selectedCampus?.id],
  );
  const publishedCanteenIds = useMemo(
    () => new Set(list.map((item) => item.canteen_id).filter(Boolean)),
    [list],
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
  };

  const analyzedList = useMemo(
    () => visibleList.filter(hasNutrition),
    [visibleList],
  );
  const hotItems = useMemo(() => analyzedList.slice(0, 6), [analyzedList]);
  const highProteinItems = useMemo(
    () =>
      [...analyzedList]
        .sort((a, b) => (b.total_protein || 0) - (a.total_protein || 0))
        .slice(0, 6),
    [analyzedList],
  );
  const lowCalorieItems = useMemo(
    () =>
      [...analyzedList]
        .filter((item) => item.total_calories > 0)
        .sort((a, b) => a.total_calories - b.total_calories)
        .slice(0, 6),
    [analyzedList],
  );
  const valueItems = useMemo(
    () =>
      [...analyzedList]
        .filter(
          (item) => item.price && item.price > 0 && item.total_protein > 0,
        )
        .sort(
          (a, b) =>
            (b.total_protein || 0) / (b.price || 1) -
            (a.total_protein || 0) / (a.price || 1),
        )
        .slice(0, 6),
    [analyzedList],
  );

  const renderMiniCard = (item: PublicFoodLibraryItem) => (
    <View
      key={item.id}
      className='recommend-card'
      onClick={() => goDetail(item.id)}
    >
      {item.image_path ? (
        <Image
          className='recommend-card-image'
          src={item.image_path}
          mode='aspectFill'
        />
      ) : (
        <View className='recommend-card-image placeholder'>暂无图片</View>
      )}
      <Text className='recommend-card-title'>
        {item.food_name || "未命名菜品"}
      </Text>
      <Text className='recommend-card-meta'>
        {getPriceText(item)} · 蛋白 {item.total_protein.toFixed(0)}g
      </Text>
    </View>
  );

  const renderCampusCard = (item: PublicFoodLibraryItem) => {
    const analyzing = isAnalyzingItem(item);
    const failed = isAnalysisFailedItem(item);
    const nutritionPending = needsNutritionUpdate(item);
    return (
      <View
        key={item.id}
        className={`campus-card ${analyzing || nutritionPending ? "campus-card--analyzing" : ""} ${failed ? "campus-card--failed" : ""}`}
        onClick={() => goDetail(item.id)}
      >
        <View className='campus-card-main'>
          <View className='campus-image-wrap'>
            {item.image_path ? (
              <Image
                className='campus-image'
                src={item.image_path}
                mode='aspectFill'
              />
            ) : (
              <View className='campus-image-placeholder'>暂无图片</View>
            )}
          </View>
          <View className='campus-info'>
            <Text className='campus-title'>
              {item.food_name || "未命名菜品"}
            </Text>
            <View className='campus-location-row'>
              <Text className='iconfont icon-dizhi campus-location-icon' />
              <Text className='campus-location'>
                {getLocationText(item) || selectedSchoolName}
              </Text>
            </View>
            <View className='campus-nutrition-row'>
              <Text className='campus-price'>{getPriceText(item)}</Text>
              {analyzing ? (
                <Text className='campus-analysis-text'>正在分析中</Text>
              ) : failed ? (
                <Text className='campus-analysis-failed'>
                  分析失败，稍后重试
                </Text>
              ) : nutritionPending ? (
                <Text className='campus-analysis-text'>营养待更新</Text>
              ) : (
                <View className='campus-calorie-badge'>
                  <Text className='campus-calorie-num'>
                    {item.total_calories.toFixed(0)}
                  </Text>
                  <Text className='campus-calorie-unit'>kcal</Text>
                </View>
              )}
            </View>
            <View className='campus-tags'>
              {getCampusTags(item).map((tag) => (
                <Text
                  key={tag}
                  className={`campus-tag ${tag === "减脂友好" ? "fat-loss" : ""}`}
                >
                  {tag}
                </Text>
              ))}
            </View>
          </View>
        </View>
        <View className='campus-card-footer'>
          <View className='campus-author-row'>
            {item.author?.avatar ? (
              <View
                className='campus-author-avatar'
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.author?.id) {
                    Taro.navigateTo({
                      url: extraPkgUrl(
                        `/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`,
                      ),
                    });
                  }
                }}
              >
                <Image
                  className='campus-author-avatar-img'
                  src={item.author.avatar}
                  mode='aspectFill'
                />
              </View>
            ) : (
              <View className='campus-author-avatar'>
                <Text className='iconfont icon-user campus-author-avatar-icon' />
              </View>
            )}
            <Text
              className='campus-author-name'
              onClick={(e) => {
                e.stopPropagation();
                if (item.author?.id) {
                  Taro.navigateTo({
                    url: extraPkgUrl(
                      `/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`,
                    ),
                  });
                }
              }}
            >
              {item.author?.nickname || "用户"}
            </Text>
          </View>
          <View className='campus-actions'>
            <View className='campus-stat'>
              <Text
                className={`iconfont ${item.liked ? "icon-like_fill" : "icon-like"} campus-like-btn ${item.liked ? "liked" : ""}`}
              />
              <Text className='stat-count'>{item.like_count}</Text>
            </View>
            <View className='campus-stat'>
              <View className='campus-comment-btn'>
                <Text className='stat-icon iconfont icon-comment' />
              </View>
              {(item.comment_count || 0) > 0 && (
                <Text className='stat-count'>{item.comment_count}</Text>
              )}
            </View>
            <View
              className='campus-record-btn'
              onClick={(e) => quickRecord(e, item)}
            >
              <Text className='campus-record-btn-text'>
                {analyzing || nutritionPending ? "待更新" : "一键记录"}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (!loggedIn) {
    return (
      <FlPageThemeRoot>
        <View className='campus-canteen-page'>
          <View className='login-tip'>
            <Text className='login-tip-text'>登录后查看校园食堂</Text>
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

  if (membershipLoading) {
    return (
      <FlPageThemeRoot>
        <CampusMembershipGate loading />
      </FlPageThemeRoot>
    );
  }

  if (!isCampusMember) {
    return (
      <FlPageThemeRoot>
        <CampusMembershipGate />
      </FlPageThemeRoot>
    );
  }

  return (
    <FlPageThemeRoot>
      <View className='campus-canteen-page'>
        <View className='campus-hero'>
          <Image
            className='campus-hero-bg'
            src={CAFETERIA_HERO_BG_URL}
            mode='aspectFill'
          />
          <View>
            <Text className='campus-hero-eyebrow'>食探校园活动</Text>
            <Text className='campus-hero-title'>食探校园食堂计划</Text>
            <Text className='campus-hero-subtitle'>
              按你所在省份选择高校，一起补全食堂菜品价格、位置和营养信息
            </Text>
          </View>
          <View className='campus-hero-upload' onClick={goUpload}>
            <Text className='campus-hero-upload-text'>补充菜品</Text>
          </View>
        </View>

        {/* 头部筛选区 */}
        <View className='campus-header'>
          <View className='filter-row filter-row--equal'>
            <View
              className='filter-chip filter-chip--entity'
              onClick={() => setShowSchoolPicker(true)}
            >
              <Text className='filter-chip-text'>
                {selectedSchool?.name || "选择学校"}
              </Text>
              <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
            </View>
            <View className='filter-chip filter-chip--area' onClick={openCampusPicker}>
              <Text className='filter-chip-text'>
                {selectedCampus?.name || "选择校区"}
              </Text>
              <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
            </View>
          </View>
          <View className='filter-row filter-row--equal'>
            <View className='filter-chip' onClick={openCanteenPicker}>
              <Text className='filter-chip-text'>
                {selectedCanteen?.name || "选择食堂"}
              </Text>
              <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
            </View>
            <View className='filter-chip' onClick={() => selectedCanteen?.id ? setShowFloorPicker(true) : Taro.showToast({ title: '请先选择食堂', icon: 'none' })}>
              <Text className='filter-chip-text'>{floorName || '选择楼层'}</Text>
              <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
            </View>
            <View className='filter-chip' onClick={() => !selectedCanteen?.id ? Taro.showToast({ title: '请先选择食堂', icon: 'none' }) : !floorName ? Taro.showToast({ title: '请先选择楼层', icon: 'none' }) : setShowWindowPicker(true)}>
              <Text className='filter-chip-text'>{windowName || '选择窗口'}</Text>
              <Text className='iconfont icon-xiajiantou filter-chip-arrow' />
            </View>
          </View>
          <View className='search-row'>
            <View className='search-input-wrap'>
              <Text className='search-input-icon iconfont icon-sousuo' />
              <Input
                className='search-input'
                placeholder='搜索菜名'
                value={searchKeyword}
                onInput={(e) => setSearchKeyword(e.detail.value)}
                onConfirm={handleSearch}
              />
            </View>
            <Button className='search-btn' onClick={handleSearch}>
              搜索
            </Button>
          </View>
          <View className='campus-feedback-row' onClick={() => void handleLocationFeedback()}>
            <Text className='iconfont icon-edit campus-feedback-icon' />
            <Text className='campus-feedback-text'>学校、校区或食堂信息有误？点击反馈</Text>
          </View>
        </View>

        {/* 排序区 */}
        <View className='sort-section'>
          <View
            className={`sort-item ${sortBy === "hot" ? "active" : ""}`}
            onClick={() => setSortBy("hot")}
          >
            热门
          </View>
          <View
            className={`sort-item ${sortBy === "high_protein" ? "active" : ""}`}
            onClick={() => setSortBy("high_protein")}
          >
            高蛋白
          </View>
          <View
            className={`sort-item ${sortBy === "low_calorie" ? "active" : ""}`}
            onClick={() => setSortBy("low_calorie")}
          >
            低热量
          </View>
          <View
            className={`sort-item ${sortBy === "value" ? "active" : ""}`}
            onClick={() => setSortBy("value")}
          >
            性价比
          </View>
        </View>

        {/* 列表 */}
        <ScrollView
          className='list-scroll'
          scrollY
          enhanced
          showScrollbar={false}
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresherRefresh}
          refresherDefaultStyle='black'
        >
          <View className='list-content'>
            {selectedSchool && (
              <View className='campus-directory-section'>
                <View className='section-head campus-directory-head'>
                  <Text className='section-title'>已收录食堂</Text>
                  <Text className='section-subtitle'>
                    {selectedSchool.name} · {visibleDirectoryCanteens.length} 个
                  </Text>
                </View>
                {directoryLoading ? (
                  <View className='campus-directory-loading'>
                    <View className='loading-spinner-md' />
                  </View>
                ) : visibleDirectoryCanteens.length === 0 ? (
                  <View className='campus-directory-empty'>
                    该学校暂无已审核食堂
                  </View>
                ) : (
                  <ScrollView
                    scrollX
                    enhanced
                    showScrollbar={false}
                    className='campus-directory-scroll'
                  >
                    <View className='campus-directory-list'>
                      {visibleDirectoryCanteens.map((canteen) => {
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
                        const hasPublishedDish = publishedCanteenIds.has(
                          canteen.id,
                        );
                        const isSelected = selectedCanteen?.id === canteen.id;
                        return (
                          <View
                            key={canteen.id}
                            className={`campus-directory-card ${isSelected ? "active" : ""}`}
                            onClick={() => selectDirectoryCanteen(canteen)}
                          >
                            <View className='campus-directory-card-top'>
                              <Text className='campus-directory-name'>
                                {canteen.name}
                              </Text>
                              {!hasPublishedDish && (
                                <Text className='campus-directory-badge'>
                                  待补菜品
                                </Text>
                              )}
                            </View>
                            <Text className='campus-directory-location'>
                              {locationText || "位置待补充"}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                )}
              </View>
            )}

            {analyzedList.length > 0 && (
              <>
                <View className='section-block'>
                  <View className='section-head'>
                    <Text className='section-title'>热门菜品</Text>
                    <Text className='section-subtitle'>
                      按收藏、点赞和发布时间排序
                    </Text>
                  </View>
                  <ScrollView
                    scrollX
                    enhanced
                    showScrollbar={false}
                    className='recommend-scroll'
                  >
                    <View className='recommend-list'>
                      {hotItems.map(renderMiniCard)}
                    </View>
                  </ScrollView>
                </View>
                <View className='section-block'>
                  <View className='section-head'>
                    <Text className='section-title'>高蛋白推荐</Text>
                    <Text className='section-subtitle'>
                      适合训练后或想吃扎实一点
                    </Text>
                  </View>
                  <ScrollView
                    scrollX
                    enhanced
                    showScrollbar={false}
                    className='recommend-scroll'
                  >
                    <View className='recommend-list'>
                      {highProteinItems.map(renderMiniCard)}
                    </View>
                  </ScrollView>
                </View>
                <View className='recommend-grid'>
                  <View className='recommend-panel'>
                    <Text className='recommend-panel-title'>低热量推荐</Text>
                    {lowCalorieItems.slice(0, 3).map((item) => (
                      <Text
                        key={item.id}
                        className='recommend-panel-line'
                        onClick={() => goDetail(item.id)}
                      >
                        {item.food_name} · {item.total_calories.toFixed(0)} kcal
                      </Text>
                    ))}
                  </View>
                  <View className='recommend-panel'>
                    <Text className='recommend-panel-title'>性价比推荐</Text>
                    {valueItems.slice(0, 3).map((item) => (
                      <Text
                        key={item.id}
                        className='recommend-panel-line'
                        onClick={() => goDetail(item.id)}
                      >
                        {item.food_name} ·{" "}
                        {(item.total_protein / (item.price || 1)).toFixed(1)}
                        g/元
                      </Text>
                    ))}
                  </View>
                </View>
              </>
            )}

            <View className='section-head all-list-head'>
              <Text className='section-title'>全部校园菜品</Text>
              <Text className='section-subtitle'>
                {[
                  selectedSchool?.name || "全部高校",
                  selectedCampus?.name,
                  selectedCanteen?.name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            {loading && visibleList.length === 0 ? (
              <View className='loading-state'>
                <View className='loading-spinner-md' />
              </View>
            ) : visibleList.length === 0 ? (
              <View className='empty-state'>
                <Text className='empty-icon iconfont icon-shiwu' />
                <Text className='empty-text'>
                  {selectedSchool && directoryCanteens.length > 0
                    ? "该食堂目录已上线，暂无已分析菜品"
                    : "暂无校园食堂数据"}
                </Text>
                <Text className='empty-subtext'>
                  {selectedSchool && directoryCanteens.length > 0
                    ? "可以补充第一份菜品，AI 分析后会在这里显示"
                    : "快来上传第一份食堂菜品吧"}
                </Text>
                <View className='empty-btn' onClick={goUpload}>
                  去上传
                </View>
              </View>
            ) : (
              visibleList.map(renderCampusCard)
            )}
          </View>
        </ScrollView>

        {/* 浮动上传按钮 */}
        <View className='fab-button' onClick={goUpload}>
          <Text className='fab-icon'>+</Text>
        </View>

        <SchoolPicker
          visible={showSchoolPicker}
          onSelect={(school) => {
            setSelectedSchool(school);
            setSelectedCampus(null);
            setSelectedCanteen(null);
            setSelectedWindow(null);
            setShowSchoolPicker(false);
            setFloorName("");
            setWindowName("");
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
