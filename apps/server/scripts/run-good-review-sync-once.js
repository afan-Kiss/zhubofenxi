const { syncGoodReviews } = require('../dist/services/good-review/good-review-sync.service.js')

syncGoodReviews({ shop: 'all' })
  .then((r) => {
    console.log(JSON.stringify(r))
    process.exit(r.ok ? 0 : 1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(2)
  })
