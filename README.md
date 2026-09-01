# element-nft-watcher

BNB Chain NFT 컬렉션의 **최저가(floor price)** 를 감시하다가, 지정한 목표가 이하로
떨어지면 Discord 등으로 알림을 보내는 도구.

| 파일 | 데이터 소스 | 방식 | 특징 |
| --- | --- | --- | --- |
| `watcher.js` | NFTScan API | 폴링(기본 60초) | **메인.** 즉시 발급되는 키로 바로 사용 가능 |
| `check-floors.js` | NFTScan API | 1회 조회 | 현재 floor 확인용 (`npm run floors`) |
| `stream-watcher.js` | Element Stream API | WebSocket 실시간 | Element API 키(수동 심사) 승인 후 보조로 사용 |

## 준비물

1. **NFTScan API 키** — <https://developer.nftscan.com> 대시보드에서 즉시 발급 (무료 티어)
2. **알림 채널 최소 1개** (`.env` 에 설정한 채널로 모두 전송, 없으면 콘솔 출력만)

   | 채널 | 설정 변수 | 발급 방법 |
   | --- | --- | --- |
   | Discord | `DISCORD_WEBHOOK_URL` | 채널 설정 > 연동 > 웹후크 > URL 복사 |
   | Telegram | `TG_TOKEN`, `TG_CHAT_ID` | `@BotFather` `/newbot` → 토큰. 봇에 메시지 후 `https://api.telegram.org/bot<토큰>/getUpdates` 에서 `chat.id` |
   | Slack | `SLACK_WEBHOOK_URL` | <https://api.slack.com/messaging/webhooks> 에서 Incoming Webhook 생성 |
   | ntfy | `NTFY_TOPIC` (선택 `NTFY_SERVER`, `NTFY_TOKEN`) | 앱 설치 후 임의 토픽 구독. 계정 불필요 |
   | Pushover | `PUSHOVER_TOKEN`, `PUSHOVER_USER` | <https://pushover.net> (앱 1회 $5) |
   | 범용 Webhook | `WEBHOOK_URL` | `{ "text": "..." }` 형태로 POST |

3. **Node.js 20 이상**
4. (선택) **Element API 키** — <https://forms.gle/78wpggURGADCjshr7> 신청, 수동 심사. `stream-watcher.js`(실시간 매물 이벤트)에만 필요

## 설정

```bash
cp .env.example .env
cp config.example.json config.json
npm install            # stream 방식에 필요한 ws 설치
```

`.env`

```
NFTSCAN_API_KEY=발급받은_키
# 아래 중 쓰고 싶은 채널만 채우면 된다 (전체 목록은 .env.example 참고)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`config.json`

```jsonc
{
  "intervalMs": 60000,           // 폴링 주기(ms). floor price 갱신이 분 단위라 60초면 충분
  "watchlist": [
    {
      "name": "표시용 이름",
      "contract": "0x... NFT 컨트랙트 주소 (BNB Chain)",
      "slug": "element 컬렉션 슬러그",   // 알림 링크 및 stream-watcher.js 용
      "maxPriceBnb": 0.5             // 목표가(BNB). floor 가 이 값 이하이면 알림
    },
    {
      "name": "USD 로 목표가 지정",
      "contract": "0x...",
      "maxPriceUsd": 300              // maxPriceBnb 대신 USD 로 지정 (Binance 시세로 환산)
    }
  ]
}
```

- `maxPriceBnb` 와 `maxPriceUsd` 중 하나만 있으면 된다. 둘 다 있으면 `maxPriceBnb` 우선.
- 목표가를 못 정했으면 먼저 `npm run floors` 로 현재 floor 를 확인한다.

## 실행

```bash
npm run floors         # 현재 floor price 한 번 조회 (목표가 정할 때 참고)
npm run test:notify    # 알림 채널 설정 확인
npm run poll           # 감시 시작 (NFTScan 폴링)
```

상시 실행은 pm2 권장.

```bash
npm i -g pm2
pm2 start watcher.js --node-args="--env-file=.env" --name nft-poll
pm2 save && pm2 startup
```

## 동작 메모

- `seen.json` 에 컬렉션별 알림 상태(`notified`, 마지막 알림 시점의 floor)를 저장해 같은 상태로 반복 알림하지 않는다.
  - 목표가 이하로 처음 떨어지면 알림 → 계속 그 이하여도 재알림 없음 → 목표가 위로 회복 후 다시 떨어지면 재알림.
  - 더 떨어지면(가격이 낮아지면) 그 시점에 다시 알림.
- floor price 는 NFTScan 이 여러 마켓 데이터를 취합한 값이라 실제 반영까지 약간의 지연이 있을 수 있다.
- NFTScan 무료 티어 CU 한도 내에서 컬렉션 수 × (3600 / intervalMs) 로 하루 호출량을 가늠한다.

## 사용 API

- `GET https://bnbapi.nftscan.com/api/v2/statistics/collection/{contract}` — 컬렉션 통계(`floor_price` 포함), 헤더 `X-API-KEY`
- `https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT` — BNB/USD 시세 (키 불필요)
- (stream-watcher.js) `wss://feeds.element.market/websocket?token=<API_KEY>` — Element Stream API, 30초마다 `{"topic":"ping"}` 필요

문서: <https://docs.nftscan.com/> · <https://element.readme.io/reference/api-overview>

## 주의

- 이 도구는 알림만 한다. 자동 매수 기능은 없다.
- floor price 감시라 "어떤 번호가 그 가격인지"는 알려주지 않는다. 알림의 링크로 들어가서 확인해야 한다.
- `.env`, `config.json`, `seen.json` 은 커밋되지 않는다(`.gitignore`).
