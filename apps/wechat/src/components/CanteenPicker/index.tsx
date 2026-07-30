import { useEffect, useMemo, useState } from "react";
import { View, Text, Input, ScrollView, Textarea } from "@tarojs/components";
import Taro from "@tarojs/taro";
import {
  createSchoolCanteenApplication,
  getSchoolCanteens,
  showUnifiedApiError,
  type SchoolCampusItem,
  type SchoolCanteenItem,
  type SchoolItem,
} from "../../utils/api";
import { useAppColorScheme } from "../AppColorSchemeContext";
import "./index.scss";

interface CanteenPickerProps {
  visible: boolean;
  school: SchoolItem | null;
  campus: SchoolCampusItem | null;
  value?: string;
  onSelect: (payload: {
    campus: SchoolCampusItem | null;
    canteen: SchoolCanteenItem;
  }) => void;
  onCancel: () => void;
  onApplicationSubmitted?: () => void;
}

export default function CanteenPicker({
  visible,
  school,
  campus,
  value,
  onSelect,
  onCancel,
  onApplicationSubmitted,
}: CanteenPickerProps) {
  const { scheme } = useAppColorScheme();
  const [canteens, setCanteens] = useState<SchoolCanteenItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applicationName, setApplicationName] = useState("");
  const [applicationLocation, setApplicationLocation] = useState("");
  const [applicationNote, setApplicationNote] = useState("");

  useEffect(() => {
    if (!visible || !school?.id) return;
    setKeyword("");
    setApplicationName("");
    setApplicationLocation("");
    setApplicationNote("");
  }, [visible, school?.id, campus?.id]);

  useEffect(() => {
    if (!visible || !school?.id) return;
    setLoading(true);
    getSchoolCanteens(
      school.id,
      campus?.id ? { campus_id: campus.id } : undefined,
    )
      .then((list) => setCanteens(list))
      .catch(async (e) => {
        setCanteens([]);
        await showUnifiedApiError(e, "获取食堂失败");
      })
      .finally(() => setLoading(false));
  }, [visible, school?.id, campus?.id]);

  const visibleCanteens = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return canteens;
    return canteens.filter((item) => {
      const haystack = [
        item.name,
        item.campus_name,
        item.location_text,
        item.building_or_floor,
        ...(item.aliases || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [canteens, keyword]);

  const handleSubmitApplication = async () => {
    if (!school?.id) {
      Taro.showToast({ title: "请先选择学校", icon: "none" });
      return;
    }
    if (!campus?.id) {
      Taro.showToast({ title: "请先选择校区", icon: "none" });
      return;
    }
    const name = applicationName.trim();
    if (!name) {
      Taro.showToast({ title: "请填写食堂名称", icon: "none" });
      return;
    }
    setSubmitting(true);
    try {
      await createSchoolCanteenApplication({
        school_id: school.id,
        campus_id: campus.id,
        requested_campus_name: campus.name,
        requested_canteen_name: name,
        location_text: applicationLocation.trim() || undefined,
        applicant_note: applicationNote.trim() || undefined,
      });
      Taro.showToast({ title: "申请已提交", icon: "success" });
      setApplicationName("");
      setApplicationLocation("");
      setApplicationNote("");
      onApplicationSubmitted?.();
    } catch (e: any) {
      await showUnifiedApiError(e, "提交申请失败");
    } finally {
      setSubmitting(false);
    }
  };

  const isDark = scheme === "dark";
  const disabled = !school?.id;

  return (
    <View
      className={`canteen-picker-overlay ${visible ? "visible" : ""} ${isDark ? "canteen-picker-overlay--dark" : ""}`}
      onClick={onCancel}
    >
      <View
        className='canteen-picker-card'
        onClick={(e) => e.stopPropagation()}
      >
        <View className='canteen-picker-header'>
          <View>
            <Text className='canteen-picker-title'>选择食堂</Text>
            <Text className='canteen-picker-subtitle'>
              {school?.name && campus?.name
                ? `${school.name} · ${campus.name}`
                : school?.name
                  ? `${school.name} · 全部校区`
                  : "请先选择高校"}
            </Text>
          </View>
          <Text className='canteen-picker-close' onClick={onCancel}>
            关闭
          </Text>
        </View>

        {disabled ? (
          <View className='canteen-picker-empty'>
            <Text className='canteen-picker-empty-text'>
              请先选择学校
            </Text>
          </View>
        ) : (
          <>
            <View className='canteen-picker-search'>
              <Text className='canteen-picker-search-icon iconfont icon-sousuo' />
              <Input
                className='canteen-picker-input'
                placeholder='搜索食堂名称'
                value={keyword}
                onInput={(e) => setKeyword(e.detail.value)}
              />
            </View>

            <ScrollView
              className='canteen-picker-list'
              scrollY
              enhanced
              showScrollbar={false}
            >
              {loading ? (
                <View className='canteen-picker-loading'>
                  <View className='canteen-picker-spinner' />
                </View>
              ) : visibleCanteens.length === 0 ? (
                <View className='canteen-picker-empty'>
                  <Text className='canteen-picker-empty-text'>
                    暂未收录这个食堂
                  </Text>
                </View>
              ) : (
                visibleCanteens.map((item) => (
                  <View
                    key={item.id}
                    className={`canteen-picker-item ${value === item.id ? "selected" : ""}`}
                    onClick={() =>
                      onSelect({
                        campus:
                          campus ||
                          (item.campus_id && item.campus_name
                            ? {
                                id: item.campus_id,
                                school_id: item.school_id,
                                name: item.campus_name,
                              }
                            : null),
                        canteen: item,
                      })
                    }
                  >
                    <Text className='canteen-picker-item-name'>
                      {item.name}
                    </Text>
                    <Text className='canteen-picker-item-meta'>
                      {[
                        item.campus_name || campus?.name,
                        item.location_text || item.building_or_floor,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "已审核食堂"}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View className='canteen-picker-apply'>
              <Text className='canteen-picker-apply-title'>申请新增食堂</Text>
              <Input
                className='canteen-picker-apply-input'
                placeholder='食堂名称'
                value={applicationName}
                onInput={(e) => setApplicationName(e.detail.value)}
              />
              <Input
                className='canteen-picker-apply-input'
                placeholder='位置说明（可选）'
                value={applicationLocation}
                onInput={(e) => setApplicationLocation(e.detail.value)}
              />
              <Textarea
                className='canteen-picker-apply-textarea'
                placeholder='补充说明（可选）'
                value={applicationNote}
                maxlength={200}
                onInput={(e) => setApplicationNote(e.detail.value)}
              />
              <View
                className={`canteen-picker-apply-btn ${submitting ? "disabled" : ""}`}
                onClick={submitting ? undefined : handleSubmitApplication}
              >
                {submitting ? (
                  <View className='canteen-picker-spinner canteen-picker-spinner--small' />
                ) : (
                  "提交申请"
                )}
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
