# Virtuals ACP 상태 점검 리포트 (2026-03-03)

## 1) 점검 시각/범위
- 점검 시각(UTC): 2026-03-03T04:04:22Z
- 점검 시각(KST): 2026-03-03 13:04:22
- 점검 대상:
  - 전체 에이전트 지갑 USDC 합계
  - 2차/3차 웨이브 관련 잡 상태
  - printful 구계정/복구계정 잔액 포함 여부

## 2) 총 잔액 (다 합산)
- 합산 결과: **2.510106 USDC**
- 고유 지갑 수: 8

지갑별 잔액:
- `delivery-orchestrator-hub` (`0xbB8aAB...f319E`): `1.040000`
- `agent dangu` (`0x57375f...08745`): `0.878000`
- `o2o-printful-hub` (`0x092Bd6...45657`): `0.328000`
- `virtual-outreach-orchestrator` (`0x79d4Cd...12Ce7`): `0.262000`
- `buyer-20260225` (`0xA0bef3...F8DdB`): `0.002106`
- `buyer-20260228` (`0x45cdCE...9Bc8F`): `0.000000`
- `printful agent` (구계정, `0xcaD730...2e46e`): `0.000000`
- `printful-agent-recovered` (복구계정, `0xA93af8...A5864`): `0.000000`

## 3) printful 잔액 포함 이슈 정리
- 기존 문구의 “printful agent 전환 실패로 잔액 미포함”은 현재 기준으로 정정 가능.
- 이번 합산에는 아래 3개를 모두 반영함:
  - `printful agent` (구계정)
  - `printful-agent-recovered` (복구계정)
  - `o2o-printful-hub` (실운영 허브)
- printful 관련 라인 합계:
  - `printful agent` + `printful-agent-recovered` + `o2o-printful-hub`
  - = `0.000000 + 0.000000 + 0.328000 = 0.328000 USDC`

## 4) 웨이브/잡 상태 (최신)
- `1002587617` (`virtual_outreach_execution_multiagent_v1`): **COMPLETED**
- `1002587626` (하위 dispatch, AdNexus `micro_ping`): **COMPLETED**
- `1002587627` (하위 dispatch, AgentReputer `promote_agent`): **REQUEST**
- `1002587630` (하위 dispatch, KimchiAlpha `promote_agent`): **REQUEST**
- `1002587560` (이전 시도): **REQUEST 고착**
  - Railway 로그 기준 만료/403 이력 존재

## 5) 관찰 포인트
- ACP `job status` API는 간헐적으로 500을 반환함(재시도 시 정상 복구되는 케이스 확인).
- 현재 손실/이동의 핵심은 “숨겨진 지갑”보다는 **완료된 캠페인 지출 + 진행중 잡 정산 대기** 쪽에 가까움.
- 최소한 현재 집계 범위에서는 “다른 계정에 잠든 큰 잔액” 징후는 보이지 않음.

## 6) 바로 실행 가능한 운영 액션
1. `1002587627`, `1002587630` 완료까지 폴링 후 회수 신호(`recovered_usdc`) 재집계
2. `1002587560`는 만료 처리 여부 확인 후 필요 시 운영 대시보드에서 종료/무시 처리
3. 다음 웨이브는 `require_prev_wave_recovery=true` 유지 + `daily_external_spend_cap_usdc=0.3` 고정

## 7) 점검 명령
```bash
cd /Users/daeyounglee/virtuals-protocol-acp-buyer
./scripts/aggregate_agent_usdc.mjs
./bin/acp.ts whoami --json
./bin/acp.ts job status 1002587617 --json
./bin/acp.ts job status 1002587626 --json
./bin/acp.ts job status 1002587627 --json
./bin/acp.ts job status 1002587630 --json
```
