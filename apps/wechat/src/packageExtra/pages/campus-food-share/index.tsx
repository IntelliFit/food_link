import {
  View,
  Text,
  Image,
  Input,
  Textarea,
  PageMeta,
} from "@tarojs/components";
import { useEffect, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { withAuth } from "../../../utils/withAuth";
import { useAppColorScheme } from "../../../components/AppColorSchemeContext";
import SchoolPicker from "../../../components/SchoolPicker";
import CampusPicker from "../../../components/CampusPicker";
import CanteenPicker from "../../../components/CanteenPicker";
import FloorPicker from "../../../components/FloorPicker";
import { applyThemeNavigationBar } from "../../../utils/theme-navigation-bar";
import {
  createPublicFoodLibraryItem,
  getCanteenFloors,
  getMyMembership,
  getPublicFoodLibraryItem,
  imageToBase64,
  showUnifiedApiError,
  type CreatePublicFoodLibraryRequest,
  type MembershipStatus,
  type PublicFoodLibraryItem,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
  updatePublicFoodLibraryItem,
  uploadAnalyzeImage,
} from "../../../utils/api";
import { extraPkgUrl } from "../../../utils/subpackage-extra";
import {
  chooseImageWithPrivacy,
  isPrivacyAuthorizeError,
  showPrivacyAuthorizeFailure,
} from "../../../utils/weapp-privacy";
import CampusMembershipGate from "../../../components/CampusMembershipGate";
import "./index.scss";

const MAX_IMAGES = 3;
const CAMPUS_QUICK_TAGS = [
  "招牌菜",
  "性价比高",
  "大份量",
  "清淡",
  "少油",
  "高蛋白",
  "排队少",
];
const PRICE_TYPE_OPTIONS = ["fixed", "weight", "range", "combo", "unknown"];
const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "固定价格",
  weight: "称重计价",
  range: "价格区间",
  combo: "套餐价格",
  unknown: "未知",
};
const PRICE_TYPE_UNITS: Record<string, string> = {
  fixed: "元/份",
  weight: "元/斤",
  range: "元/份",
  combo: "元/套",
  unknown: "元",
};
const PRICE_TYPE_HELPERS: Record<string, string> = {
  fixed: "适合单份菜品，如 12 元/份",
  weight: "适合称重窗口，如 18 元/斤",
  range: "适合价格浮动菜品，如 8-15 元/份",
  combo: "适合套餐，如 20 元/套",
  unknown: "暂不确定计价方式时使用",
};

