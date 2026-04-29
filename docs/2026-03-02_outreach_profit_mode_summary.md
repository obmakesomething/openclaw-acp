# Virtuals ACP 아웃리치 운영 정리 (2026-03-02)

## 1) 현재 결론 (요약)
- 돈이 사라진 것이 아니라, **완료된 ACP 잡 결제로 외부 프로바이더에 지출**된 상태다.
- `printful agent` 기존 계정(`id=3885`)은 서버상 `hasApiAccess=false`로 사실상 고장 상태이며, 직접 복구 불가.
- 대체 계정 `printful-agent-recovered`(`id=17506`)를 생성해 운영 가능한 상태로 전환 완료.
- 수익화 이전에 집행이 먼저 커진 구조를 막기 위해 **수익모드 가드레일 4종**(하드캡/선회수/고비용제외/PnL 리포트)을 코드에 반영 완료.

---

## 2) 계정/지갑 복구 상태

### 기존 문제 계정
- 이름: `printful agent`
- ID: `3885`
- 지갑: `0xcaD730948C0c4D9C37f60aD7ba899514B902e46e`
- 상태:
  - 목록에는 남아있음
  - `regenerate-api` 실패 (`Agent not found`/404 경로)
  - `hasApiAccess=false`
  - 실사용 불가

### 복구 계정 (신규)
- 이름: `printful-agent-recovered`
- ID: `17506`
- 지갑: `0xA93af8e39B5D5108B3e59eA00DC4F9364bAA5864`
- 상태:
  - API key 발급/스위치 확인 완료
  - `buyer`, `external-buyer` 양쪽에서 전환 가능 확인

---

## 3) 자금 현황 (최신 스냅샷)
- 기준: `2026-03-02T09:07:01Z` (`aggregate_agent_usdc.mjs` 실행 결과)
- 총합: `2.584106 USDC`
- 고유 지갑 수: `8`

지갑별 USDC:
- `delivery-orchestrator-hub`: `1.160000`
- `agent dangu`: `0.878000`
- `o2o-printful-hub`: `0.328000`
- `virtual-outreach-orchestrator`: `0.216000`
- `buyer-20260225`: `0.002106`
- `buyer-20260228`: `0.000000`
- `printful agent`(구): `0.000000`
- `printful-agent-recovered`: `0.000000`

---

## 4) 지출 분석 (완료 잡 기준)

집계 결과:
- 완료 잡 기반 총 지출: `4.81 USDC`
  - `agent dangu`: `0.81`
  - `buyer-20260225`: `3.28`
  - `virtual-outreach-orchestrator`: `0.72`
- 분해:
  - 내부 지갑 간 이동: `1.63 USDC`
  - 외부 프로바이더 지출: `3.18 USDC`

외부 지출 상위 프로바이더:
- `0x9061f82d80fe52eadd3b1e70947c6ad18f3b36a4`: `2.000000`
- `0x803f95cc43e940548b55846bcbbae5476d8cd8c7`: `0.600000`
- `0x864b43ae1bad54fb768adc13b5097efea89850cf`: `0.200000`
- `0x72dc31061751a5f93a0b57e37df951de2de14b94`: `0.150000`
- 기타 합산: `0.230000`

---

## 5) 왜 수익이 안 났는가 (원인 정리)
- `outreach/boost` 집행이 선행되고, 회수/전환 조건이 약해 비용만 먼저 발생.
- 일부는 내부 지갑 순환 거래로, 트래픽 신호는 생겨도 순이익으로 바로 연결되지 않음.
- 고비용 외부 프로바이더에 대한 하드 제한이 없어서 단일 지출이 커졌음.
- `printful` 구계정 고장으로 운영 파이프가 중간중간 비정상.

---

## 6) 코드 반영 내역 (수익모드 가드레일)

## 6-1. 반영 파일
- `/Users/daeyounglee/virtuals-protocol-acp-buyer/src/seller/runtime/outreachEngines.ts`
- `/Users/daeyounglee/virtuals-protocol-acp-buyer/src/seller/offerings/virtual-outreach-orchestrator/virtual_outreach_execution_multiagent_v1/handlers.ts`
- `/Users/daeyounglee/virtuals-protocol-acp-buyer/src/seller/offerings/virtual-outreach-orchestrator/virtual_outreach_execution_multiagent_v1/offering.json`
- `/Users/daeyounglee/virtuals-protocol-acp-buyer/tests/outreach_finance_guards.test.ts`

## 6-2. 가드레일 4종
1. 일일 외부지출 하드캡
- `daily_external_spend_cap_usdc` 초과 시 외부 프로바이더 자동 차단

2. 선회수 후집행 게이트
- 직전 라이브 웨이브 `recoverySignals=0`이면 다음 웨이브 차단
- 필요 시 `force_dispatch=true`로 예외 실행 가능

3. 고비용 자동 제외
- `high_cost_provider_threshold_usdc` 초과 프로바이더 제외

4. PnL 레저/리포트
- 웨이브 결과를 `logs/outreach_pnl_ledger.json`에 저장
- 응답에 `pnlReport`, `guardrails`, `excludedHighCost`, `blockedByDailyCap` 포함

---

## 7) 신규 입력 파라미터

`virtual_outreach_execution_multiagent_v1`에 추가:
- `high_cost_provider_threshold_usdc`
- `daily_external_spend_cap_usdc`
- `require_prev_wave_recovery`
- `force_dispatch`
- `recovery_poll_seconds`

---

## 8) 테스트/검증 결과

실행 성공:
- `npx tsx --test tests/outreach_finance_guards.test.ts` → `4/4 PASS`
- `npx tsc --noEmit --target ES2022 --module Node16 --moduleResolution Node16 --strict src/seller/runtime/outreachEngines.ts src/seller/offerings/virtual-outreach-orchestrator/virtual_outreach_execution_multiagent_v1/handlers.ts` → `PASS`

참고:
- 전체 `npx tsc --noEmit`은 기존 `_archived` 하위 파일의 선행 문제로 실패(이번 변경과 무관).

---

## 9) 운영 권장값 (보수 모드)

아래 값으로 웨이브 실행 권장:
- `dispatch_jobs=true`
- `max_targets=3`
- `max_provider_price_usdc=0.05`
- `high_cost_provider_threshold_usdc=0.05`
- `daily_external_spend_cap_usdc=0.30`
- `require_prev_wave_recovery=true`
- `recovery_poll_seconds=20`
- `force_dispatch=false`

---

## 10) 운영 체크리스트
- [ ] `printful-agent-recovered` 지갑 충전
- [ ] 1회차 웨이브 실행 후 `pnlReport.net_usdc`, `recovery_rate` 확인
- [ ] `recoverySignals=0`이면 다음 웨이브 자동 차단 동작 확인
- [ ] 외부 지출이 일일 캡 내에서 유지되는지 확인
- [ ] 비용 대비 회수/전환 지표가 붙으면 캡을 단계적으로 상향

---

## 11) 빠른 실행 명령

잔액 집계:
```bash
cd /Users/daeyounglee/virtuals-protocol-acp-buyer
./scripts/aggregate_agent_usdc.mjs
```

복구 계정 전환:
```bash
cd /Users/daeyounglee/virtuals-protocol-acp-buyer
./bin/acp.ts agent switch --wallet 0xA93af8e39B5D5108B3e59eA00DC4F9364bAA5864 --json
```

