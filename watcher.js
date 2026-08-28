// Element(BNB Chain) 컬렉션의 최저가 매물을 주기적으로 조회해
// 목표가(USD) 이하 매물이 있으면 알림을 보낸다.
//
// config.json 의 watchlist 항목:
//   - maxPriceUsd 지정 시 : 컬렉션 최저가 감시 (아무 token 이나, 이 값 이하면 알림)
//   - tokens 지정 시       : 지정한 token_id 별 최저 호가 감시
//
// 실행: npm run poll   (node --env-file=.env watcher.js)

import fs from "node:fs";
import { notify } from "./notify.js";

const CONFIG_FILE = "./config.json";
const SEEN_FILE = "./seen.json";
const API = "https://api.element.market/openapi/v1/orders/list";

const cfg = loadJson(CONFIG_FILE, null);
if (!cfg) {
  console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
  process.exit(1);
}
if (!process.env.ELEMENT_API_KEY) {
  console.error("ELEMENT_API_KEY 가 없습니다. .env 를 확인하세요.");
  process.exit(1);
}

const intervalMs = cfg.intervalMs ?? 20_000;
const maxPages = cfg.maxPagesPerContract ?? 3;

// orderHash -> 알림 보낸 시각. 같은 매물 재알림 방지 (재시작해도 유지)
const seen = new Map(Object.entries(loadJson(SEEN_FILE, {})));

// Element orders/list 를 가격 오름차순으로 한 페이지 조회
async function fetchOrders(contract, { tokenIds, offset }) {
  const params = {
    chain: "bsc",
    asset_contract_address: contract,
    side: "1", // 1 = 판매 주문(listing)
    sale_kind: "0", // 0 = 일반
    order_by: "base_price",
    direction: "asc",
    limit: "50",
    offset: String(offset),
  };
  if (tokenIds) params.token_ids = tokenIds.join(",");

  const res = await fetch(API + "?" + new URLSearchParams(params), {
    headers: { "X-Api-Key": process.env.ELEMENT_API_KEY },
  });
  if (!res.ok) throw new Error(`Element API ${res.status}`);
  return (await res.json())?.data?.orders ?? [];
}

function isLive(o) {
  return !(o.expirationTime && o.expirationTime * 1000 < Date.now());
}

async function alertOnce(o, name, maxUsd, tokenLabel) {
  if (seen.has(o.orderHash)) return;
  seen.set(o.orderHash, Date.now());
  await notify(
    `${name}${tokenLabel} 매물\n` +
      `$${Number(o.priceUSD)} (${Number(o.priceBase)} BNB) · 목표 $${maxUsd} 이하\n` +
      `https://element.market/assets/bsc/${o.contractAddress}/${o.tokenId}`,
  );
}

// 컬렉션 최저가 감시: 목표가 이하 매물을 싼 것부터 알림
async function watchFloor(w) {
  for (let page = 0; page < maxPages; page++) {
    const orders = await fetchOrders(w.contract, { offset: page * 50 });
    if (orders.length === 0) return;

    for (const o of orders) {
      if (!isLive(o)) continue;
      if (Number(o.priceUSD) > w.maxPriceUsd) return; // asc 정렬이라 이후는 볼 필요 없음
      await alertOnce(o, w.name, ` #${o.tokenId}`, w.maxPriceUsd);
    }
    if (orders.length < 50) return;
  }
}

// 지정 token_id 별 최저 호가 감시
async function watchTokens(w) {
  const tokenIds = Object.keys(w.tokens);
  const bestByToken = {};

  for (let page = 0; page < maxPages; page++) {
    const orders = await fetchOrders(w.contract, { tokenIds, offset: page * 50 });
    if (orders.length === 0) break;

    for (const o of orders) {
      if (!isLive(o)) continue;
      if (o.tokenId in w.tokens && !bestByToken[o.tokenId]) bestByToken[o.tokenId] = o;
    }
    if (tokenIds.every((id) => bestByToken[id])) break;
    if (orders.length < 50) break;
  }

  for (const [tokenId, maxUsd] of Object.entries(w.tokens)) {
    const o = bestByToken[tokenId];
    if (o && Number(o.priceUSD) <= maxUsd) {
      await alertOnce(o, w.name, ` #${tokenId} 최저 호가`, maxUsd);
    }
  }
}

function persist() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(Object.fromEntries(seen)));
}

function loadJson(p, def) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return def;
  }
}

async function tick() {
  for (const w of cfg.watchlist ?? []) {
    try {
      if (w.tokens && Object.keys(w.tokens).length > 0) await watchTokens(w);
      else if (w.maxPriceUsd != null) await watchFloor(w);
      else console.warn(`[${w.name}] maxPriceUsd 또는 tokens 가 필요합니다`);
    } catch (e) {
      console.error(`[${w.name}]`, e.message);
    }
  }
  persist();
}

console.log(
  `polling ${cfg.watchlist?.length ?? 0} collections every ${intervalMs}ms`,
);
setInterval(tick, intervalMs);
tick();
