import userGroupQr from '../../../assets/community/foodlink-user-group-permanent-20260602.jpg'

export type UserGroupQrConfig = {
  id: string
  title: string
  subtitle: string
  qrImage: string
}

export const USER_GROUP_QR_LIST: UserGroupQrConfig[] = [
  {
    id: 'user-group-permanent',
    title: '食探用户群',
    subtitle: '日常反馈、功能建议和使用交流',
    qrImage: userGroupQr,
  },
]

export function getDefaultUserGroupQr(): UserGroupQrConfig {
  return USER_GROUP_QR_LIST[0]
}
