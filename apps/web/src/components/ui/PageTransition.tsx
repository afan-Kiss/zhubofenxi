import React from 'react'
import { useLocation } from 'react-router-dom'

/** 主路由页面切换：淡入 + 轻微上移 */
export const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="board-page-enter min-w-0">
      {children}
    </div>
  )
}
