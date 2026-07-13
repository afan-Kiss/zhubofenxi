import { querySfWaybillFee, loadSfWaybillConfigFromEnv } from '../src/services/sf-waybill-fee.service'

async function main() {
  const waybill = process.argv[2] || 'SF0217513214647'
  const cfg = loadSfWaybillConfigFromEnv()
  if (!cfg) {
    console.error('SF config missing from env')
    process.exit(1)
  }
  const r = await querySfWaybillFee(waybill, cfg)
  console.log(
    JSON.stringify({
      waybill,
      ok: r.ok,
      totalFeeYuan: r.totalFeeYuan,
      error: r.error,
      notBilled: r.notBilled,
      apiCode: r.apiCode,
    }),
  )
  process.exit(r.ok ? 0 : 1)
}

void main()
