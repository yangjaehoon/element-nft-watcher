// element.market 컬렉션 페이지를 헤드리스 브라우저로 주기적으로 열어
// 가격 낮은 순 매물을 확인하고, 목표가(USD) 이하 매물이 있으면 알림을 보낸다.
// API 키 불필요 — lib/element-scrape.js 참고.
//
// 실행: npm run poll   (node --env-file=.env watcher.js)

import fs from "node:fs";
import puppeteer from "puppeteer";
import { notify } from "./notify.js";
import { fetchCheapestListings, fetchAssetTrait } from "./lib/element-scrape.js";

const CONFIG_FILE = "./config.json";
const STATE_FILE = "./seen.json";
const TRAIT_CACHE_FILE = "./trait-cache.json";

const cfg = loadJson(CONFIG_FILE, null);
if (!cfg) {
  console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
  process.exit(1);
}

const intervalMs = cfg.intervalMs ?? 90_000;

// orderId -> 알림 보낸 시각. 같은 매물 재알림 방지 (재시작해도 유지)
const seen = new Map(Object.entries(loadJson(STATE_FILE, {})));

// orderId -> { [traitName]: value }. rarityWatch 에서 이미 확인한 매물은 매 틱
// 상세 페이지를 다시 열지 않기 위한 캐시(등급이 안 맞아 seen 에는 안 들어간 것들).
const traitCache = new Map(Object.entries(loadJson(TRAIT_CACHE_FILE, {})));

async function checkCollection(browser, w) {
  if (!w.slug) {
    console.warn(`[${w.name}] slug 가 필요합니다`);
    return;
  }

  const { listings } = await fetchCheapestListings(browser, w.slug);

  if (w.maxPriceUsd != null) {
    await notifyMatches(w, listings, w.maxPriceUsd, "");
  }

  for (const rw of w.rarityWatch ?? []) {
    await checkRarityWatch(browser, w, listings, rw);
  }
}

// 컬렉션 전체 최저가 매물(listings, 가격 오름차순) 중 rw.maxPriceUsd 이하인
// 저렴한 후보만 상세 페이지를 열어 등급(trait)을 확인한다. 등급 필터를 직접
// 서버에 요청하는 방식은 일부 컬렉션에서 신뢰할 수 없어(element-scrape.js 참고)
// 이미 안정적으로 받은 저가 매물 후보에서 직접 확인하는 방식을 쓴다.
async function checkRarityWatch(browser, w, listings, rw) {
  const traitName = rw.trait ?? "Rarity";

  for (const l of listings) {
    if (l.priceUsd > rw.maxPriceUsd) break; // 가격 오름차순이라 이후는 볼 필요 없음
    if (l.expirationTime && l.expirationTime * 1000 < Date.now()) continue;
    if (seen.has(l.orderId)) continue;

    const cached = traitCache.get(l.orderId)?.[traitName];
    const value = cached ?? (await fetchAssetTrait(browser, l.contractAddress, l.tokenId, traitName));
    if (cached === undefined) {
      traitCache.set(l.orderId, { ...traitCache.get(l.orderId), [traitName]: value });
    }
    if (value !== rw.value) continue;

    seen.set(l.orderId, Date.now());
    await notify(
      `${w.name} [${rw.value}] #${l.tokenId} 매물\n` +
        `$${l.priceUsd.toFixed(2)} (${l.priceBase} BNB) · 목표 $${rw.maxPriceUsd} 이하\n` +
        `https://element.market/assets/bsc/${l.contractAddress}/${l.tokenId}`,
      { discordWebhookUrl: w.discordWebhookUrl },
    );
  }
}

async function notifyMatches(w, listings, maxPriceUsd, label) {
  for (const l of listings) {
    if (l.expirationTime && l.expirationTime * 1000 < Date.now()) continue;
    if (l.priceUsd > maxPriceUsd) break; // 가격 오름차순이라 이후는 볼 필요 없음
    if (seen.has(l.orderId)) continue;

    seen.set(l.orderId, Date.now());
    await notify(
      `${w.name}${label} #${l.tokenId} 매물\n` +
        `$${l.priceUsd.toFixed(2)} (${l.priceBase} BNB) · 목표 $${maxPriceUsd} 이하\n` +
        `https://element.market/assets/bsc/${l.contractAddress}/${l.tokenId}`,
      { discordWebhookUrl: w.discordWebhookUrl },
    );
  }
}

function loadJson(p, def) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return def;
  }
}

function persist() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
  fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(seen)));

  // 너무 커지지 않게 최근 5000건만 유지
  if (traitCache.size > 5000) {
    for (const k of Array.from(traitCache.keys()).slice(0, traitCache.size - 5000)) {
      traitCache.delete(k);
    }
  }
  fs.writeFileSync(TRAIT_CACHE_FILE, JSON.stringify(Object.fromEntries(traitCache)));
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  process.on("SIGINT", async () => {
    await browser.close();
    process.exit(0);
  });

  async function tick() {
    for (const w of cfg.watchlist ?? []) {
      try {
        await checkCollection(browser, w);
      } catch (e) {
        console.error(`[${w.name}]`, e.message);
      }
    }
    persist();
  }

  console.log(
    `element.market 직접 조회(headless) 감시: ${cfg.watchlist?.length ?? 0} collections, ${intervalMs}ms 간격`,
  );
  setInterval(tick, intervalMs);
  tick();
}

main();
