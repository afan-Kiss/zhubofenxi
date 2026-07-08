import fs from 'node:fs'
import path from 'node:path'
import type { Express, Request, Response, Router } from 'express'
import express from 'express'
import { getWebBasePath, SERVER_ROOT } from '../config/env'

/** 生产构建产物：apps/web/dist */
export function getWebDistPath(): string {
  return path.resolve(SERVER_ROOT, '../web/dist')
}

export function isWebDistAvailable(): boolean {
  return fs.existsSync(path.join(getWebDistPath(), 'index.html'))
}

function createWebRouter(dist: string, indexHtml: string): Router {
  const router = express.Router()
  const assetsDir = path.join(dist, 'assets')

  if (fs.existsSync(assetsDir)) {
    router.use(
      '/assets',
      express.static(assetsDir, {
        index: false,
        maxAge: '1h',
        setHeaders(res) {
          res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate')
        },
      }),
    )
  }

  router.use(
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

  router.get(['/', '/login', '/admin', '/dashboard', '/register'], sendSpa)

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    // 缺失的前端静态资源必须 404，不能回退 index.html（否则浏览器会把 HTML 当 JS 执行 → 白屏）
    if (req.path.startsWith('/assets/')) {
      res.status(404).type('text/plain').send('Not Found')
      return
    }
    sendSpa(req, res)
  })

  return router
}

/**
 * 托管前端静态资源；未构建时返回 false（开发模式仅提供 API）。
 * - /api/* 已在上方注册，不会进入此处
 * - WEB_BASE_PATH=/zhubofenxi 时入口为 /zhubofenxi/
 */
export function mountWebStatic(app: Express): boolean {
  const dist = getWebDistPath()
  const indexHtml = path.join(dist, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    return false
  }

  const base = getWebBasePath()
  const router = createWebRouter(dist, indexHtml)

  if (base) {
    app.use(base, router)
    app.get(base, (_req, res) => res.redirect(301, `${base}/`))
    return true
  }

  const assetsDir = path.join(dist, 'assets')
  if (fs.existsSync(assetsDir)) {
    app.use(
      '/assets',
      express.static(assetsDir, {
        index: false,
        maxAge: '1h',
        setHeaders(res) {
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

  app.get(['/', '/login', '/admin', '/dashboard', '/register'], sendSpa)

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    if (req.path.startsWith('/assets/')) {
      res.status(404).type('text/plain').send('Not Found')
      return
    }
    sendSpa(req, res)
  })

  return true
}
