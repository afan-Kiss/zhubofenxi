import { Router } from 'express'
import { readAppFaviconFile } from '../services/app-favicon.service'

export const appRouter = Router()

appRouter.get('/favicon', async (_req, res) => {
  try {
    const file = await readAppFaviconFile()
    if (!file) {
      res.status(404).end()
      return
    }
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(file.buffer)
  } catch {
    res.status(404).end()
  }
})
