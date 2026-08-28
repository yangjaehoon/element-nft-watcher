// Element(BNB Chain) 여러 NFT의 최저 호가를 주기적으로 조회해
// 목표가(USD) 이하로 매물이 있으면 알림을 보낸다.
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

async function pollContract(w) {
  const tokenIds = Object.keys(w.tokens ?? {});
  if (tokenIds.length === 0) return;

  // direction=asc 라 각 tokenId 가 처음 등장하는 행이 그 NFT 의 최저 호가
  const bestByToken = {};

  for (let page = 0; page < maxPages; page++) {
    const url =
      API +
      "?" +
      new URLSearchParams({
        chain: "bsc",
        asset_contract_address: w.contract,
        token_ids: tokenIds.join(","),
        side: "1", // 1 = 판매 주문(listing)
        sale_kind: "0", // 0 = 일반
        order_by: "base_price",
        direction: "asc",
        limit: "50",
        offset: String(page * 50),
      });

    const res = await fetch(url, {
      headers: { "X-Api-Key": process.env.ELEMENT_API_KEY },
    });
    if (!res.ok) throw new Error(`Element API ${res.status}`);

    const orders = (await res.json())?.data?.orders ?? [];
    if (orders.length === 0) break;

    for (const o of orders) {
      if (o.expirationTime && o.expirationTime * 1000 < Date.now()) continue;
      if (!(o.tokenId in w.tokens)) continue;
      if (!bestByToken[o.tokenId]) bestByToken[o.tokenId] = o;
    }

    if (tokenIds.every((id) => bestByToken[id])) break;
    if (orders.length < 50) break;
  }

  for (const [tokenId, maxUsd] of Object.entries(w.tokens)) {
    const o = bestByToken[tokenId];
    if (!o) continue;

    const priceUsd = Number(o.priceUSD);
    if (!(priceUsd <= maxUsd)) continue;
    if (seen.has(o.orderHash)) continue;

    seen.set(o.orderHash, Date.now());
    await notify(
      `${w.name} #${tokenId} 최저 호가\n` +
        `$${priceUsd} (${Number(o.priceBase)} BNB) · 목표 $${maxUsd} 이하\n` +
        `https://element.market/assets/bsc/${w.contract}/${tokenId}`,
    );
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
      await pollContract(w);
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
