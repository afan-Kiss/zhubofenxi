const { buildOrderAttributionDebug } = require('../dist/services/order-attribution-debug.service.js')

const orderNo = process.argv[2] || 'P798352144082164631'
buildOrderAttributionDebug(orderNo)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2))
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
