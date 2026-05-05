import seedGroupQr from '../../../assets/community/foodlink-seed-group-20260512.png'
import userGroupQr2 from '../../../assets/community/foodlink-user-group-2-20260512.png'

export type UserGroupQrConfig = {
  id: string
  title: string
  subtitle: string
  qrImage: string
  expiresAt: string
  recommended?: boolean
}

export const USER_GROUP_QR_LIST: UserGroupQrConfig[] = [
  {
    id: 'user-group-2',
    title: '食探用户群',
    subtitle: '日常反馈、功能建议和使用交流',
    qrImage: userGroupQr2,
    expiresAt: '2026-05-12',
    recommended: true,
  },
  {
    id: 'seed-group',
    title: '食探种子群',
    subtitle: '早期共创和深度体验反馈',
    qrImage: seedGroupQr,
    expiresAt: '2026-05-12',
  },
]

export function getDefaultUserGroupQr(): UserGroupQrConfig {
  return USER_GROUP_QR_LIST.find(item => item.recommended) || USER_GROUP_QR_LIST[0]
}
