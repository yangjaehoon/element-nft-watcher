// NFTScan API 로 감시 대상 컬렉션의 floor price 를 주기적으로 조회해
// 목표가 이하로 떨어지면 알림을 보낸다.
//
// config.json 의 watchlist 항목:
//   - maxPriceBnb : 목표가(BNB). 우선 적용
//   - maxPriceUsd : 목표가(USD). maxPriceBnb 가 없을 때 BNB 시세로 환산해 비교
//
// 실행: npm run poll   (node --env-file=.env watcher.js)

import fs from "node:fs";
import { notify } from "./notify.js";

const CONFIG_FILE = "./config.json";
const STATE_FILE = "./seen.json";
const NFTSCAN_BASE = "https://bnbapi.nftscan.com/api";
const STATS_PATH = "/v2/statistics/collection/";

const cfg = loadJson(CONFIG_FILE, null);
if (!cfg) {
  console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
  process.exit(1);
}
if (!process.env.NFTSCAN_API_KEY) {
  console.error("NFTSCAN_API_KEY 가 없습니다. .env 를 확인하세요.");
  process.exit(1);
}

const intervalMs = cfg.intervalMs ?? 60_000;

// contract -> { notified, floor, at }. 목표가 이하일 때 계속 알리지 않기 위한 상태.
const state = loadJson(STATE_FILE, {});

let bnbUsdCache = { price: 0, at: 0 };

async function bnbUsd() {
  if (bnbUsdCache.price && Date.now() - bnbUsdCache.at < 60_000) return bnbUsdCache.price;
  const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const price = Number((await res.json()).price);
  bnbUsdCache = { price, at: Date.now() };
  return price;
}

async function fetchFloor(contract) {
  const res = await fetch(NFTSCAN_BASE + STATS_PATH + contract, {
    headers: { "X-API-KEY": process.env.NFTSCAN_API_KEY },
  });
  if (!res.ok) throw new Error(`NFTScan HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 200 || !body.data) {
    throw new Error(`NFTScan code ${body.code}: ${body.msg ?? "no data"}`);
  }
  return body.data; // { floor_price, lowest_price_24h, contract_name, items_total, ... }
}

async function checkCollection(w) {
  const data = await fetchFloor(w.contract);
  if (process.env.DEBUG) console.log(w.name, JSON.stringify(data));

  const floorBnb = Number(data.floor_price);
  if (!floorBnb || floorBnb <= 0) return; // 활성 매물 없음

  let targetBnb = w.maxPriceBnb;
  if (targetBnb == null && w.maxPriceUsd != null) {
    targetBnb = w.maxPriceUsd / (await bnbUsd());
  }
  if (targetBnb == null) {
    console.warn(`[${w.name}] maxPriceBnb 또는 maxPriceUsd 가 필요합니다`);
    return;
  }

  const st = state[w.contract] ?? { notified: false, floor: null };

  if (floorBnb <= targetBnb) {
    // 처음 도달했거나, 이전 알림보다 더 떨어졌을 때만 다시 알림
    const droppedFurther = st.notified && st.floor != null && floorBnb < st.floor - 1e-9;
    if (!st.notified || droppedFurther) {
      const usd = floorBnb * (await bnbUsd());
      await notify(
        `${w.name} 최저가 ${round(floorBnb)} BNB (~$${usd.toFixed(0)})\n` +
          `목표 ${round(targetBnb)} BNB 이하\n` +
          `https://element.market/collections/${w.slug ?? ""}`,
      );
      state[w.contract] = { notified: true, floor: floorBnb, at: Date.now() };
    }
  } else if (st.notified) {
    // 목표가 위로 회복 → 다음에 다시 내려오면 알리도록 리셋
    state[w.contract] = { notified: false, floor: floorBnb, at: Date.now() };
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
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
      await checkCollection(w);
    } catch (e) {
      console.error(`[${w.name}]`, e.message);
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

console.log(
  `NFTScan floor 감시: ${cfg.watchlist?.length ?? 0} collections, ${intervalMs}ms 간격`,
);
setInterval(tick, intervalMs);
tick();
