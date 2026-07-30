import { useEffect, useMemo, useState } from "react";
import { Input, ScrollView, Text, View } from "@tarojs/components";
import { getCanteenWindows, showUnifiedApiError, type CanteenWindowItem, type SchoolCanteenItem } from "../../utils/api";
import { useAppColorScheme } from "../AppColorSchemeContext";
import "../CanteenPicker/index.scss";

interface WindowPickerProps {
  visible: boolean;
  canteen: SchoolCanteenItem | null;
  floor?: string;
  value?: string;
  onSelect: (window: CanteenWindowItem) => void;
  onCancel: () => void;
}

export default function WindowPicker({ visible, canteen, floor, value, onSelect, onCancel }: WindowPickerProps) {
  const { scheme } = useAppColorScheme();
  const [items, setItems] = useState<CanteenWindowItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !canteen?.id) return;
    setKeyword("");
    setLoading(true);
    getCanteenWindows(canteen.id, floor)
      .then(setItems)
      .catch(async (error) => {
        setItems([]);
        await showUnifiedApiError(error, "获取窗口失败");
      })
      .finally(() => setLoading(false));
  }, [visible, canteen?.id, floor]);

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return items.filter((item) => !query || [item.name, item.floor, ...(item.aliases || [])].filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [items, keyword]);

  return (
    <View className={`canteen-picker-overlay ${visible ? "visible" : ""} ${scheme === "dark" ? "canteen-picker-overlay--dark" : ""}`} onClick={onCancel}>
      <View className='canteen-picker-card' onClick={(event) => event.stopPropagation()}>
        <View className='canteen-picker-header'>
          <View>
            <Text className='canteen-picker-title'>选择窗口</Text>
            <Text className='canteen-picker-subtitle'>{canteen?.name || "请先选择食堂"}{floor ? ` · ${floor}` : ""}</Text>
          </View>
          <Text className='canteen-picker-close' onClick={onCancel}>关闭</Text>
        </View>
        {!canteen?.id ? (
          <View className='canteen-picker-empty'><Text className='canteen-picker-empty-text'>请先选择食堂</Text></View>
        ) : (
          <>
            <View className='canteen-picker-search'>
              <Text className='canteen-picker-search-icon iconfont icon-sousuo' />
              <Input className='canteen-picker-input' placeholder='搜索窗口名称' value={keyword} onInput={(event) => setKeyword(event.detail.value)} />
            </View>
            <ScrollView className='canteen-picker-list' scrollY enhanced showScrollbar={false}>
              {loading ? (
                <View className='canteen-picker-loading'><View className='canteen-picker-spinner' /></View>
              ) : visibleItems.length === 0 ? (
                <View className='canteen-picker-empty'><Text className='canteen-picker-empty-text'>暂无已核验窗口</Text></View>
              ) : visibleItems.map((item) => (
                <View key={item.id} className={`canteen-picker-item ${value === item.id ? "selected" : ""}`} onClick={() => onSelect(item)}>
                  <Text className='canteen-picker-item-name'>{item.name}</Text>
                  <Text className='canteen-picker-item-meta'>{item.floor || "楼层待补充"}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}
