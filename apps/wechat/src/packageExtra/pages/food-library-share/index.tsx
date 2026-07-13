import { withAuth } from "../../../utils/withAuth";
import {
  View,
  Text,
  ScrollView,
  Image,
  Input,
  Textarea,
  Picker,
} from "@tarojs/components";
import { useState, useEffect } from "react";
import Taro from "@tarojs/taro";
import { useAppColorScheme } from "../../../components/AppColorSchemeContext";
import { Popup, AreaPicker } from "@taroify/core";
import "@taroify/core/popup/style";
import "@taroify/core/picker/style";
import { areaList } from "@vant/area-data";
import {
  getFoodRecordList,
  getFoodRecordById,
  createPublicFoodLibraryItem,
  getMyMembership,
  getPublicFoodLibraryItem,
  uploadAnalyzeImage,
  analyzeFoodImage,
  imageToBase64,
  resolveCurrentGeoContext,
  showUnifiedApiError,
  type CreatePublicFoodLibraryRequest,
  type FoodRecord,
  type MembershipStatus,
  type Nutrients,
  type PublicFoodLibraryItem,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
  updatePublicFoodLibraryItem,
} from "../../../utils/api";
import "./index.scss";
import { extraPkgUrl } from "../../../utils/subpackage-extra";
import {
  chooseImageWithPrivacy,
  isPrivacyAuthorizeError,
  showPrivacyAuthorizeFailure,
} from "../../../utils/weapp-privacy";
import { formatMacroNutrient } from "../../../utils/number-format";
import SchoolPicker from "../../../components/SchoolPicker";
import CampusPicker from "../../../components/CampusPicker";
import CanteenPicker from "../../../components/CanteenPicker";
import CampusMembershipGate from "../../../components/CampusMembershipGate";

const QUICK_TAGS = [
  "少油",
  "少盐",
  "高蛋白",
  "低碳水",
  "清淡",
  "外卖",
  "健身餐",
];
const FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY = "foodLibraryQuickUploadDraft";

const PRICE_TYPE_OPTIONS = ["fixed", "weight", "range", "combo", "unknown"];
const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "固定价格",
  weight: "称重计价",
  range: "价格区间",
  combo: "套餐价格",
  unknown: "未知",
};

type QuickUploadDraft = {
  imageUrls?: string[];
  description?: string;
  insight?: string;
  totalCalories?: number;
  totalProtein?: number;
  totalCarbs?: number;
  totalFat?: number;
  items?: Array<{ name: string; weight?: number; nutrients?: Nutrients }>;
};

// 城市区域数据（示例）

