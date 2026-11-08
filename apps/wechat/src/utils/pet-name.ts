/**
 * 宠物怎么称呼：有宠物就用它自己的名字（用户能改名），游客和还没领养的人看到「健文伙伴」。
 * 底栏那一格固定叫「伙伴」，因为名字最长 12 个字，放不进底栏。不要在文案里写死某个名字。
 */
export const DEFAULT_PET_NAME = '健文伙伴'

export const PET_TAB_LABEL = '伙伴'

export function petDisplayName(name?: string | null): string {
  return String(name || '').trim() || DEFAULT_PET_NAME
}