function CampusFoodSharePage() {
  const { scheme } = useAppColorScheme();
  const routerParams = Taro.getCurrentInstance().router?.params;
  const editId = routerParams?.edit_id || "";
  const isEditMode = Boolean(editId);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [foodName, setFoodName] = useState("");
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
  const [suitableForFatLoss, setSuitableForFatLoss] = useState(false);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [showSchoolPicker, setShowSchoolPicker] = useState(false);
  const [showCampusPicker, setShowCampusPicker] = useState(false);
  const [showCanteenPicker, setShowCanteenPicker] = useState(false);
  const [showFloorPicker, setShowFloorPicker] = useState(false);
  const [showPriceTypeSheet, setShowPriceTypeSheet] = useState(false);
  const [showPriceDateSheet, setShowPriceDateSheet] = useState(false);
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isCampusMember = !!membershipStatus?.is_pro;
  const areaLabel = "校区";

  const handleChooseImage = async () => {
    const remain = MAX_IMAGES - imageUrls.length;
    if (remain <= 0) return;

    try {
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
      });
      const tempPaths = res.tempFilePaths || [];
      if (tempPaths.length === 0) return;

      const prevPaths = imagePaths;
      const prevUrls = imageUrls;
      setImagePaths((prev) => [...prev, ...tempPaths]);
      Taro.showLoading({ title: "上传中...", mask: true });

      try {
        const newUrls: string[] = [];
        for (const tempPath of tempPaths) {
          const base64 = await imageToBase64(tempPath);
          const uploadRes = await uploadAnalyzeImage(base64);
          newUrls.push(uploadRes.imageUrl);
        }

        const allUrls = [...prevUrls, ...newUrls];
        setImageUrls(allUrls);
        setImageUrl(allUrls[0] || "");
        Taro.showToast({ title: "图片已上传", icon: "success" });
      } catch (e: any) {
        setImagePaths(prevPaths);
        setImageUrls(prevUrls);
        setImageUrl(prevUrls[0] || "");
        await showUnifiedApiError(e, "上传失败");
      } finally {
        Taro.hideLoading();
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

  const handlePreviewImage = (index: number) => {
    const urls = imageUrls.filter(Boolean);
    const current = urls[index];
    if (urls.length > 0 && current) Taro.previewImage({ urls, current });
  };

  const handleRemoveImage = (index: number) => {
    const removedUrl = imageUrls[index];
    const nextPaths = imagePaths.filter((_, i) => i !== index);
    const nextUrls = imageUrls.filter((_, i) => i !== index);

    setImagePaths(nextPaths);
    setImageUrls(nextUrls);
    setImageUrl(nextUrls[0] || "");
  };

  const toggleQuickTag = (tag: string) => {
    setUserTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  };

  const handleAddTag = () => {
    const tag = customTag.trim();
    if (!tag) return;
    if (userTags.includes(tag)) {
      Taro.showToast({ title: "标签已存在", icon: "none" });
      return;
    }
    setUserTags((prev) => [...prev, tag]);
    setCustomTag("");
  };

  const removeTag = (tag: string) => {
    setUserTags((prev) => prev.filter((item) => item !== tag));
  };

  const handleSelectPriceType = (nextType: string) => {
    const fallbackUnit = PRICE_TYPE_UNITS[nextType] || "元";
    setPriceType(nextType);
    setPriceUnit(fallbackUnit);
    if (nextType === "range") {
      setPrice("");
    } else {
      setPriceMin("");
      setPriceMax("");
    }
    setShowPriceTypeSheet(false);
  };

  const buildRecentDateOptions = () => {
    return Array.from({ length: 7 }).map((_, index) => {
      const d = new Date();
      d.setDate(d.getDate() - index);
      const value = d.toISOString().slice(0, 10);
      const label =
        index === 0 ? "今天" : index === 1 ? "昨天" : `${index} 天前`;
      return { value, label };
    });
  };

  const validatePriceRange = () => {
    if (priceType !== "range") return true;
    const min = Number(priceMin);
    const max = Number(priceMax);
    return (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min > 0 &&
      max > 0 &&
      min <= max
    );
  };

  const handleSubmit = async () => {
    if (imageUrls.length === 0 && !imageUrl) {
      Taro.showToast({ title: "请先上传菜品图片", icon: "none" });
      return;
    }

    const finalFoodName = foodName.trim();
    if (!finalFoodName) {
      Taro.showToast({ title: "请填写菜品名称", icon: "none" });
      return;
    }
    if (!schoolName.trim()) {
      Taro.showToast({ title: "请选择学校", icon: "none" });
      return;
    }
    if (!selectedCanteen?.id) {
      Taro.showToast({ title: "请选择已审核食堂", icon: "none" });
      return;
    }
    if (!validatePriceRange()) {
      Taro.showToast({ title: "请填写正确价格区间", icon: "none" });
      return;
    }

    if (finalFoodName !== foodName.trim()) setFoodName(finalFoodName);

    const { confirm } = await Taro.showModal({
      title: isEditMode ? "确认保存" : "确认提交",
      content: isEditMode
        ? "确定保存对这份校园食堂菜品的修改吗？"
        : "确定提交这份校园食堂菜品吗？提交后会在后台分析营养信息，并显示在校园食堂分区。",
      confirmText: isEditMode ? "保存" : "确定提交",
      cancelText: "取消",
    });
    if (!confirm) return;

    await doSubmit(finalFoodName);
  };

  const buildPayload = (
    finalFoodName: string,
  ): CreatePublicFoodLibraryRequest => ({
    image_path: imageUrl || undefined,
    image_paths: imageUrls.length > 0 ? imageUrls : undefined,
    food_name: finalFoodName,
    suitable_for_fat_loss: suitableForFatLoss,
    user_tags: userTags,
    user_notes: userNotes.trim() || undefined,
    type: "campus",
    is_campus_food: true,
    school_id: schoolId || selectedSchool?.id,
    campus_id: selectedCampus?.id,
    canteen_id: selectedCanteen?.id,
    school_name: schoolName.trim(),
    campus_name: selectedCampus?.name,
    canteen_name: canteenName.trim(),
    floor: floor.trim() || undefined,
    window_name: windowName.trim() || undefined,
    price:
      priceType !== "range" && price ? Number(price) || undefined : undefined,
    price_type: priceType.trim() || undefined,
    price_min:
      priceType === "range" && priceMin
        ? Number(priceMin) || undefined
        : undefined,
    price_max:
      priceType === "range" && priceMax
        ? Number(priceMax) || undefined
        : undefined,
    price_unit: priceUnit.trim() || undefined,
    price_collected_at: priceCollectedAt
      ? `${priceCollectedAt}T00:00:00+08:00`
      : undefined,
    portion_description: portionDescription.trim() || undefined,
  });

  const doSubmit = async (finalFoodName: string) => {
    setSubmitting(true);
    try {
      if (isEditMode) {
        await updatePublicFoodLibraryItem(editId, buildPayload(finalFoodName));
        Taro.showToast({ title: "已保存", icon: "success" });
        Taro.setStorageSync("food_library_need_refresh", "1");
        setTimeout(() => {
          Taro.navigateBack();
        }, 1200);
      } else {
        await createPublicFoodLibraryItem(buildPayload(finalFoodName));
        Taro.showToast({
          title: "已提交，后台分析中",
          icon: "none",
          duration: 2500,
        });
        Taro.setStorageSync("food_library_need_refresh", "1");
        setTimeout(() => {
          Taro.redirectTo({ url: extraPkgUrl("/pages/campus-canteen/index") });
        }, 2500);
      }
    } catch (e: any) {
      await showUnifiedApiError(e, isEditMode ? "保存失败" : "发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = imageUrls.length > 0 && !submitting;
  const isDark = scheme === "dark";

  useDidShow(() => {
    applyThemeNavigationBar(scheme, {
      lightBackground: "#f9fafb",
      darkBackground: "#07110f",
    });
    setMembershipLoading(true);
    getMyMembership(undefined, { forceRefresh: true })
      .then(setMembershipStatus)
      .catch((e) => {
        console.error("获取校园菜品分享会员状态失败:", e);
        setMembershipStatus(null);
      })
      .finally(() => setMembershipLoading(false));
  });

  useEffect(() => {
    applyThemeNavigationBar(scheme, {
      lightBackground: "#f9fafb",
      darkBackground: "#07110f",
    });
  }, [scheme]);

  // 编辑模式：加载已有数据回填
  useEffect(() => {
    if (!editId || !isCampusMember) return;
    let cancelled = false;
    setLoadingEdit(true);
    getPublicFoodLibraryItem(editId)
      .then((data: PublicFoodLibraryItem) => {
        if (cancelled) return;
        if (data.type !== "campus" && !data.is_campus_food) {
          Taro.showToast({ title: "该条目不是校园食堂菜品", icon: "none" });
          return;
        }
        const imgs =
          data.image_paths && data.image_paths.length > 0
            ? data.image_paths
            : data.image_path
              ? [data.image_path]
              : [];
        setImageUrls(imgs);
        setImageUrl(imgs[0] || "");
        setFoodName(data.food_name || "");
        setSchoolId(data.school_id || "");
        setSchoolName(data.school_name || "");
        setSelectedSchool(
          data.school_id && data.school_name
            ? { id: data.school_id, name: data.school_name }
            : null,
        );
        setSelectedCampus(
          data.campus_id
            ? {
                id: data.campus_id,
                school_id: data.school_id || "",
                name: data.campus_name || "已选校区",
              }
            : null,
        );
        setSelectedCanteen(
          data.canteen_id
            ? {
                id: data.canteen_id,
                school_id: data.school_id || "",
                campus_id: data.campus_id || undefined,
                campus_name: data.campus_name || undefined,
                name: data.canteen_name || "已选食堂",
              }
            : null,
        );
        setCanteenName(data.canteen_name || "");
        setFloor(data.floor || "");
        setWindowName(data.window_name || "");
        setSuitableForFatLoss(data.suitable_for_fat_loss);
        setUserTags(data.user_tags || []);
        setUserNotes(data.user_notes || "");
        setPortionDescription(data.portion_description || "");
        const pt = data.price_type || "fixed";
        setPriceType(pt);
        setPriceUnit(data.price_unit || PRICE_TYPE_UNITS[pt] || "元/份");
        if (pt === "range") {
          setPriceMin(data.price_min ? String(data.price_min) : "");
          setPriceMax(data.price_max ? String(data.price_max) : "");
          setPrice("");
        } else {
          setPrice(data.price ? String(data.price) : "");
          setPriceMin("");
          setPriceMax("");
        }
        if (data.price_collected_at) {
          try {
            const d = new Date(data.price_collected_at);
            setPriceCollectedAt(d.toISOString().slice(0, 10));
          } catch {
            setPriceCollectedAt(new Date().toISOString().slice(0, 10));
          }
        }
      })
      .catch(async (e: any) => {
        if (cancelled) return;
        await showUnifiedApiError(e, "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, isCampusMember]);

  if (membershipLoading) {
    return (
      <>
        <PageMeta
          backgroundColor={isDark ? "#07110f" : "#f9fafb"}
          pageStyle={`background-color: ${isDark ? "#07110f" : "#f9fafb"};`}
        />
        <CampusMembershipGate loading />
      </>
    );
  }

  if (!isCampusMember) {
    return (
      <>
        <PageMeta
          backgroundColor={isDark ? "#07110f" : "#f9fafb"}
          pageStyle={`background-color: ${isDark ? "#07110f" : "#f9fafb"};`}
        />
        <CampusMembershipGate
          title='分享校园菜品需开通会员'
          subtitle='校园食堂菜品分享、食堂绑定和申请新增食堂目前仅向食探会员开放。'
        />
      </>
    );
  }

  return (
    <>
      <PageMeta
        backgroundColor={isDark ? "#07110f" : "#f9fafb"}
        pageStyle={`background-color: ${isDark ? "#07110f" : "#f9fafb"};`}
      />
      <View
        className={`campus-share-page ${isDark ? "campus-share-page--dark" : ""}`}
      >
        <View className='campus-share-hero'>
          <Text className='campus-share-hero__title'>
            {isEditMode ? "编辑校园食堂菜品" : "分享校园食堂菜品"}
          </Text>
          <Text className='campus-share-hero__subtitle'>
            补充学校、食堂和窗口信息，帮助同学更快找到好吃的一餐。
          </Text>
        </View>

        <View className='campus-share-section'>
          <Text className='section-title'>
            菜品图片 <Text className='required'>*</Text>
            {imageUrls.length > 0 && (
              <Text className='image-count'>（{imageUrls.length}/3）</Text>
            )}
          </Text>
          {imageUrls.length > 0 ? (
            <View className='share-image-grid'>
              {imageUrls.map((url, index) => (
                <View key={url} className='share-grid-item'>
                  <Image
                    src={url}
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
              {imageUrls.length < MAX_IMAGES && (
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
              <Text className='upload-text'>点击上传菜品图片（最多 3 张）</Text>
            </View>
          )}
        </View>

        <View className='campus-share-section'>
          <Text className='section-title'>菜品信息</Text>
          <View className='form-item'>
            <Text className='form-label'>
              菜品名称 <Text className='required'>*</Text>
            </Text>
            <Input
              className='form-input'
              placeholder='如：黄焖鸡米饭、番茄牛腩面'
              value={foodName}
              onInput={(e) => setFoodName(e.detail.value)}
            />
          </View>
          <View className='directory-form-row directory-form-row--two'>
            <View className='form-item directory-form-item'>
              <Text className='form-label'>
                学校 <Text className='required'>*</Text>
              </Text>
              <View
                className='form-input picker-display'
                onClick={() => setShowSchoolPicker(true)}
              >
                <Text
                  className={schoolName ? "picker-value" : "picker-placeholder"}
                >
                  {schoolName || "选择学校"}
                </Text>
                <Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
            <View className='form-item directory-form-item'>
              <Text className='form-label'>{areaLabel}</Text>
              <View
                className='form-input picker-display'
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
                    selectedCampus?.name ? "picker-value" : "picker-placeholder"
                  }
                >
                  {selectedCampus?.name || `选择${areaLabel}`}
                </Text>
                <Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
          </View>
          <View className='directory-form-row directory-form-row--three'>
            <View className='form-item directory-form-item'>
              <Text className='form-label'>
                食堂 <Text className='required'>*</Text>
              </Text>
              <View
                className='form-input picker-display'
                onClick={() => {
                  if (!selectedSchool?.id && !schoolId) {
                    Taro.showToast({ title: "请先选择学校", icon: "none" });
                    return;
                  }
                  setShowCanteenPicker(true);
                }}
              >
                <Text
                  className={canteenName ? "picker-value" : "picker-placeholder"}
                >
                  {selectedCanteen?.name || canteenName || "选择食堂"}
                </Text>
                <Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
            <View className='form-item directory-form-item'>
              <Text className='form-label'>楼层</Text>
              <View className='form-input picker-display' onClick={() => selectedCanteen?.id ? setShowFloorPicker(true) : Taro.showToast({ title: '请先选择食堂', icon: 'none' })}>
                <Text className={floor ? 'picker-value' : 'picker-placeholder'}>{floor || '选择楼层'}</Text><Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
            <View className='form-item directory-form-item'>
              <Text className='form-label'>窗口（可选）</Text>
              <Input
                className='form-input'
                placeholder='填写窗口'
                value={windowName}
                onInput={(event) => setWindowName(event.detail.value)}
              />
            </View>
          </View>
          {canteenName && !selectedCanteen?.id && (
            <Text className='legacy-canteen-tip'>
              旧食堂名称仅用于展示，保存前请绑定到已审核食堂。
            </Text>
          )}
        </View>

        <View className='campus-share-section'>
          <Text className='section-title'>价格信息（可选）</Text>
          {priceType === "range" ? (
            <>
              <View className='form-row price-main-row'>
                <View className='form-item form-item--price-type'>
                  <Text className='form-label'>计价方式</Text>
                  <View
                    className='form-input picker-display price-type-display'
                    onClick={() => setShowPriceTypeSheet(true)}
                  >
                    <Text className='picker-value'>
                      {PRICE_TYPE_LABELS[priceType] || "请选择计价方式"}
                    </Text>
                    <Text className='picker-arrow'>⌄</Text>
                  </View>
                </View>
                <View className='form-item form-item--half'>
                  <Text className='form-label'>最低价</Text>
                  <Input
                    className='form-input'
                    placeholder='如：8'
                    type='digit'
                    value={priceMin}
                    onInput={(e) => setPriceMin(e.detail.value)}
                  />
                </View>
                <View className='form-item form-item--half'>
                  <Text className='form-label'>最高价</Text>
                  <Input
                    className='form-input'
                    placeholder='如：15'
                    type='digit'
                    value={priceMax}
                    onInput={(e) => setPriceMax(e.detail.value)}
                  />
                </View>
              </View>
              <Text className='price-helper'>
                {PRICE_TYPE_HELPERS[priceType]}
              </Text>
            </>
          ) : (
            <View className='form-row price-main-row'>
              <View className='form-item form-item--price-type'>
                <Text className='form-label'>计价方式</Text>
                <View
                  className='form-input picker-display price-type-display'
                  onClick={() => setShowPriceTypeSheet(true)}
                >
                  <Text className='picker-value'>
                    {PRICE_TYPE_LABELS[priceType] || "请选择计价方式"}
                  </Text>
                  <Text className='picker-arrow'>⌄</Text>
                </View>
              </View>
              <View className='form-item form-item--price-value'>
                <Text className='form-label'>价格</Text>
                <Input
                  className='form-input'
                  placeholder={priceType === "unknown" ? "可不填" : "如：12"}
                  type='digit'
                  value={price}
                  onInput={(e) => setPrice(e.detail.value)}
                />
              </View>
            </View>
          )}
          {priceType !== "range" && (
            <Text className='price-helper'>
              {PRICE_TYPE_HELPERS[priceType]}
            </Text>
          )}
          <View className='form-row'>
            <View className='form-item form-item--half'>
              <Text className='form-label'>价格单位</Text>
              <Input
                className='form-input'
                placeholder={PRICE_TYPE_UNITS[priceType] || "元"}
                value={priceUnit}
                onInput={(e) => setPriceUnit(e.detail.value)}
              />
            </View>
            <View className='form-item form-item--half'>
              <Text className='form-label'>采集日期</Text>
              <View
                className='form-input picker-display'
                onClick={() => setShowPriceDateSheet(true)}
              >
                <Text className='picker-value'>
                  {priceCollectedAt || "请选择日期"}
                </Text>
                <Text className='picker-arrow'>⌄</Text>
              </View>
            </View>
          </View>
          <View className='form-item'>
            <Text className='form-label'>份量说明（可选）</Text>
            <Input
              className='form-input'
              placeholder='如：大份、小份、约一人份'
              value={portionDescription}
              onInput={(e) => setPortionDescription(e.detail.value)}
            />
          </View>
        </View>

        <View className='campus-share-section'>
          <Text className='section-title'>标签</Text>
          <View className='switch-row'>
            <Text className='switch-label'>适合减脂</Text>
            <View
              className={`switch-btn ${suitableForFatLoss ? "active" : ""}`}
              onClick={() => setSuitableForFatLoss((prev) => !prev)}
            >
              <View className='switch-dot' />
            </View>
          </View>
          <View className='quick-tags'>
            {CAMPUS_QUICK_TAGS.map((tag) => (
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

        <View className='campus-share-section'>
          <Text className='section-title'>补充说明（可选）</Text>
          <Textarea
            className='form-textarea'
            placeholder='例如口味、排队情况、推荐搭配等...'
            value={userNotes}
            onInput={(e) => setUserNotes(e.detail.value)}
            maxlength={500}
          />
        </View>

        <View className='submit-bar'>
          <View
            className={`submit-btn ${canSubmit ? "" : "disabled"}`}
            onClick={canSubmit ? handleSubmit : undefined}
          >
            {submitting ? (
              <View className='btn-spinner' />
            ) : isEditMode ? (
              "保存修改"
            ) : (
              "提交并后台分析"
            )}
          </View>
        </View>

        {showPriceTypeSheet && (
          <View
            className='campus-modal-overlay'
            onClick={() => setShowPriceTypeSheet(false)}
          >
            <View
              className='campus-modal-card'
              onClick={(e) => e.stopPropagation()}
            >
              <View className='campus-modal-header'>
                <Text className='campus-modal-title'>选择计价方式</Text>
                <Text
                  className='campus-modal-close'
                  onClick={() => setShowPriceTypeSheet(false)}
                >
                  关闭
                </Text>
              </View>
              <View className='campus-option-list'>
                {PRICE_TYPE_OPTIONS.map((type) => (
                  <View
                    key={type}
                    className={`campus-option-item ${priceType === type ? "active" : ""}`}
                    onClick={() => handleSelectPriceType(type)}
                  >
                    <View className='campus-option-copy'>
                      <Text className='campus-option-title'>
                        {PRICE_TYPE_LABELS[type]}
                      </Text>
                      <Text className='campus-option-desc'>
                        {PRICE_TYPE_HELPERS[type]}
                      </Text>
                    </View>
                    <Text className='campus-option-unit'>
                      {PRICE_TYPE_UNITS[type]}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {showPriceDateSheet && (
          <View
            className='campus-modal-overlay'
            onClick={() => setShowPriceDateSheet(false)}
          >
            <View
              className='campus-modal-card'
              onClick={(e) => e.stopPropagation()}
            >
              <View className='campus-modal-header'>
                <Text className='campus-modal-title'>选择采集日期</Text>
                <Text
                  className='campus-modal-close'
                  onClick={() => setShowPriceDateSheet(false)}
                >
                  关闭
                </Text>
              </View>
              <View className='campus-date-manual'>
                <Text className='campus-date-manual-label'>手动输入日期</Text>
                <Input
                  className='form-input'
                  placeholder='YYYY-MM-DD'
                  value={priceCollectedAt}
                  onInput={(e) => setPriceCollectedAt(e.detail.value)}
                  onConfirm={() => setShowPriceDateSheet(false)}
                />
              </View>
              <View className='campus-option-list'>
                {buildRecentDateOptions().map((item) => (
                  <View
                    key={item.value}
                    className={`campus-option-item ${priceCollectedAt === item.value ? "active" : ""}`}
                    onClick={() => {
                      setPriceCollectedAt(item.value);
                      setShowPriceDateSheet(false);
                    }}
                  >
                    <View className='campus-option-copy'>
                      <Text className='campus-option-title'>{item.label}</Text>
                      <Text className='campus-option-desc'>{item.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
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
            setFloor("");
            setWindowName("");
            setShowCanteenPicker(false);
            getCanteenFloors(canteen.id)
              .then((items) => {
                const defaultFloor = items.find((item) => item.is_default);
                if (defaultFloor) setFloor(defaultFloor.name);
              })
              .catch(() => {
                // 楼层选择器会在用户打开时展示统一错误；食堂选择本身不应被阻断。
              });
          }}
          onCancel={() => setShowCanteenPicker(false)}
        />
        <FloorPicker visible={showFloorPicker} canteen={selectedCanteen} value={floor} onSelect={(value) => { setFloor(value); setWindowName(""); setShowFloorPicker(false); }} onCancel={() => setShowFloorPicker(false)} />
      </View>
    </>
  );
}

export default withAuth(CampusFoodSharePage);
