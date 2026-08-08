import AsyncStorage from '@react-native-async-storage/async-storage'

const EXACT_CACHE_KEYS = new Set([
  'home_dashboard_local_cache',
  'showRecordMenuModal',
  'homeRecordMenuDate',
  'home_pet_companion_collapsed_v1',
  'home_pet_companion_float_position_v1',
  'mobile_community_search_history',
  'food_link_mobile_analysis_health_profile_prompt_shown',
  'mobile_profile_tab_badge_count',
  'mobile_profile_tab_badge_expiry_count',
  'mobile_profile_tab_badge_friend_count',
  'mobile_profile_tab_badge_friend_pending_ids',
  'mobile_profile_tab_badge_friend_seen_ids',
  'mobile_food_expiry_last_seen_date',
  'circle_post_draft_v2',
  'circle_post_draft_tip_shown_v1',
])

const CACHE_KEY_PREFIXES = [
  'comment_draft_',
  'temp_comments_',
  'record_manual_custom_foods_v1:',
  'mobile_community_feed_v2:',
  'mobile_community_priority_authors_v1:',
  'mobile_community_filters_v1:',
  'healthProfileReminderSnoozedUntil:',
  'home_backfill_hint_dismissed_dates_v1:',
  'onboarding_home_record_guide_v1:user:',
]

/**
 * 清理可重建的用户缓存，同时保留登录凭证、主题和“隐藏首页宠物”等明确偏好。
 * 新增本地缓存时应同步登记到这里，避免“清除缓存”只清理提示文案、没有清理真实数据。
 */
export async function clearMobileUserCache(): Promise<number> {
  const keys = await AsyncStorage.getAllKeys()
  const removable = keys.filter((key) => (
    EXACT_CACHE_KEYS.has(key)
    || CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  ))
  if (removable.length > 0) await AsyncStorage.multiRemove(removable)
  return removable.length
}
