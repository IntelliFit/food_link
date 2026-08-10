import { useEffect, useMemo, useState } from "react";
import { View, Text, Input, ScrollView } from "@tarojs/components";
import {
  getSchoolCampuses,
  showUnifiedApiError,
  type SchoolCampusItem,
  type SchoolItem,
} from "../../utils/api";
import { useAppColorScheme } from "../AppColorSchemeContext";
import "./index.scss";

interface CampusPickerProps {
  visible: boolean;
  school: SchoolItem | null;
  value?: string;
  onSelect: (campus: SchoolCampusItem) => void;
  onCancel: () => void;
}

export default function CampusPicker({
  visible,
  school,
  value,
  onSelect,
  onCancel,
}: CampusPickerProps) {
  const { scheme } = useAppColorScheme();
  const [campuses, setCampuses] = useState<SchoolCampusItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !school?.id) return;
    setKeyword("");
    setLoading(true);
    getSchoolCampuses(school.id)
      .then((list) => setCampuses(list))
      .catch(async (e) => {
        setCampuses([]);
        await showUnifiedApiError(e, "获取校区失败");
      })
      .finally(() => setLoading(false));
  }, [visible, school?.id]);

  const visibleCampuses = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return campuses;
    return campuses.filter((item) => {
      const haystack = [
        item.name,
        item.address,
        item.campus_type,
        ...(item.aliases || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [campuses, keyword]);

  const disabled = !school?.id;
  const isDark = scheme === "dark";
  const areaLabel = "校区";

  return (
    <View
      className={`campus-picker-overlay ${visible ? "visible" : ""} ${isDark ? "campus-picker-overlay--dark" : ""}`}
      onClick={onCancel}
    >
      <View className='campus-picker-card' onClick={(e) => e.stopPropagation()}>
        <View className='campus-picker-header'>
          <View>
            <Text className='campus-picker-title'>选择{areaLabel}</Text>
            <Text className='campus-picker-subtitle'>
              {school?.name || "请先选择学校"}
            </Text>
          </View>
          <Text className='campus-picker-close' onClick={onCancel}>
            关闭
          </Text>
        </View>

        {disabled ? (
          <View className='campus-picker-empty'>
            <Text className='campus-picker-empty-text'>请先选择学校</Text>
          </View>
        ) : (
          <>
            <View className='campus-picker-search'>
              <Text className='campus-picker-search-icon iconfont icon-sousuo' />
              <Input
                className='campus-picker-input'
                placeholder={`搜索${areaLabel}名称`}
                value={keyword}
                onInput={(e) => setKeyword(e.detail.value)}
              />
            </View>

            <ScrollView
              className='campus-picker-list'
              scrollY
              enhanced
              showScrollbar={false}
            >
              {loading ? (
                <View className='campus-picker-loading'>
                  <View className='campus-picker-spinner' />
                </View>
              ) : visibleCampuses.length === 0 ? (
                <View className='campus-picker-empty'>
                  <Text className='campus-picker-empty-text'>
                    暂未收录这个{areaLabel}
                  </Text>
                </View>
              ) : (
                visibleCampuses.map((item) => (
                  <View
                    key={item.id}
                    className={`campus-picker-item ${value === item.id ? "selected" : ""}`}
                    onClick={() => onSelect(item)}
                  >
                    <Text className='campus-picker-item-name'>{item.name}</Text>
                    <Text className='campus-picker-item-meta'>
                      {[item.campus_type, item.address]
                        .filter(Boolean)
                        .join(" · ") || `已审核${areaLabel}`}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}
