/** E2E 稳定标识：已知主播名 → data-testid */
const ANCHOR_CARD_TEST_IDS: Record<string, string> = {
  子杰: 'anchor-card-zijie',
  飞云: 'anchor-card-feiyun',
}

export function anchorCardTestId(anchorName: string): string | undefined {
  return ANCHOR_CARD_TEST_IDS[anchorName.trim()]
}
