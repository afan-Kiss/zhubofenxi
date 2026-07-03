/**
 * 检查主路由/主菜单是否出现财务、对账、提成工资等主模块。
 * 遗留组件文件不在主菜单时允许存在，但不得新增主入口。
 */
import {
  fail,
  pass,
  readText,
  repoPath,
  toRepoRelative,
  walkFiles,
} from './_shared'

const ALLOWED_PRIMARY_ROUTES = new Set([
  '/',
  '/anchors',
  '/anchor-schedules',
  '/buyers',
  '/operations-report',
  '/good-reviews',
  '/data-health',
  '/settings',
])

const AUTH_ROUTES = new Set(['/login', '/register'])

const MOBILE_UTILITY_ROUTES = new Set(['/mobile/daily-report-upload'])

const REDIRECT_ONLY_ROUTES = new Set([
  '/orders',
  '/billing',
  '/dashboard',
  '/buyer-ranking',
  '/anchor-weekly-ranking',
  '/admin',
  '/anchors/:anchorId',
])

const FORBIDDEN_ROUTE_KEYWORDS = [
  'finance',
  'financial',
  'profit',
  'settlement-center',
  'billing-center',
  'commission',
  'salary',
  'payroll',
  'reconciliation',
  '对账',
  '财务',
  '利润',
  '提成',
  '工资',
]

const FORBIDDEN_MENU_TERMS = [
  '财务中心',
  '账单对账',
  '平台结算',
  '利润分析',
  '提成',
  '工资',
  '对账中心',
  '结算中心',
]

const FORBIDDEN_PAGE_FILE_PATTERNS = [
  /Finance(Center|Tab|Page)?\.tsx$/i,
  /Billing(Center|Tab|Page)?\.tsx$/i,
  /Profit(Analysis|Center|Tab)?\.tsx$/i,
  /Settlement(Center|Tab|Page)?\.tsx$/i,
  /Commission(Tab|Page)?\.tsx$/i,
  /Salary(Tab|Page)?\.tsx$/i,
  /Payroll(Tab|Page)?\.tsx$/i,
  /Reconciliation(Tab|Page)?\.tsx$/i,
  /OrderList(Tab|Page)?\.tsx$/i,
  /Orders(Tab|Page)?\.tsx$/i,
]

function normalizeRoutePath(routePath: string): string {
  if (routePath === '*') return routePath
  return routePath.startsWith('/') ? routePath : `/${routePath}`
}

function extractRoutePaths(appSource: string): string[] {
  const paths: string[] = []
  const re = /<Route[^>]*\spath=["'{]([^"'}]+)["'}]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(appSource)) !== null) {
    paths.push(normalizeRoutePath(m[1]!))
  }
  return paths
}

function isRedirectRoute(appSource: string, routePath: string): boolean {
  const variants = [
    routePath,
    routePath.replace(/^\//, ''),
  ]
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `<Route\\s+path=["']${escaped}["'][^>]*element=\\{[^}]*Navigate`,
    )
    if (re.test(appSource)) return true
  }
  return false
}

function checkAppRoutes(): string[] {
  const appFile = repoPath('apps/web/src/App.tsx')
  const source = readText(appFile)
  const issues: string[] = []
  const paths = extractRoutePaths(source)

  for (const routePath of paths) {
    if (routePath === '*') continue

    const lower = routePath.toLowerCase()
    for (const kw of FORBIDDEN_ROUTE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase()) && !REDIRECT_ONLY_ROUTES.has(routePath)) {
        issues.push(`App.tsx 路由 ${routePath} 含疑似财务/对账关键词「${kw}」`)
      }
    }

    if (ALLOWED_PRIMARY_ROUTES.has(routePath)) continue
    if (AUTH_ROUTES.has(routePath)) continue
    if (MOBILE_UTILITY_ROUTES.has(routePath)) continue
    if (REDIRECT_ONLY_ROUTES.has(routePath)) {
      if (!isRedirectRoute(source, routePath)) {
        issues.push(`App.tsx 路由 ${routePath} 应为重定向，不应渲染独立页面`)
      }
      continue
    }

    if (!isRedirectRoute(source, routePath)) {
      issues.push(`App.tsx 存在未登记的主路由：${routePath}`)
    }
  }

  return issues
}

function checkMainNav(): string[] {
  const layoutFile = repoPath('apps/web/src/components/Layout.tsx')
  const source = readText(layoutFile)
  const issues: string[] = []

  for (const term of FORBIDDEN_MENU_TERMS) {
    if (source.includes(term)) {
      issues.push(`Layout.tsx 主菜单含禁用模块名：${term}`)
    }
  }

  const navBlock = source.match(/const MAIN_NAV[\s\S]*?\]/)?.[0] ?? source
  const toMatches = [...navBlock.matchAll(/to:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
  for (const to of toMatches) {
    if (!ALLOWED_PRIMARY_ROUTES.has(to)) {
      issues.push(`Layout.tsx 主菜单链接 ${to} 不在允许列表（/、/anchors、/buyers、/settings 等）`)
    }
  }

  return issues
}

function checkForbiddenPageFiles(): string[] {
  const pagesRoot = repoPath('apps/web/src/pages')
  const issues: string[] = []

  for (const file of walkFiles(pagesRoot)) {
    const rel = toRepoRelative(file)
    const base = rel.split('/').pop() ?? rel
    for (const pattern of FORBIDDEN_PAGE_FILE_PATTERNS) {
      if (pattern.test(base)) {
        issues.push(`发现疑似财务/订单明细主页面文件：${rel}`)
      }
    }
  }

  return issues
}

function main(): void {
  const issues = [
    ...checkAppRoutes(),
    ...checkMainNav(),
    ...checkForbiddenPageFiles(),
  ]

  if (issues.length > 0) {
    fail('检测到疑似财务/对账/订单明细主模块入口', issues)
  }

  pass('主路由与主菜单未新增财务/对账/提成/订单明细主模块')
}

main()
