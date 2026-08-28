// Element Stream API(WebSocket)로 item_listed 이벤트를 실시간 수신해
// 감시 중인 NFT 가 목표가(USD) 이하로 올라오면 알림을 보낸다.
//
// 실행: npm run stream   (node --env-file=.env stream-watcher.js)
// config.json watchlist 항목에 "slug" 가 있어야 구독 대상이 된다.
//
// 주의: item_listed 이벤트의 정확한 payload 필드명은 공식 문서에 공개돼 있지 않다.
//       처음 실행 시 DEBUG=1 로 실제 메시지를 찍어보고 아래 매핑을 확정할 것.

import fs from "node:fs";
import WebSocket from "ws";
import { notify } from "./notify.js";

const cfg = loadJson("./config.json", null);
if (!cfg) {
  console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
  process.exit(1);
}
if (!process.env.ELEMENT_API_KEY) {
  console.error("ELEMENT_API_KEY 가 없습니다. .env 를 확인하세요.");
  process.exit(1);
}

const WS_URL = `wss://feeds.element.market/websocket?token=${process.env.ELEMENT_API_KEY}`;
const targets = (cfg.watchlist ?? []).filter((w) => w.slug);

if (targets.length === 0) {
  console.error("config.json watchlist 에 slug 가 있는 항목이 없습니다.");
  process.exit(1);
}

let ws;
let pingTimer;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("stream connected");
    for (const w of targets) {
      ws.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          topic: `collection:${w.slug}`,
          events: ["item_listed"],
          payload: { chains: ["bsc"], markets: ["element"] },
        }),
      );
    }
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ topic: "ping" }));
      }
    }, 30_000);
  });

  ws.on("message", async (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (msg.topic === "pong") return;

    const evt = msg.event ?? msg.events;
    if (evt !== "item_listed") return;

    if (process.env.DEBUG) console.log(JSON.stringify(msg, null, 2));

    const p = msg.payload ?? msg.data ?? msg;
    const w = targets.find((x) => msg.topic === `collection:${x.slug}`);
    if (!w) return;

    const tokenId = String(p.tokenId ?? p.token_id ?? "");
    const priceUsd = Number(p.priceUSD ?? p.price_usd ?? NaN);
    const maxUsd = w.tokens?.[tokenId];

    if (maxUsd == null || !(priceUsd <= maxUsd)) return;

    await notify(
      `${w.name} #${tokenId} 신규 매물\n` +
        `$${priceUsd} · 목표 $${maxUsd} 이하\n` +
        `https://element.market/assets/bsc/${w.contract}/${tokenId}`,
    );
  });

  ws.on("close", () => {
    clearInterval(pingTimer);
    console.log("stream closed, reconnect in 3s");
    setTimeout(connect, 3000);
  });

  ws.on("error", (e) => {
    console.error("stream error", e.message);
    ws.close();
  });
}

function loadJson(p, def) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return def;
  }
}

connect();
