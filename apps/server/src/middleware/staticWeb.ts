import fs from 'node:fs'
import path from 'node:path'
import type { Express, Request, Response } from 'express'
import express from 'express'
import { SERVER_ROOT } from '../config/env'

/** 生产构建产物：apps/web/dist */
export function getWebDistPath(): string {
  return path.resolve(SERVER_ROOT, '../web/dist')
}

export function isWebDistAvailable(): boolean {
  return fs.existsSync(path.join(getWebDistPath(), 'index.html'))
}

/**
 * 托管前端静态资源；未构建时返回 false（开发模式仅提供 API）。
 * - /api/* 已在上方注册，不会进入此处
 * - /assets/* 长缓存 immutable
 * - index.html 不缓存
 */
export function mountWebStatic(app: Express): boolean {
  const dist = getWebDistPath()
  const indexHtml = path.join(dist, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    return false
  }

  const assetsDir = path.join(dist, 'assets')
  if (fs.existsSync(assetsDir)) {
    app.use(
      '/assets',
      express.static(assetsDir, {
        index: false,
        maxAge: '1h',
        setHeaders(res) {
          // 避免前端发版后浏览器长期命中旧 bundle（此前 immutable 365d 会导致「查看日报」等修复不生效）
          res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate')
        },
      }),
    )
  }

  app.use(
    express.static(dist, {
      index: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )

  const sendSpa = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexHtml)
  }

  app.get(['/', '/login', '/admin', '/dashboard'], sendSpa)

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    sendSpa(req, res)
  })

  return true
}
