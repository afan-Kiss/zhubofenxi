/** 主播名比对：去空格、全角转半角、忽略大小写 */
export function normalizeAnchorName(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .replace(/\u3000/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function anchorNamesMatch(a: string, b: string): boolean {
  const na = normalizeAnchorName(a)
  const nb = normalizeAnchorName(b)
  if (!na || !nb) return false
  return na === nb
}
