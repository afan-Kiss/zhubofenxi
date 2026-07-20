import React from 'react'

type AnyComponent = React.ComponentType<any>

/**
 * React.lazy 包装：部署后旧 chunk hash 404 时，自动整页刷新一次拉取新入口。
 */
export function lazyWithChunkReload<T extends AnyComponent>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isChunkError =
        /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\d]+ failed|error loading dynamically imported module/i.test(
          msg,
        )
      if (isChunkError && typeof window !== 'undefined') {
        const key = `chunk-reload:${window.location.pathname}`
        const already = sessionStorage.getItem(key)
        if (!already) {
          sessionStorage.setItem(key, '1')
          window.location.reload()
          // 保持 pending，避免刷新前渲染错误页
          return new Promise(() => {})
        }
        sessionStorage.removeItem(key)
      }
      throw err
    }
  })
}