function FoodLibrarySharePage() {
  const routerParams = Taro.getCurrentInstance().router?.params;
  const sourceRecordId = routerParams?.source_record_id;
  const quickUploadMode = routerParams?.quick_upload === "1";
  const campusMode = routerParams?.campus_mode === "1";
  const editId = routerParams?.edit_id || "";
  const isEditMode = Boolean(editId);

  // 选择来源：record（从记录分享）或 upload（直接上传）
  const [sourceType, setSourceType] = useState<"record" | "upload">("upload");
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [records, setRecords] = useState<FoodRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<FoodRecord | null>(null);
  const [loadingSourceRecord, setLoadingSourceRecord] = useState(false);

  // 图片：最多 3 张，每张单独 AI 识别后叠加营养数据
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState(""); // 首图 URL，用于识别与提交
  const [totalCalories, setTotalCalories] = useState(0);
  const [totalProtein, setTotalProtein] = useState(0);
  const [totalCarbs, setTotalCarbs] = useState(0);
  const [totalFat, setTotalFat] = useState(0);
  const [items, setItems] = useState<
    Array<{ name: string; weight?: number; nutrients?: Nutrients }>
  >([]);
  const [description, setDescription] = useState("");
  const [insight, setInsight] = useState("");
  // 缓存每张图片的识别结果，避免重复识别
  const [analyzeResultsMap, setAnalyzeResultsMap] = useState<
    Record<string, Awaited<ReturnType<typeof analyzeFoodImage>>>
  >({});

  // 商家信息
  const [foodName, setFoodName] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [tasteRating, setTasteRating] = useState(0);

  // 标签
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(false);
  const [isHomemade, setIsHomemade] = useState(false);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");

  // 备注
  const [userNotes, setUserNotes] = useState("");

  // 位置
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);

  // 城市选择器
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);

  // 校园食堂信息
  const [isCampusFood, setIsCampusFood] = useState(campusMode);
  const [schoolId, setSchoolId] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolItem | null>(null);
  const [selectedCampus, setSelectedCampus] = useState<SchoolCampusItem | null>(
    null,
  );
  const [selectedCanteen, setSelectedCanteen] =
    useState<SchoolCanteenItem | null>(null);
  const [canteenName, setCanteenName] = useState("");
  const [floor, setFloor] = useState("");
  const [showSchoolPicker, setShowSchoolPicker] = useState(false);
  const [showCampusPicker, setShowCampusPicker] = useState(false);
  const [showCanteenPicker, setShowCanteenPicker] = useState(false);
  const [windowName, setWindowName] = useState("");
  const [price, setPrice] = useState("");
  const [priceType, setPriceType] = useState("fixed");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [priceUnit, setPriceUnit] = useState("元/份");
  const [priceCollectedAt, setPriceCollectedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [portionDescription, setPortionDescription] = useState("");

  // 提交状态
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [locatingHomemadeCity, setLocatingHomemadeCity] = useState(false);
  const isCampusMember = !!membershipStatus?.is_pro;

  // 加载最近记录
  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    setMembershipLoading(true);
    getMyMembership()
      .then(setMembershipStatus)
      .catch((e) => {
        console.error("获取公共库分享会员状态失败:", e);
        setMembershipStatus(null);
      })
      .finally(() => setMembershipLoading(false));
  }, []);

  useEffect(() => {
    if (!sourceRecordId) return;

    const initSourceRecord = async () => {
      setSourceType("record");
      setLoadingSourceRecord(true);
      try {
        const { record } = await getFoodRecordById(sourceRecordId);
        handleSelectRecord(record);
      } catch (e: any) {
        console.error("加载来源记录失败:", e);
        await showUnifiedApiError(e, "加载识别结果失败");
      } finally {
        setLoadingSourceRecord(false);
      }
    };

    initSourceRecord();
  }, [sourceRecordId]);

  useEffect(() => {
    if (!quickUploadMode || sourceRecordId) return;

    try {
      const raw = Taro.getStorageSync(FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY);
      if (!raw) return;

      const draft = (
        typeof raw === "string" ? JSON.parse(raw) : raw
      ) as QuickUploadDraft;
      const urls = Array.isArray(draft?.imageUrls)
        ? draft.imageUrls.map((item) => `${item || ""}`.trim()).filter(Boolean)
        : [];

      if (urls.length > 0) {
        setSourceType("upload");
        setSelectedRecord(null);
        setImagePaths([]);
        setImageUrls(urls);
        setImageUrl(urls[0] || "");
      }

      setTotalCalories(Number(draft?.totalCalories) || 0);
      setTotalProtein(Number(draft?.totalProtein) || 0);
      setTotalCarbs(Number(draft?.totalCarbs) || 0);
      setTotalFat(Number(draft?.totalFat) || 0);
      setItems(Array.isArray(draft?.items) ? draft.items : []);
      setDescription(draft?.description || "");
      setInsight(draft?.insight || "");

      const inferredName = inferFoodName(
        null,
        draft?.items || [],
        draft?.description || "",
      );
      if (inferredName) {
        setFoodName((prev) => prev.trim() || inferredName);
      }
    } catch (e) {
      console.error("加载公共库快捷上传草稿失败:", e);
    } finally {
      Taro.removeStorageSync(FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY);
    }
  }, [quickUploadMode, sourceRecordId]);

  // 从识别记录分享：自动填充 analyzeShareData
  useEffect(() => {
    if (routerParams?.from_analyze !== "1") return;

    try {
      const raw = Taro.getStorageSync("analyzeShareData");
      if (!raw) return;

      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      const urls = Array.isArray(data?.imageUrls)
        ? data.imageUrls
            .map((item: string) => `${item || ""}`.trim())
            .filter(Boolean)
        : data?.imageUrl
          ? [data.imageUrl]
          : [];

      if (urls.length > 0) {
        setSourceType("upload");
        setSelectedRecord(null);
        setImagePaths([]);
        setImageUrls(urls);
        setImageUrl(urls[0] || "");
      }

      setTotalCalories(Number(data?.totalCalories) || 0);
      setTotalProtein(Number(data?.totalProtein) || 0);
      setTotalCarbs(Number(data?.totalCarbs) || 0);
      setTotalFat(Number(data?.totalFat) || 0);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setDescription(data?.description || "");
      setInsight(data?.insight || "");

      const inferredName = inferFoodName(
        null,
        data?.items || [],
        data?.description || "",
      );
      if (inferredName) {
        setFoodName((prev) => prev.trim() || inferredName);
      }
    } catch (e) {
      console.error("加载识别记录分享数据失败:", e);
    } finally {
      Taro.removeStorageSync("analyzeShareData");
    }
  }, [routerParams?.from_analyze]);

  // 校园模式默认值
  useEffect(() => {
    if (isCampusFood) {
      if (!priceUnit) setPriceUnit("元/份");
      if (!priceType) setPriceType("fixed");
    }
  }, [isCampusFood, priceType, priceUnit]);

  // 编辑模式：加载已有数据回填
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    Taro.showLoading({ title: "加载中...", mask: true });
    getPublicFoodLibraryItem(editId)
      .then((data: PublicFoodLibraryItem) => {
        if (cancelled) return;
        if (data.type === "campus" || data.is_campus_food) {
          Taro.hideLoading();
          Taro.redirectTo({
            url: `${extraPkgUrl("/pages/campus-food-share/index")}?edit_id=${editId}`,
          });
          return;
        }
        const imgs =
          data.image_paths && data.image_paths.length > 0
            ? data.image_paths
            : data.image_path
              ? [data.image_path]
              : [];
        setSourceType("upload");
        setSelectedRecord(null);
        setImagePaths([]);
        setImageUrls(imgs);
        setImageUrl(imgs[0] || "");
        setFoodName(data.food_name || "");
        setDescription(data.description || "");
        setInsight(data.insight || "");
        setTotalCalories(data.total_calories || 0);
        setTotalProtein(data.total_protein || 0);
        setTotalCarbs(data.total_carbs || 0);
        setTotalFat(data.total_fat || 0);
        setItems(
          Array.isArray(data.items)
            ? data.items.map((it: any) => ({
                name: it.name || "",
                weight: it.weight,
                nutrients: it.nutrients,
              }))
            : [],
        );
        setMerchantName(data.merchant_name || "");
        setTasteRating(data.taste_rating || 0);
        setSuitableForFatLoss(data.suitable_for_fat_loss);
        setUserTags(data.user_tags || []);
        setUserNotes(data.user_notes || "");
        setProvince(data.province || "");
        setCity(data.city || "");
        setDistrict(data.district || "");
        setDetailAddress(data.detail_address || "");
        if (data.latitude) setLatitude(data.latitude);
        if (data.longitude) setLongitude(data.longitude);
      })
      .catch(async (e: any) => {
        if (cancelled) return;
        await showUnifiedApiError(e, "加载失败");
      })
      .finally(() => {
        if (!cancelled) Taro.hideLoading();
      });
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const fillHomemadeCityFromLocation = async () => {
    if (province.trim() || city.trim() || locatingHomemadeCity) return;
    setLocatingHomemadeCity(true);
    try {
      const geo = await resolveCurrentGeoContext({
        requestAuthorization: true,
      });
      if (!geo?.province && !geo?.city) return;
      if (geo.province) setProvince(geo.province);
      if (geo.city) setCity(geo.city);
      if (geo.district) setDistrict(geo.district);
    } catch (e) {
      console.warn("获取自制餐食所在城市失败:", e);
    } finally {
      setLocatingHomemadeCity(false);
    }
  };

  const handleSetHomemade = (nextValue: boolean) => {
    setIsHomemade(nextValue);
    if (nextValue) {
      setMerchantName("");
      setDetailAddress("");
      setLatitude(undefined);
      setLongitude(undefined);
      void fillHomemadeCityFromLocation();
    }
  };

  const isLocationValid = () => {
    const hasProvince = !!province.trim();
    const hasCity = !!city.trim();
    if (isHomemade) {
      return true;
    }
    return (
      hasProvince &&
      hasCity &&
      !!district.trim() &&
      latitude != null &&
      longitude != null
    );
  };

  const inferFoodName = (
    record?: FoodRecord | null,
    nextItems?: Array<{ name: string }>,
    nextDescription?: string,
  ) => {
    const itemNames = (nextItems || record?.items || [])
      .map((item) => item.name?.trim())
      .filter(Boolean)
      .slice(0, 3) as string[];
    if (itemNames.length > 0) {
      return itemNames.join("、");
    }

    const desc = (nextDescription || record?.description || "").trim();
    if (desc) {
      return desc.slice(0, 20);
    }

    return "";
  };

  const loadRecords = async () => {
    try {
      const res = await getFoodRecordList();
      setRecords(res.records || []);
    } catch (e) {
      console.error("加载记录失败:", e);
    }
  };

  // 选择记录：优先使用多图 image_paths，否则用 image_path；后端会根据 source_record_id 从分析任务拉取多图
  const handleSelectRecord = (record: FoodRecord) => {
    setSelectedRecord(record);
    setImagePaths([]);
    const urls =
      record.image_paths && record.image_paths.length > 0
        ? record.image_paths.slice(0, MAX_IMAGES)
        : record.image_path
          ? [record.image_path]
          : [];
    setImageUrls(urls);
    setImageUrl(urls[0] || record.image_path || "");
    setTotalCalories(record.total_calories);
    setTotalProtein(record.total_protein);
    setTotalCarbs(record.total_carbs);
    setTotalFat(record.total_fat);
    setItems(record.items || []);
    setDescription(record.description || "");
    setInsight(record.insight || "");
    const inferredName = inferFoodName(record);
    if (inferredName) {
      setFoodName((prev) => prev.trim() || inferredName);
    }
    setAnalyzeResultsMap({}); // 清空识别缓存
    setShowRecordModal(false);
  };

  const MAX_IMAGES = 3;

  /** 根据缓存的识别结果聚合计算营养数据 */
  const aggregateFromMap = (
    urls: string[],
    resultsMap: Record<string, Awaited<ReturnType<typeof analyzeFoodImage>>>,
  ) => {
    if (urls.length === 0) {
      setDescription("");
      setInsight("");
      setItems([]);
      setTotalCalories(0);
      setTotalProtein(0);
      setTotalCarbs(0);
      setTotalFat(0);
      return;
    }
    const results = urls.map((url) => resultsMap[url]).filter(Boolean);
    const descriptions = results.map((r) => r.description).filter(Boolean);
    const insights = results.map((r) => r.insight).filter(Boolean);
    setDescription(descriptions.join("；"));
    setInsight(insights.join("；"));
    const allItems = results.flatMap((r) =>
      (r.items || []).map((it) => ({
        name: it.name,
        weight: it.estimatedWeightGrams,
        nutrients: it.nutrients,
      })),
    );
    setItems(allItems);
    let cal = 0;
    let pro = 0;
    let carb = 0;
    let fat = 0;
    results.forEach((r) => {
      (r.items || []).forEach((it) => {
        cal += it.nutrients?.calories || 0;
        pro += it.nutrients?.protein || 0;
        carb += it.nutrients?.carbs || 0;
        fat += it.nutrients?.fat || 0;
      });
    });
    setTotalCalories(cal);
    setTotalProtein(pro);
    setTotalCarbs(carb);
    setTotalFat(fat);
    const inferredName = inferFoodName(null, allItems, descriptions.join("；"));
    if (inferredName) {
      setFoodName((prev) => prev.trim() || inferredName);
    }
  };

  // 选择图片：最多 3 张，逐张上传后只识别新图片并叠加已有结果
  const handleChooseImage = async () => {
    const remain = MAX_IMAGES - imagePaths.length;
    if (remain <= 0) return;
    try {
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
      });
      const tempPaths = res.tempFilePaths || [];
      if (tempPaths.length === 0) return;
      setSelectedRecord(null);
      const prevPaths = imagePaths;
      const prevUrls = imageUrls;
      const prevResultsMap = analyzeResultsMap;
      setImagePaths((p) => [...p, ...tempPaths]);

      if (isEditMode) {
        // 编辑模式：仅上传图片，不触发 AI 识别，保留原有营养数据
        Taro.showLoading({ title: "上传中...", mask: true });
        try {
          const newUrls: string[] = [];
          for (let i = 0; i < tempPaths.length; i++) {
            const base64 = await imageToBase64(tempPaths[i]);
            const uploadRes = await uploadAnalyzeImage(base64);
            newUrls.push(uploadRes.imageUrl);
          }
          const allUrls = [...prevUrls, ...newUrls];
          setImageUrls(allUrls);
          setImageUrl(allUrls[0] || "");
          Taro.showToast({ title: "图片已更新", icon: "success" });
        } catch (e: any) {
          setImagePaths(prevPaths);
          setImageUrls(prevUrls);
          setImageUrl(prevUrls[0] || "");
          await showUnifiedApiError(e, "上传失败");
        } finally {
          Taro.hideLoading();
        }
        return;
      }

      setAnalyzing(true);
      Taro.showLoading({ title: "上传中...", mask: true });
      try {
        const newUrls: string[] = [];
        for (let i = 0; i < tempPaths.length; i++) {
          const base64 = await imageToBase64(tempPaths[i]);
          const uploadRes = await uploadAnalyzeImage(base64);
          newUrls.push(uploadRes.imageUrl);
        }
        const allUrls = [...prevUrls, ...newUrls];
        setImageUrls(allUrls);
        setImageUrl(allUrls[0] || "");
        Taro.hideLoading();

        // 只识别新上传的图片
        const newResultsMap = { ...prevResultsMap };
        for (let i = 0; i < newUrls.length; i++) {
          Taro.showLoading({
            title: `识别中 (${i + 1}/${newUrls.length})...`,
            mask: true,
          });
          const analyzeRes = await analyzeFoodImage({ image_url: newUrls[i] });
          newResultsMap[newUrls[i]] = analyzeRes;
        }
        setAnalyzeResultsMap(newResultsMap);
        aggregateFromMap(allUrls, newResultsMap);
        Taro.showToast({
          title:
            newUrls.length > 1
              ? `已识别 ${newUrls.length} 张并叠加`
              : "识别成功",
          icon: "success",
        });
      } catch (e: any) {
        setImagePaths(prevPaths);
        setImageUrls(prevUrls);
        setImageUrl(prevUrls[0] || "");
        setAnalyzeResultsMap(prevResultsMap);
        await showUnifiedApiError(e, "上传或识别失败");
      } finally {
        Taro.hideLoading();
        setAnalyzing(false);
      }
    } catch (e) {
      if ((e as any)?.errMsg?.includes("cancel")) return;
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e);
        return;
      }
      console.error("选择图片失败", e);
    }
  };

  /** 全屏预览已上传的图片 */
  const handlePreviewImage = (index: number) => {
    const len = Math.max(imagePaths.length, imageUrls.length);
    const urls = Array.from({ length: len })
      .map((_, i) => imageUrls[i] || imagePaths[i])
      .filter(Boolean) as string[];
    const current = urls[index];
    if (urls.length > 0 && current) {
      Taro.previewImage({ urls, current });
    }
  };

  const handleRemoveImage = (index: number) => {
    const removedUrl = imageUrls[index];
    const nextPaths = imagePaths.filter((_, i) => i !== index);
    const nextUrls = imageUrls.filter((_, i) => i !== index);
    setImagePaths(nextPaths);
    setImageUrls(nextUrls);
    setImageUrl(nextUrls[0] || "");
    setSelectedRecord(null);
    // 从缓存中移除对应结果
    const newResultsMap = { ...analyzeResultsMap };
    delete newResultsMap[removedUrl];
    setAnalyzeResultsMap(newResultsMap);
    aggregateFromMap(nextUrls, newResultsMap);
  };

  type SelectedLocation = {
    name?: string;
    address?: string;
    lonlat?: string;
    longitude?: number;
    latitude?: number;
    promptCity?: string;
  };

  const applySelectedLocation = (poi: SelectedLocation) => {
    const addr = (poi.address || "").trim();

    // 尝试从地址解析省、市、区
    const provinceMatch = addr.match(/^(.+?[省市])/);
    const cityMatch = addr.match(/^.+?[省](.+?市)/);
    const districtMatch = addr.match(/[市省](.+?[区县市])/);

    // 设置省份：优先从地址解析，兜底用 promptCity
    const nextProvince = (
      provinceMatch ? provinceMatch[1] : poi.promptCity || ""
    ).trim();
    setProvince(nextProvince);

    // 设置城市（如果是直辖市则不设置城市）
    if (
      nextProvince.includes("北京") ||
      nextProvince.includes("上海") ||
      nextProvince.includes("天津") ||
      nextProvince.includes("重庆")
    ) {
      setCity("");
    } else {
      setCity((cityMatch ? cityMatch[1] : "").trim());
    }

    // 解析区域
    const districtStr = districtMatch
      ? districtMatch[1].trim()
      : (() => {
          const districtOnly = addr.match(/^(.+?[区县市])/);
          return (districtOnly ? districtOnly[1] : "").trim();
        })();
    setDistrict(districtStr);

    // 详细地址：去掉省、市、区，只保留街道及门牌等
    const cityStr =
      nextProvince.includes("北京") ||
      nextProvince.includes("上海") ||
      nextProvince.includes("天津") ||
      nextProvince.includes("重庆")
        ? ""
        : cityMatch
          ? cityMatch[1].trim()
          : "";
    let detailOnly = addr;
    if (nextProvince && detailOnly.startsWith(nextProvince))
      detailOnly = detailOnly.slice(nextProvince.length).trim();
    if (cityStr && detailOnly.startsWith(cityStr))
      detailOnly = detailOnly.slice(cityStr.length).trim();
    if (districtStr && detailOnly.startsWith(districtStr))
      detailOnly = detailOnly.slice(districtStr.length).trim();
    const name = (poi.name || "").trim();
    const namePart = name && name !== "地图选点" ? name : "";
    const mergedDetail = [detailOnly, namePart]
      .filter(Boolean)
      .join(" ")
      .trim();
    setDetailAddress(mergedDetail);

    // 经纬度：优先用拆分 lonlat，其次用单独字段
    if (poi.lonlat) {
      const parts = poi.lonlat.split(",");
      if (parts.length === 2) {
        const a = Number(parts[0]);
        const b = Number(parts[1]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          setLongitude(a);
          setLatitude(b);
          return;
        }
      }
    }
    if (poi.longitude != null && poi.latitude != null) {
      setLongitude(poi.longitude);
      setLatitude(poi.latitude);
    }
  };

  const handleNavigateLocationSearch = () => {
    Taro.navigateTo({
      url: extraPkgUrl("/pages/location-search/index"),
      success: (res) => {
        res.eventChannel.on("locationSelected", (poi: SelectedLocation) => {
          applySelectedLocation(poi);
        });
      },
    });
  };

  // 添加标签
  const handleAddTag = () => {
    const tag = customTag.trim();
    if (!tag) return;
    if (userTags.includes(tag)) {
      Taro.showToast({ title: "标签已存在", icon: "none" });
      return;
    }
    setUserTags([...userTags, tag]);
    setCustomTag("");
  };

  // 切换快捷标签
  const toggleQuickTag = (tag: string) => {
    if (userTags.includes(tag)) {
      setUserTags(userTags.filter((t) => t !== tag));
    } else {
      setUserTags([...userTags, tag]);
    }
  };

  // 移除标签
  const removeTag = (tag: string) => {
    setUserTags(userTags.filter((t) => t !== tag));
  };

  const buildSubmitTags = () => {
    const baseTags = userTags.filter((tag) => tag !== "自制");
    return isHomemade ? [...baseTags, "自制"] : baseTags;
  };

  /** 点击提交：校验后弹窗确认，用户确认后再提交 */
  const handleSubmit = async () => {
    const hasImages =
      imageUrls.length > 0 || imageUrl || selectedRecord?.image_path;
    if (!hasImages) {
      Taro.showToast({ title: "请先选择或上传图片", icon: "none" });
      return;
    }
    const finalFoodName =
      foodName.trim() || inferFoodName(selectedRecord, items, description);
    if (!finalFoodName) {
      Taro.showToast({ title: "请填写食物名称", icon: "none" });
      return;
    }
    if (finalFoodName !== foodName.trim()) {
      setFoodName(finalFoodName);
    }
    if (isCampusFood) {
      if (!isCampusMember) {
        Taro.showToast({ title: "校园食堂为会员专属", icon: "none" });
        return;
      }
      if (!schoolName.trim()) {
        Taro.showToast({ title: "请选择学校", icon: "none" });
        return;
      }
      if (!selectedCampus?.id) {
        Taro.showToast({ title: "请选择校区", icon: "none" });
        return;
      }
      if (!selectedCanteen?.id) {
        Taro.showToast({ title: "请选择已审核食堂", icon: "none" });
        return;
      }
      if (priceType === "range") {
        const min = Number(priceMin);
        const max = Number(priceMax);
        if (
          !Number.isFinite(min) ||
          !Number.isFinite(max) ||
          min <= 0 ||
          max <= 0 ||
          min > max
        ) {
          Taro.showToast({ title: "请填写正确价格区间", icon: "none" });
          return;
        }
      }
    }
    if (!isCampusFood && !isLocationValid()) {
      Taro.showToast({ title: "请先补充完整商家位置", icon: "none" });
      return;
    }

    const { confirm } = await Taro.showModal({
      title: isEditMode ? "确认保存" : "确认提交",
      content: isEditMode
        ? "确定保存对这份食物的修改吗？"
        : isCampusFood
          ? "确定发布这份校园食堂菜品吗？提交后会自动出现在校园食堂分区。"
          : quickUploadMode
            ? "确定上传到公共食物库吗？审核通过后其他用户即可查看。"
            : "确定要将该食物分享到公共食物库吗？提交后需经系统审核，通过后其他用户可查看。",
      confirmText: isEditMode ? "保存" : "确定提交",
      cancelText: "取消",
    });
    if (!confirm) return;

    await doSubmit();
  };

  const buildSubmitPayload = (): CreatePublicFoodLibraryRequest => {
    const fullAddress = [
      province,
      city,
      isHomemade ? "" : district,
      isHomemade ? "" : detailAddress,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const finalFoodName =
      foodName.trim() || inferFoodName(selectedRecord, items, description);
    const submitTags = buildSubmitTags();

    return {
      image_path: imageUrl || selectedRecord?.image_path || undefined,
      image_paths: imageUrls.length > 0 ? imageUrls : undefined,
      source_record_id: selectedRecord?.id,
      total_calories: totalCalories,
      total_protein: totalProtein,
      total_carbs: totalCarbs,
      total_fat: totalFat,
      items,
      description,
      insight,
      food_name: finalFoodName,
      merchant_name: isHomemade ? undefined : merchantName.trim() || undefined,
      merchant_address: isHomemade ? undefined : fullAddress || undefined,
      taste_rating: tasteRating > 0 ? tasteRating : undefined,
      suitable_for_fat_loss: suitableForFatLoss,
      user_tags: submitTags,
      user_notes: userNotes.trim() || undefined,
      latitude: isHomemade ? undefined : latitude,
      longitude: isHomemade ? undefined : longitude,
      province: province.trim() || undefined,
      city: city.trim() || undefined,
      district: isHomemade ? undefined : district.trim() || undefined,
      detail_address: isHomemade
        ? undefined
        : detailAddress.trim() || undefined,
      type: isCampusFood ? "campus" : "common",
      is_campus_food: isCampusFood,
      school_id: isCampusFood
        ? schoolId || selectedSchool?.id || undefined
        : undefined,
      campus_id: isCampusFood ? selectedCampus?.id || undefined : undefined,
      canteen_id: isCampusFood ? selectedCanteen?.id || undefined : undefined,
      school_name: isCampusFood ? schoolName.trim() || undefined : undefined,
      campus_name: isCampusFood ? selectedCampus?.name || undefined : undefined,
      canteen_name: isCampusFood ? canteenName.trim() || undefined : undefined,
      floor: isCampusFood ? floor.trim() || undefined : undefined,
      window_name: isCampusFood ? windowName.trim() || undefined : undefined,
      price:
        isCampusFood && priceType !== "range" && price
          ? Number(price) || undefined
          : undefined,
      price_type: isCampusFood ? priceType.trim() || undefined : undefined,
      price_min:
        isCampusFood && priceType === "range" && priceMin
          ? Number(priceMin) || undefined
          : undefined,
      price_max:
        isCampusFood && priceType === "range" && priceMax
          ? Number(priceMax) || undefined
          : undefined,
      price_unit: isCampusFood ? priceUnit.trim() || undefined : undefined,
      price_collected_at:
        isCampusFood && priceCollectedAt
          ? `${priceCollectedAt}T00:00:00+08:00`
          : undefined,
      portion_description: isCampusFood
        ? portionDescription.trim() || undefined
        : undefined,
    };
  };

  /** 实际执行提交到公共库 */
  const doSubmit = async () => {
    setSubmitting(true);
    try {
      if (isEditMode) {
        await updatePublicFoodLibraryItem(editId, buildSubmitPayload());
        Taro.showToast({ title: "已保存", icon: "success" });
        Taro.setStorageSync("food_library_need_refresh", "1");
        setTimeout(() => {
          Taro.navigateBack();
        }, 1200);
      } else {
        await createPublicFoodLibraryItem(buildSubmitPayload());
        Taro.showToast({
          title: isCampusFood
            ? "已发布到校园食堂"
            : "提交成功，审核通过后将展示",
          icon: "none",
          duration: 2500,
        });
        Taro.setStorageSync("food_library_need_refresh", "1");
        setTimeout(() => {
          if (isCampusFood) {
            Taro.redirectTo({
              url: extraPkgUrl("/pages/campus-canteen/index"),
            });
            return;
          }
          if (quickUploadMode) {
            Taro.redirectTo({ url: extraPkgUrl("/pages/food-library/index") });
            return;
          }
          Taro.navigateBack();
        }, 2500);
      }
    } catch (e: any) {
      await showUnifiedApiError(e, isEditMode ? "保存失败" : "分享失败");
    } finally {
      setSubmitting(false);
    }
  };

  const hasImages =
    imageUrls.length > 0 || imageUrl || selectedRecord?.image_path;
  const canSubmit =
    hasImages && !submitting && !analyzing && !loadingSourceRecord;
  const displayLength = Math.max(imagePaths.length, imageUrls.length);

  const { scheme } = useAppColorScheme();

  if (isCampusFood && membershipLoading) {
    return (
      <View
        className={`share-page ${scheme === "dark" ? "share-page--dark" : ""}`}
      >
        <CampusMembershipGate loading />
      </View>
    );
  }

  if (isCampusFood && !isCampusMember) {
    return (
      <View
        className={`share-page ${scheme === "dark" ? "share-page--dark" : ""}`}
      >
        <CampusMembershipGate
          title='校园食堂为会员专属'
          subtitle='开通食探会员后，可以分享校园食堂菜品并绑定已审核食堂。普通公共食物库分享仍可继续使用。'
        />
      </View>
    );
  }

  return (
    <View
      className={`share-page ${scheme === "dark" ? "share-page--dark" : ""}`}
    >
      {quickUploadMode && (
        <View className='quick-upload-tip'>
          <Text className='quick-upload-title'>上传到公共食物库</Text>
          <Text className='quick-upload-subtitle'>
            已自动带入刚识别的餐食，补充商家、位置或是否自制后即可上传。
          </Text>
        </View>
      )}

      {/* 选择来源 */}
      {!quickUploadMode && !sourceRecordId && !isEditMode && (
        <View className='source-section'>
          <Text className='section-title'>选择来源</Text>
          <View className='source-options'>
            <View
              className={`source-option ${sourceType === "upload" ? "active" : ""}`}
              onClick={() => setSourceType("upload")}
            >
              <Text className='source-icon iconfont icon-paizhao-xianxing' />
              <Text className='source-text'>拍照上传</Text>
            </View>
            <View
              className={`source-option ${sourceType === "record" ? "active" : ""}`}
              onClick={() => {
                setSourceType("record");
                setShowRecordModal(true);
              }}
            >
              <Text className='source-icon iconfont icon-ic_detail' />
              <Text className='source-text'>从记录选择</Text>
            </View>
          </View>
        </View>
      )}

      {/* 图片区域：最多 3 张，每张识别后叠加计算 */}
      <View className='image-section'>
        <Text className='section-title'>
          食物图片 <Text className='required'>*</Text>
          {displayLength > 0 && (
            <Text className='image-count'>（{displayLength}/3）</Text>
          )}
        </Text>
        {displayLength > 0 ? (
          <View className='share-image-grid'>
            {Array.from({ length: displayLength }).map((_, index) => (
              <View key={index} className='share-grid-item'>
                <Image
                  src={imageUrls[index] || imagePaths[index]}
                  mode='aspectFill'
                  className='share-grid-image'
                  onClick={() => handlePreviewImage(index)}
                />
                <View
                  className='share-remove-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(index);
                  }}
                >
                  <Text className='share-close-icon'>×</Text>
                </View>
              </View>
            ))}
            {displayLength < MAX_IMAGES && (
              <View
                className='share-grid-item share-add-btn'
                onClick={handleChooseImage}
              >
                <Text className='share-add-icon'>+</Text>
                <Text className='share-add-text'>添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className='image-upload-area' onClick={handleChooseImage}>
            <Text className='upload-icon iconfont icon-paizhao-xianxing' />
            <Text className='upload-text'>
              点击上传食物图片（最多 3 张，每张识别后叠加计算）
            </Text>
          </View>
        )}
      </View>

      {/* 营养信息 */}
      <View className='nutrition-section'>
        <Text className='section-title'>营养信息</Text>
        <View className='nutrition-summary'>
          <View className='nutrition-item'>
            <Text className='nutrition-value'>{formatMacroNutrient(totalCalories)}</Text>
            <Text className='nutrition-label'>热量 kcal</Text>
          </View>
          <View className='nutrition-item'>
            <Text className='nutrition-value'>{formatMacroNutrient(totalProtein)}</Text>
            <Text className='nutrition-label'>蛋白质 g</Text>
          </View>
          <View className='nutrition-item'>
            <Text className='nutrition-value'>{formatMacroNutrient(totalCarbs)}</Text>
            <Text className='nutrition-label'>碳水 g</Text>
          </View>
          <View className='nutrition-item'>
            <Text className='nutrition-value'>{formatMacroNutrient(totalFat)}</Text>
            <Text className='nutrition-label'>脂肪 g</Text>
          </View>
        </View>
        <Text className='nutrition-tip'>营养数据由 AI 自动识别</Text>
      </View>

      {/* 基础信息 */}
      <View className='merchant-section'>
        <Text className='section-title'>基础信息</Text>
        <View className='form-item'>
          <Text className='form-label'>食物名称（已自动带入，可修改）</Text>
          <Input
            className='form-input'
            placeholder='如：麻辣香锅、烤鸡腿饭等'
            value={foodName}
            onInput={(e) => setFoodName(e.detail.value)}
          />
        </View>
        <View className='form-item'>
          <Text className='form-label'>餐食来源</Text>
          <View className='source-tag-row'>
            <View
              className={`source-tag-chip ${isHomemade ? "active" : ""}`}
              onClick={() => handleSetHomemade(true)}
            >
              自制
            </View>
            <View
              className={`source-tag-chip ${!isHomemade ? "active" : ""}`}
              onClick={() => handleSetHomemade(false)}
            >
              外卖/堂食
            </View>
          </View>
        </View>
        {!isHomemade && (
          <View className='form-item'>
            <Text className='form-label'>商家名称（可选）</Text>
            <Input
              className='form-input'
              placeholder='如：沙县小吃、肯德基等'
              value={merchantName}
              onInput={(e) => setMerchantName(e.detail.value)}
            />
          </View>
        )}
        <View className='form-item'>
          <Text className='form-label'>口味评分（可选）</Text>
          <View className='rating-row'>
            <View className='rating-stars'>
              {[1, 2, 3, 4, 5].map((n) => (
                <Text
                  key={n}
                  className={`rating-star ${n <= tasteRating ? "active" : ""}`}
                  onClick={() => setTasteRating(n === tasteRating ? 0 : n)}
                >
                  ★
                </Text>
              ))}
            </View>
          </View>
        </View>
        {/* 校园食堂 */}
        <View className='form-item'>
          <View
            className='switch-row'
            style={{ marginBottom: 0, borderBottom: "none" }}
          >
            <Text className='switch-label'>校园食堂菜品</Text>
            <View
              className={`switch-btn ${isCampusFood ? "active" : ""}`}
              onClick={() => {
                if (!isCampusFood && !isCampusMember) {
                  Taro.showToast({ title: "校园食堂为会员专属", icon: "none" });
                  Taro.navigateTo({
                    url: `${extraPkgUrl("/pages/pro-membership/index")}?source=campus_canteen`,
                  });
                  return;
                }
                setIsCampusFood(!isCampusFood);
              }}
            >
              <View className='switch-dot' />
            </View>
          </View>
        </View>
        {isCampusFood && (
          <>
            <View className='form-item'>
              <Text className='form-label'>
                学校 <Text className='required'>*</Text>
              </Text>
              <View
                className='form-input city-display'
                onClick={() => setShowSchoolPicker(true)}
              >
                <Text
                  className={schoolName ? "city-value" : "city-placeholder"}
                >
                  {schoolName || "请选择学校（必填）"}
                </Text>
              </View>
            </View>
            <View className='form-item'>
              <Text className='form-label'>
                校区 <Text className='required'>*</Text>
              </Text>
              <View
                className='form-input city-display'
                onClick={() => {
                  if (!selectedSchool?.id && !schoolId) {
                    Taro.showToast({ title: "请先选择学校", icon: "none" });
                    return;
                  }
                  setShowCampusPicker(true);
                }}
              >
                <Text
                  className={
                    selectedCampus?.name ? "city-value" : "city-placeholder"
                  }
                >
                  {selectedCampus?.name || "请选择校区"}
                </Text>
              </View>
            </View>
            <View className='form-item'>
              <Text className='form-label'>
                食堂 <Text className='required'>*</Text>
              </Text>
              <View
                className='form-input city-display'
                onClick={() => {
                  if (!selectedSchool?.id && !schoolId) {
                    Taro.showToast({ title: "请先选择学校", icon: "none" });
                    return;
                  }
                  if (!selectedCampus?.id) {
                    Taro.showToast({ title: "请先选择校区", icon: "none" });
                    return;
                  }
                  setShowCanteenPicker(true);
                }}
              >
                <Text
                  className={canteenName ? "city-value" : "city-placeholder"}
                >
                  {selectedCanteen?.name || canteenName || "请选择已审核食堂"}
                </Text>
              </View>
            </View>
            <View className='form-item'>
              <Text className='form-label'>楼层（可选）</Text>
              <Input
                className='form-input'
                placeholder='如：一层'
                value={floor}
                onInput={(e) => setFloor(e.detail.value)}
              />
            </View>
            <View className='form-item'>
              <Text className='form-label'>窗口名称（可选）</Text>
              <Input
                className='form-input'
                placeholder='如：12号窗口'
                value={windowName}
                onInput={(e) => setWindowName(e.detail.value)}
              />
            </View>
            <View className='form-item'>
              <Text className='form-label'>价格（可选）</Text>
              <Input
                className='form-input'
                placeholder={
                  priceType === "range" ? "区间价请填写下方上下限" : "如：15"
                }
                type='digit'
                value={price}
                onInput={(e) => setPrice(e.detail.value)}
                disabled={priceType === "range"}
              />
            </View>
            {priceType === "range" && (
              <View className='form-item'>
                <Text className='form-label'>价格区间（元）</Text>
                <View style={{ display: "flex", gap: "16rpx" }}>
                  <Input
                    className='form-input'
                    placeholder='最低价'
                    type='digit'
                    value={priceMin}
                    onInput={(e) => setPriceMin(e.detail.value)}
                  />
                  <Input
                    className='form-input'
                    placeholder='最高价'
                    type='digit'
                    value={priceMax}
                    onInput={(e) => setPriceMax(e.detail.value)}
                  />
                </View>
              </View>
            )}
            <View className='form-item'>
              <Text className='form-label'>计价方式（可选）</Text>
              <Picker
                mode='selector'
                range={PRICE_TYPE_OPTIONS.map((t) => PRICE_TYPE_LABELS[t])}
                value={PRICE_TYPE_OPTIONS.indexOf(priceType)}
                onChange={(e) =>
                  setPriceType(PRICE_TYPE_OPTIONS[Number(e.detail.value)] || "")
                }
              >
                <View className='form-input city-display'>
                  <Text
                    className={priceType ? "city-value" : "city-placeholder"}
                  >
                    {priceType
                      ? PRICE_TYPE_LABELS[priceType]
                      : "请选择计价方式"}
                  </Text>
                </View>
              </Picker>
            </View>
            <View className='form-item'>
              <Text className='form-label'>价格单位</Text>
              <Input
                className='form-input'
                placeholder='如：元/份'
                value={priceUnit}
                onInput={(e) => setPriceUnit(e.detail.value)}
              />
            </View>
            <View className='form-item'>
              <Text className='form-label'>价格采集日期</Text>
              <Picker
                mode='date'
                value={priceCollectedAt}
                onChange={(e) => setPriceCollectedAt(e.detail.value)}
              >
                <View className='form-input city-display'>
                  <Text className='city-value'>
                    {priceCollectedAt || "请选择日期"}
                  </Text>
                </View>
              </Picker>
            </View>
            <View className='form-item'>
              <Text className='form-label'>份量说明（可选）</Text>
              <Input
                className='form-input'
                placeholder='如：大份、小份'
                value={portionDescription}
                onInput={(e) => setPortionDescription(e.detail.value)}
              />
            </View>
          </>
        )}
      </View>

      {/* 标签 */}
      <View className='tags-section'>
        <Text className='section-title'>标签</Text>
        <View className='switch-row'>
          <Text className='switch-label'>适合减脂</Text>
          <View
            className={`switch-btn ${suitableForFatLoss ? "active" : ""}`}
            onClick={() => setSuitableForFatLoss(!suitableForFatLoss)}
          >
            <View className='switch-dot' />
          </View>
        </View>
        <View className='quick-tags'>
          {QUICK_TAGS.map((tag) => (
            <View
              key={tag}
              className={`quick-tag ${userTags.includes(tag) ? "selected" : ""}`}
              onClick={() => toggleQuickTag(tag)}
            >
              {tag}
            </View>
          ))}
        </View>
        <View className='custom-tag-row'>
          <Input
            className='tag-input'
            placeholder='自定义标签'
            value={customTag}
            onInput={(e) => setCustomTag(e.detail.value)}
            onConfirm={handleAddTag}
          />
          <View className='add-tag-btn' onClick={handleAddTag}>
            添加
          </View>
        </View>
        {userTags.length > 0 && (
          <View className='selected-tags'>
            {userTags.map((tag) => (
              <View key={tag} className='selected-tag'>
                <Text>{tag}</Text>
                <Text className='remove-tag' onClick={() => removeTag(tag)}>
                  ×
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 位置信息 */}
      <View className='location-section'>
        <View className='location-title-row'>
          <Text className='section-title'>
            {isHomemade ? "所在地区（可选）" : "商家地址"}{" "}
            {!isHomemade && <Text className='required'>*</Text>}
          </Text>
          {!isHomemade && (
            <View
              className='search-location-btn'
              onClick={handleNavigateLocationSearch}
            >
              <Text className='iconfont icon-dizhi' />
              <Text>搜索地址</Text>
            </View>
          )}
        </View>
        <View className='form-item' onClick={() => setShowCityPicker(true)}>
          <Text className='form-label'>
            {isHomemade ? "省市（可选）" : "城市/区域"}{" "}
            {!isHomemade && <Text className='required'>*</Text>}
          </Text>
          <View className='form-input city-display'>
            <Text className={province ? "city-value" : "city-placeholder"}>
              {province
                ? `${province}${city ? " " + city : ""}${isHomemade ? "" : ` ${district}`}`.trim()
                : isHomemade
                  ? locatingHomemadeCity
                    ? "正在定位所在城市..."
                    : "可选填所在省市"
                  : "点击选择城市/区域（必填）"}
            </Text>
          </View>
        </View>
        {isHomemade ? (
          <Text className='location-helper'>
            自制餐食不需要填写商家信息；所在地区可按需补充。
          </Text>
        ) : (
          <View className='form-item'>
            <Text className='form-label'>详细地址（可选）</Text>
            <Input
              className='form-input'
              placeholder='如：XX路XX号'
              value={detailAddress}
              onInput={(e) => setDetailAddress(e.detail.value)}
            />
          </View>
        )}
      </View>

      {/* 备注 */}
      <View className='merchant-section'>
        <Text className='section-title'>补充说明（可选）</Text>
        <Textarea
          className='form-textarea'
          placeholder='分享你对这份餐食的评价或建议...'
          value={userNotes}
          onInput={(e) => setUserNotes(e.detail.value)}
          maxlength={500}
        />
      </View>

      {/* 提交栏 */}
      <View className='submit-bar'>
        <View
          className={`submit-btn ${canSubmit ? "" : "disabled"}`}
          onClick={canSubmit ? handleSubmit : undefined}
        >
          {submitting || analyzing ? (
            <View className='btn-spinner' />
          ) : isEditMode ? (
            "保存修改"
          ) : (
            "分享到公共库"
          )}
        </View>
      </View>

      {/* 城市选择弹窗 */}
      <Popup
        open={showCityPicker}
        placement='bottom'
        onClose={() => setShowCityPicker(false)}
      >
        <AreaPicker
          title='选择城市/区域'
          areaList={areaList}
          onConfirm={(values: any[]) => {
            // values 是 code 数组，如 ["110000", "110100", "110101"]
            // 需要从 areaList 中查找对应的名称
            const provinceCode = values[0] || "";
            const cityCode = values[1] || "";
            const districtCode = values[2] || "";

            const p = areaList.province_list?.[provinceCode] || "";
            const c = areaList.city_list?.[cityCode] || "";
            const d = areaList.county_list?.[districtCode] || "";

            // 直辖市处理：省名=市名=直辖市名，区名在第三级
            if (
              p.includes("北京") ||
              p.includes("上海") ||
              p.includes("天津") ||
              p.includes("重庆")
            ) {
              setProvince(p);
              setCity("");
              setDistrict(d || c);
            } else {
              setProvince(p);
              setCity(c);
              setDistrict(d);
            }
            setShowCityPicker(false);
          }}
          onCancel={() => setShowCityPicker(false)}
        />
      </Popup>

      {/* 从记录选择弹窗 */}
      {showRecordModal && (
        <View
          className='record-modal'
          onClick={() => setShowRecordModal(false)}
        >
          <View
            className='record-modal-content'
            onClick={(e) => e.stopPropagation()}
          >
            <View className='modal-header'>
              <Text className='modal-title'>选择饮食记录</Text>
              <Text
                className='modal-close'
                onClick={() => setShowRecordModal(false)}
              >
                ✕
              </Text>
            </View>
            {records.length === 0 ? (
              <View className='record-empty'>暂无记录</View>
            ) : (
              <ScrollView
                className='record-list'
                scrollY
                enhanced
                showScrollbar={false}
              >
                {records.map((r) => (
                  <View
                    key={r.id}
                    className='record-item'
                    onClick={() => handleSelectRecord(r)}
                  >
                    {r.image_path ? (
                      <Image
                        className='record-image'
                        src={r.image_path}
                        mode='aspectFill'
                      />
                    ) : (
                      <View className='record-image-placeholder'>
                        <Text className='iconfont icon-shiwu' />
                      </View>
                    )}
                    <View className='record-info'>
                      <Text className='record-desc'>
                        {r.description || "饮食记录"}
                      </Text>
                      <Text className='record-meta'>
                        {formatMacroNutrient(r.total_calories)} kcal ·{" "}
                        {r.record_time?.slice(0, 10)}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      <SchoolPicker
        visible={showSchoolPicker}
        onSelect={(school) => {
          setSchoolId(school.id);
          setSchoolName(school.name);
          setSelectedSchool(school);
          setSelectedCampus(null);
          setSelectedCanteen(null);
          setCanteenName("");
          setFloor("");
          setWindowName("");
          setShowSchoolPicker(false);
        }}
        onCancel={() => setShowSchoolPicker(false)}
      />
      <CampusPicker
        visible={showCampusPicker}
        school={
          selectedSchool ||
          (schoolId && schoolName ? { id: schoolId, name: schoolName } : null)
        }
        value={selectedCampus?.id}
        onSelect={(campus) => {
          setSelectedCampus(campus);
          setSelectedCanteen(null);
          setCanteenName("");
          setFloor("");
          setWindowName("");
          setShowCampusPicker(false);
        }}
        onCancel={() => setShowCampusPicker(false)}
      />
      <CanteenPicker
        visible={showCanteenPicker}
        school={
          selectedSchool ||
          (schoolId && schoolName ? { id: schoolId, name: schoolName } : null)
        }
        campus={selectedCampus}
        value={selectedCanteen?.id}
        onSelect={({ campus, canteen }) => {
          setSelectedCampus(campus);
          setSelectedCanteen(canteen);
          setCanteenName(canteen.name);
          setShowCanteenPicker(false);
        }}
        onCancel={() => setShowCanteenPicker(false)}
      />
    </View>
  );
}

export default withAuth(FoodLibrarySharePage);
