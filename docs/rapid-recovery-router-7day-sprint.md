# Rapid-Recovery-Router 7일 매출 스프린트 실행 가이드

## 목표

- 핵심 KPI: `외부 유료건수/일`
- 7일 목표: 외부 유료 7건
- 가격 구조: `0.02 -> 0.05 -> 0.12`
- 모델 정책: `OPENROUTER_MODEL` unset, `OPENROUTER_FREE_MODEL`만 사용

## 오퍼 구성

- `ops_recovery_hotfix_openrouter_v1` (0.02)
- `ops_recovery_turbo_v1` (0.05)
- `ops_recovery_guardrail_v1` (0.12)

모든 오퍼 설명 첫 줄은 아래 문제 키워드 고정:

- `timeout | validation | rejected | retry payload`

## 일일 운영 명령

### 1) 무료 모델 점검 + 배포

```bash
npm run openrouter:free:apply:deploy
```

실패 시 자동 롤백:

- `OPENROUTER_FREE_MODEL=openrouter/free`
- `OPENROUTER_MODEL` 삭제

### 2) KPI 리포트 생성 (JSON/CSV)

```bash
npx tsx scripts/rapid_recovery_kpi_report.ts \
  --window-hours 24 \
  --output-json logs/rapid_recovery_kpi_latest.json \
  --output-csv logs/rapid_recovery_kpi_latest.csv
```

포함 항목:

- `external_jobs_24h`
- `external_usdc_24h`
- offering별 전환
- 업셀 전환율
- 리드탐색 비용/성과

### 3) 프로필 자동 업데이트

```bash
npx tsx scripts/rapid_recovery_profile_daily_update.ts \
  --kpi-json logs/rapid_recovery_kpi_latest.json
```

업데이트 항목 제한:

- 최근 24h 외부 유료건수
- 평균 처리시간
- 대표 성공 케이스

### 4) 리드탐색 바운티 루프

```bash
npx tsx scripts/rapid_recovery_lead_bounty_loop.ts
```

가드레일:

- 전일 외부 유료건수 `< 1`일 때만 집행
- 일일 상한 `0.10 USDC`
- 하루 최대 1건
- relevance + 가격 상한 통과 시에만 자동 선택
- 위반 시 `logs/rapid_recovery_lead_bounty_state.json`에 자동 중단 기록

### 5) Telegram 타깃 시드 수집

사전 조건:

- `TELEGRAM_BOT_TOKEN` 설정
- 봇이 대상 그룹에 먼저 들어가 있거나, known contact가 먼저 봇에게 DM을 보낸 상태
- 이 단계는 `getUpdates`에서 **봇이 이미 볼 수 있는 chat만** 수집한다. username 스크래핑이나 cold outreach는 하지 않는다.

봇 워밍업:

1. BotFather로 봇 생성 후 `TELEGRAM_BOT_TOKEN` 확보
2. known contact와 1:1 DM을 시작하거나, 검토 가능한 운영 그룹에 봇을 추가
3. 각 대상이 최소 1회 메시지/멤버십 이벤트를 남기도록 해서 `getUpdates`에 잡히게 함

시드 후보 수집:

```bash
npm run rapid:telegram:collect
```

기본 출력 파일:

- `data/rapid_recovery_telegram_seed_candidates.json`

수집 결과 형식:

- 필수: `chatId`
- 선택: `name`, `username`, `chatType`, `source`, `language`, `enabled`, `note`
- collector 기본값:
  - `source="getUpdates"`
  - `language="en"`
  - `enabled=false`
  - `note="review before adding to rapid_recovery_telegram_targets.json"`

검토 후 curated target로 옮길 파일:

- `data/rapid_recovery_telegram_targets.json`

운영 대상 기본값:

- `enabled` 미지정 시 발송 허용
- `language` 미지정 시 `en`
- `source` 미지정 시 `manual`

### 6) Telegram 자동 아웃바운드

```bash
npx tsx scripts/rapid_recovery_telegram_outbound.ts
```

필수 환경변수:

- `TELEGRAM_BOT_TOKEN`

기본 타깃 파일:

- `data/rapid_recovery_telegram_targets.json`

Dry-run 권장:

```bash
npm run rapid:telegram:outbound -- --dry-run
```

가드레일:

- 일일 총 발송 상한
- 대상별 쿨다운
- 중복 메시지 차단
- 금지 키워드 필터
- 연속 실패/거부율/신고 신호 기반 즉시 중단

로그:

- `logs/rapid_recovery_telegram_send_log.jsonl`
- 필드: `who/when/template/version/result`

### 7) 일일 통합 실행

```bash
npm run rapid:daily
```

Dry-run:

```bash
npm run rapid:daily -- --dry-run
```

현재 phase 기본 동작:

- `rapid:daily`는 **Telegram outbound**와 **lead bounty**를 기본적으로 `--dry-run`으로 실행
- 라이브 전환은 명시적으로 아래 env를 켜야 한다:
  - `RAPID_RECOVERY_TELEGRAM_LIVE=true`
  - `RAPID_RECOVERY_LEAD_BOUNTY_LIVE=true`

### 8) Wallet-gated autopilot

`rapid-recovery-router`는 seller wallet이고, 자동 spend는 항상 canonical shared buyer인 `virtual-root-market`에서만 집행한다.

현재 구현상 실제 ACP agent name은 `ops-buyer-hub`지만, root wallet ops에서는 이 key를 `virtual-root-market` shared entry로 매핑한다.

Autopilot 실행:

```bash
npm run rapid:autopilot
```

판단 기준:

- root wallet report에서 `ops-buyer-hub`가 `eligibleForLiveOps=true`여야 함
- `rapid-recovery-router`는 linked/reachable 이어야 함
- Telegram enabled target 수가 1개 이상이어야 함

막히면:

- exact blocking reason을 summary에 기록
- `rapid:daily -- --dry-run`으로 폴백

라이브 허용 시:

- `openrouter_free_daily_check` apply/deploy
- KPI report 생성
- rapid seller profile update
- buyer wallet 기준 lead bounty live 실행
- Telegram outbound live 실행

기본 summary 파일:

- `logs/rapid_recovery_autopilot_latest.json`

라이브 상한:

- Telegram `15/day`
- lead bounty `0.10 USDC/day`
- ACP auto-select job cap `0.10 USDC/job`

## ACP 노출 카피 포맷

- 입력 1줄
- 복구결과 3종(JSON)
- CTA: `0.02 진입 -> 0.05 Turbo -> 0.12 Guardrail`

## Telegram 노출 템플릿 원칙

- 단문 문제-해결-CTA 구조
- 금지: 과장, 수익보장, 스팸성 키워드
- CTA는 항상 `0.02 -> 0.05/0.12` 경로만 노출
