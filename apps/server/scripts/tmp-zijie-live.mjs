import { getOrBuildBusinessBoardCache } from '../dist/services/business-cache.service.js'

const cache = await getOrBuildBusinessBoardCache({
  preset: 'custom',
  startDate: '2026-06-01',
  endDate: '2026-06-01',
})
for (const v of cache.views.filter((x) => (x.anchorName || '').includes('子杰'))) {
  console.log({
    order: v.officialOrderNo,
    matchedLiveStart: v.matchedLiveStartTime,
    matchedLiveEnd: v.matchedLiveEndTime,
    liveAccount: v.liveAccountName,
    attr: v.attributionType,
  })
}
