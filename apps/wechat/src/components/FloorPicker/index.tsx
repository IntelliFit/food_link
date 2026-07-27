import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import { getCanteenFloors, showUnifiedApiError, type CanteenFloorItem, type SchoolCanteenItem } from "../../utils/api";
import { useAppColorScheme } from "../AppColorSchemeContext";
import "../CanteenPicker/index.scss";

interface FloorPickerProps {
  visible: boolean;
  canteen: SchoolCanteenItem | null;
  value?: string;
  onSelect: (floor: string) => void;
  onCancel: () => void;
}

export default function FloorPicker({ visible, canteen, value, onSelect, onCancel }: FloorPickerProps) {
  const { scheme } = useAppColorScheme();
  const [floors, setFloors] = useState<CanteenFloorItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !canteen?.id) return;
    setLoading(true);
    getCanteenFloors(canteen.id)
      .then(setFloors)
      .catch(async (error) => {
        setFloors([]);
        await showUnifiedApiError(error, "获取楼层失败");
      })
      .finally(() => setLoading(false));
  }, [visible, canteen?.id]);

  return (
    <View className={`canteen-picker-overlay ${visible ? "visible" : ""} ${scheme === "dark" ? "canteen-picker-overlay--dark" : ""}`} onClick={onCancel}>
      <View className='canteen-picker-card' onClick={(event) => event.stopPropagation()}>
        <View className='canteen-picker-header'>
          <View>
            <Text className='canteen-picker-title'>选择楼层</Text>
            <Text className='canteen-picker-subtitle'>{canteen?.name || "请先选择食堂"}</Text>
          </View>
          <Text className='canteen-picker-close' onClick={onCancel}>关闭</Text>
        </View>
        {!canteen?.id ? (
          <View className='canteen-picker-empty'><Text className='canteen-picker-empty-text'>请先选择食堂</Text></View>
        ) : (
          <ScrollView className='canteen-picker-list' scrollY enhanced showScrollbar={false}>
            {loading ? (
              <View className='canteen-picker-loading'><View className='canteen-picker-spinner' /></View>
            ) : floors.length === 0 ? (
              <View className='canteen-picker-empty'><Text className='canteen-picker-empty-text'>暂无已核验楼层</Text></View>
            ) : floors.map((item) => (
              <View key={item.name} className={`canteen-picker-item ${value === item.name ? "selected" : ""}`} onClick={() => onSelect(item.name)}>
                <Text className='canteen-picker-item-name'>{item.name}</Text>
                {item.is_fallback && (
                  <Text className='canteen-picker-item-meta'>
                    {item.is_default ? "资料未标注楼层，默认选项" : "资料未标注楼层，可按实际情况选择"}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
