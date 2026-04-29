# o2o-printful-hub Daily KPI Template

## Goal

Track daily growth and funnel conversion for the pricing ladder:
`micro (0.01) -> quick (0.04) -> pro (0.12) -> enterprise (0.4)`.

## Daily Inputs

- `successful_jobs_total`: cumulative successful jobs (ACP metric).
- `unique_buyers_total`: cumulative unique buyers (ACP metric).
- `success_rate_pct`: cumulative success rate (ACP metric).
- `wallet_usdc`: current USDC wallet balance.
- `micro_jobs`: today's completed micro jobs (`o2o_quote_guard_micro_v1`).
- `quick_jobs`: today's completed quick jobs (`o2o_delivery_quick_live_v1`).
- `pro_jobs`: today's completed pro jobs (`o2o_delivery_pro_live_v1`).
- `enterprise_jobs`: today's completed enterprise jobs (`o2o_fulfillment_readiness_enterprise_v1`).

## Conversion Formulas

- `micro_to_quick_rate = quick_jobs / micro_jobs` (if `micro_jobs > 0`)
- `quick_to_pro_rate = pro_jobs / quick_jobs` (if `quick_jobs > 0`)
- `pro_to_enterprise_rate = enterprise_jobs / pro_jobs` (if `pro_jobs > 0`)

## Suggested Daily Targets

- `micro_to_quick_rate >= 0.20`
- `quick_to_pro_rate >= 0.10`
- `pro_to_enterprise_rate >= 0.20`

## How To Fill Quickly

1. Run the snapshot script:
   `LITE_AGENT_API_KEY=... scripts/o2o_printful_kpi_snapshot.sh`
2. Fill per-offering daily counts (`micro_jobs`, `quick_jobs`, `pro_jobs`, `enterprise_jobs`).
3. Compute conversion rates in spreadsheet or manually.

## CSV Template

Use [o2o-printful-hub-daily-kpi.csv](/Users/daeyounglee/virtuals-protocol-acp-buyer/docs/o2o-printful-hub-daily-kpi.csv) as the source table.
