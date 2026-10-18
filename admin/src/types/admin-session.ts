import { createContext, useContext } from 'react'

export type AdminRole = 'admin' | 'analytics_viewer'
export type AdminSession = { authenticated: boolean; account: { role: AdminRole } }
export const AdminRoleContext = createContext<AdminRole>('analytics_viewer')
export const useAdminRole = () => useContext(AdminRoleContext)
