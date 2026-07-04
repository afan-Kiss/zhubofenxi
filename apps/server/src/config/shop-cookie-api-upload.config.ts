/** API 批量上传 Cookie（POST /api/shop-cookies/update）是否启用，默认关闭 */
export const SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE =
  '已关闭 API 上传 Cookie，请在系统设置中手动粘贴 Cookie。'

export function isShopCookieApiUploadEnabled(): boolean {
  const raw = String(process.env.SHOP_COOKIE_API_UPLOAD_ENABLED || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}
