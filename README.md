# element-nft-watcher

BNB Chain NFT 컬렉션(Element 마켓플레이스)에서 목표가 이하 매물이 올라오면
Discord 등으로 알림을 보내는 도구. **API 키 불필요.**

## 어떻게 동작하는가

element.market 컬렉션 페이지는 화면에 가격을 띄우려고 자체 GraphQL API를
호출한다. 이 요청은 서명(X-Api-Key/X-Api-Sign)이 필요한데, 그 서명은 페이지의
자바스크립트가 브라우저에서 직접 계산해서 보낸다.

그래서 `watcher.js`는 **헤드리스 Chrome(Puppeteer)으로 실제 컬렉션 페이지를
열어서** 브라우저가 정상적으로 요청·응답하게 두고, 그 응답(`AssetsListForCollectionV2`,
가격 낮은 순 매물 목록)만 가로채 읽는다. 사람이 브라우저로 들어가서 눈으로
가격을 확인하는 것과 기술적으로 같은 방식이라 별도 API 키나 결제가 없다.

비공식 방식이라 element.market이 페이지 구조를 바꾸면 깨질 수 있다는 점은 감안한다.

| 파일 | 역할 |
| --- | --- |
| `lib/element-scrape.js` | 헤드리스 브라우저로 컬렉션의 가격순 매물 목록을 가져오는 핵심 함수 |
| `watcher.js` | 주기적으로 감시하며 목표가 이하 매물에 알림 (`npm run poll`) |
| `check-floors.js` | 현재 최저가 매물을 1회 조회 (`npm run floors`) |
| `notify.js` | 알림 채널 플러그인 (Discord/Telegram/Slack/ntfy/Pushover/Webhook) |
| `stream-watcher.js` | (선택) Element 공식 Stream API. 공식 API 키가 있을 때만 사용 가능, 필수 아님 |

## 준비물

1. **알림 채널 최소 1개** (`.env` 에 설정한 채널로 모두 전송, 없으면 콘솔 출력만)

   | 채널 | 설정 변수 | 발급 방법 |
   | --- | --- | --- |
   | Discord | `DISCORD_WEBHOOK_URL` | 채널 설정 > 연동 > 웹후크 > URL 복사 |
   | Telegram | `TG_TOKEN`, `TG_CHAT_ID` | `@BotFather` `/newbot` → 토큰. 봇에 메시지 후 `https://api.telegram.org/bot<토큰>/getUpdates` 에서 `chat.id` |
   | Slack | `SLACK_WEBHOOK_URL` | <https://api.slack.com/messaging/webhooks> 에서 Incoming Webhook 생성 |
   | ntfy | `NTFY_TOPIC` (선택 `NTFY_SERVER`, `NTFY_TOKEN`) | 앱 설치 후 임의 토픽 구독. 계정 불필요 |
   | Pushover | `PUSHOVER_TOKEN`, `PUSHOVER_USER` | <https://pushover.net> (앱 1회 $5) |
   | 범용 Webhook | `WEBHOOK_URL` | `{ "text": "..." }` 형태로 POST |

2. **Node.js 20 이상**
3. `npm install` 시 Puppeteer가 Chromium(~200MB)을 같이 내려받는다.

## 설정

```bash
cp .env.example .env
cp config.example.json config.json
npm install
```

`.env` — 알림 채널만 있으면 된다 (API 키 불필요).

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`config.json`

```jsonc
{
  "intervalMs": 90000,           // 폴링 주기(ms). 컬렉션마다 실제 페이지 로딩이 있으니 너무 짧게 잡지 않는다
  "watchlist": [
    {
      "name": "표시용 이름",
      "contract": "0x... NFT 컨트랙트 주소 (BNB Chain, 알림 링크용)",
      "slug": "element.market/collections/<여기> 의 슬러그",
      "maxPriceUsd": 17,              // 이 값 이하 매물이 뜨면 알림
      "discordWebhookUrl": ""         // 이 컬렉션 전용 채널. 비워두면 .env 의 DISCORD_WEBHOOK_URL 사용
    }
  ]
}
```

### 컬렉션마다 다른 디스코드 채널로 알림 받기

컬렉션별로 `discordWebhookUrl` 을 채우면 그 컬렉션의 알림만 지정한 채널로 간다.
비워두면(`""`) `.env` 의 공통 `DISCORD_WEBHOOK_URL` 로 간다. 즉:

- 3개 컬렉션에 서로 다른 채널 웹훅을 넣으면 → 각자 다른 채널로 알림
- 일부만 채우면 → 채운 것만 전용 채널, 나머지는 공통 채널
- Telegram/Slack/ntfy 등 다른 채널은 컬렉션별 분기 없이 항상 `.env` 의 전역 설정을 쓴다

`npm run test:notify` 를 실행하면 전역 채널 1건 + `discordWebhookUrl` 이 설정된 컬렉션마다
1건씩, 총 여러 건의 테스트 메시지를 보내 각 채널이 맞게 연결됐는지 확인할 수 있다.

목표가를 못 정했으면 먼저 `npm run floors` 로 현재 최저가를 확인한다.

## 실행

```bash
npm run floors         # 현재 최저 매물 3개씩 조회 (목표가 정할 때 참고)
npm run test:notify    # 알림 채널 설정 확인
npm run poll            # 감시 시작
```

상시 실행은 pm2 권장.

```bash
npm i -g pm2
pm2 start watcher.js --node-args="--env-file=.env" --name nft-poll
pm2 save && pm2 startup
```

## 동작 메모

- `seen.json` 에 알림 보낸 `orderId` 를 기록해 같은 매물 재알림을 막는다(24시간 후 정리, gitignore 대상).
- 매물은 가격 오름차순으로 최대 18건까지 확인한다(페이지 기본 크기). 목표가를 넘는 순간 그 컬렉션은 그만 본다.
- 만료된 매물(`expirationTime` 경과)은 건너뛴다.
- 컬렉션 하나당 실제 페이지 로딩이 들어가므로(수 초), 컬렉션 수가 많으면 `intervalMs` 를 늘린다.
- 비공식 방식이라 element.market 구조 변경 시 깨질 수 있다. 그럴 땐 `npm run floors` 로 먼저 확인하고, 안 되면 `lib/element-scrape.js` 의 GraphQL 파라미터(`args=AssetsListForCollectionV2`)를 다시 캡처해서 맞춘다.

## 사용 API

- element.market 내부 GraphQL: `POST https://api.element.market/graphql?args=AssetsListForCollectionV2` — 헤드리스 브라우저가 직접 호출/서명, 별도 인증 불필요
- (선택, `stream-watcher.js`) `wss://feeds.element.market/websocket?token=<API_KEY>` — Element 공식 Stream API, 공식 API 키(수동 심사, <https://forms.gle/78wpggURGADCjshr7>) 승인 시에만 사용 가능

## 주의

- 이 도구는 알림만 한다. 자동 매수 기능은 없다.
- 개인 소량 조회 용도로만 사용한다. 폴링 주기를 과도하게 짧게 잡거나 컬렉션을 대량으로 추가하지 않는다.
- `.env`, `config.json`, `seen.json` 은 커밋되지 않는다(`.gitignore`).
