/** Admin 后端 API 根地址，由 VITE_ADMIN_API_BASE_URL 注入，不在代码中写死域名 */
export function getAdminApiBaseUrl(): string {
  return (import.meta.env.VITE_ADMIN_API_BASE_URL || '').replace(/\/+$/, '')
}
