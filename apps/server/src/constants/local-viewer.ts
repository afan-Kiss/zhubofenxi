import type { SessionUser } from '../types/auth'

/** 免登录本地看板固定身份，用于兼容仍读取 req.user 的代码 */
export const LOCAL_VIEWER_USER: SessionUser = {
  id: 'local-viewer',
  username: '本地看板',
  role: 'local_viewer',
  name: '本地看板',
}
