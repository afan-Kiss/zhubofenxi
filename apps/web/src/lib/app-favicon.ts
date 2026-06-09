import { apiRequest } from './api'

export function applyAppFavicon(version?: string | number): void {
  const href = `/api/app/favicon?v=${version ?? Date.now()}`
  let link = document.getElementById('app-favicon') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = 'app-favicon'
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

export async function loadAndApplyAppFavicon(): Promise<void> {
  try {
    const data = await apiRequest<{ appFaviconPath: string }>('/api/settings/app-favicon')
    applyAppFavicon(data.appFaviconPath ? Date.now() : 'default')
  } catch {
    applyAppFavicon('default')
  }
}
