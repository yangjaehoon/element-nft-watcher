# element-nft-watcher

Element(BNB Chain) 마켓플레이스에서 관심 있는 NFT의 **최저 호가**를 감시하다가,
지정한 목표가(USD) 이하로 매물이 올라오면 Telegram으로 알림을 보내는 도구.

두 가지 방식을 제공한다.

| 파일 | 방식 | 특징 |
| --- | --- | --- |
| `watcher.js` | Element OpenAPI 폴링(기본 20초) | 단순하고 견고. 컬렉션당 요청 1개, 취소된 매물에 강함 |
| `stream-watcher.js` | Element Stream API(WebSocket) `item_listed` | 실시간 푸시. 대신 순서 보장·재전송 없음 |

둘 다 같은 `config.json` / `.env` 를 쓴다. 누락 방지를 원하면 폴링을 상시로 돌리고 스트림을 보조로 함께 실행한다.

## 준비물

1. **Element API 키** — <https://forms.gle/78wpggURGADCjshr7> 로 신청 (레이트리밋 120요청/분/키)
2. **알림 채널 최소 1개** (`.env` 에 설정한 채널로 모두 전송, 없으면 콘솔 출력만)

   | 채널 | 설정 변수 | 발급 방법 |
   | --- | --- | --- |
   | Telegram | `TG_TOKEN`, `TG_CHAT_ID` | `@BotFather` `/newbot` → 토큰. 봇에 메시지 후 `https://api.telegram.org/bot<토큰>/getUpdates` 에서 `chat.id` |
   | Discord | `DISCORD_WEBHOOK_URL` | 채널 설정 > 연동 > 웹후크 > URL 복사 |
   | Slack | `SLACK_WEBHOOK_URL` | <https://api.slack.com/messaging/webhooks> 에서 Incoming Webhook 생성 |
   | ntfy | `NTFY_TOPIC` (선택 `NTFY_SERVER`, `NTFY_TOKEN`) | 앱 설치 후 임의 토픽 구독. 계정 불필요, 셀프호스팅 가능 |
   | Pushover | `PUSHOVER_TOKEN`, `PUSHOVER_USER` | <https://pushover.net> (앱 1회 $5) |
   | 범용 Webhook | `WEBHOOK_URL` | `{ "text": "..." }` 형태로 POST |

3. **Node.js 20 이상**

## 설정

```bash
cp .env.example .env
cp config.example.json config.json
npm install            # stream 방식에 필요한 ws 설치
```

`.env`

```
ELEMENT_API_KEY=발급받은_키
# 아래 중 쓰고 싶은 채널만 채우면 된다 (전체 목록은 .env.example 참고)
TG_TOKEN=봇_토큰
TG_CHAT_ID=chat_id
# DISCORD_WEBHOOK_URL=...
# NTFY_TOPIC=...
```

`config.json`

```jsonc
{
  "intervalMs": 20000,          // 폴링 주기(ms)
  "maxPagesPerContract": 3,     // 컬렉션당 최대 페이지(50건 단위)
  "watchlist": [
    {
      "name": "표시용 이름",
      "contract": "0x... NFT 컨트랙트 주소",
      "slug": "element 컬렉션 슬러그(스트림 방식에서만 사용)",
      "tokens": {
        "12": 250,              // tokenId : 목표가(USD). 이 값 이하이면 알림
        "87": 300
      }
    }
  ]
}
```

- `slug` 는 element.market 컬렉션 페이지 URL 이나 `GET /openapi/v1/collection` 로 확인한다. 폴링 방식만 쓸 거면 없어도 된다.
- 목표가는 USD 기준(`priceUSD`). BNB 기준으로 바꾸려면 `watcher.js` 의 비교 로직을 `priceBase` 로 교체한다.

## 실행

```bash
npm run test:notify   # 알림 채널 설정 확인 (먼저 한 번 실행 권장)
npm run poll          # 폴링
npm run stream        # 스트림 (DEBUG=1 npm run stream 으로 첫 이벤트 구조 확인)
```

상시 실행은 pm2 권장.

```bash
npm i -g pm2
pm2 start watcher.js --node-args="--env-file=.env" --name nft-poll
pm2 save && pm2 startup
```

## 동작 메모

- `seen.json` 에 알림 보낸 `orderHash` 를 기록해 같은 매물 재알림을 막는다(24시간 후 정리, gitignore 대상).
- 만료된 매물(`expirationTime` 경과)은 건너뛴다.
- 레이트리밋: 요청 수 ≈ (컬렉션 수 × 실제 페이지 수) / 주기. 컬렉션이 많으면 `intervalMs` 를 늘린다.
- 특정 1개 NFT 정밀 조회: `GET /openapi/v1/orders/bestListing?chain=bsc&contract_address=...&token_id=...`

## 사용 API

- `GET /openapi/v1/orders/list` — 주문 목록 (헤더 `X-Api-Key`)
- `wss://feeds.element.market/websocket?token=<API_KEY>` — Stream API, 30초마다 `{"topic":"ping"}` 필요

문서: <https://element.readme.io/reference/api-overview>

## 주의

- 오프체인 오더북이라 매물이 조용히 취소될 수 있다. 알림을 받고 들어가도 이미 없을 수 있다.
- 이 도구는 알림만 한다. 자동 매수 기능은 없다.
- `.env`, `config.json`, `seen.json` 은 커밋되지 않는다(`.gitignore`).
