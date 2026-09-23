// element.market 컬렉션 페이지를 헤드리스 브라우저로 주기적으로 열어
// 가격 낮은 순 매물을 확인하고, 목표가(USD) 이하 매물이 있으면 알림을 보낸다.
// API 키 불필요 — lib/element-scrape.js 참고.
//
// 실행: npm run poll   (node --env-file=.env watcher.js)

import fs from "node:fs";
import puppeteer from "puppeteer";
import { notify } from "./notify.js";
import { loadConfigOrExit, loadJson } from "./lib/config.js";
import { fetchCheapestListings, findRarityMatches, assetUrl } from "./lib/element-scrape.js";

const STATE_FILE = "./seen.json";
const TRAIT_CACHE_FILE = "./trait-cache.json";

const cfg = loadConfigOrExit();
const intervalMs = cfg.intervalMs ?? 90_000;

// orderId -> 알림 보낸 시각. 같은 매물 재알림 방지 (재시작해도 유지)
const seen = new Map(Object.entries(loadJson(STATE_FILE, {})));
// orderId -> { [traitName]: value }. rarityWatch 에서 이미 확인한 매물은 매 틱
// 상세 페이지를 다시 열지 않기 위한 캐시(등급이 안 맞아 seen 에는 안 들어간 것들).
const traitCache = new Map(Object.entries(loadJson(TRAIT_CACHE_FILE, {})));

// 디스크에 쓸 필요가 있을 때만 쓰기 위한 플래그(매 틱 무조건 writeFileSync 하지 않는다).
let seenDirty = false;
let traitCacheDirty = false;

async function checkCollection(browser, w) {
  if (!w.slug) {
    console.warn(`[${w.name}] slug 가 필요합니다`);
    return;
  }

  const { listings } = await fetchCheapestListings(browser, w.slug);

  if (w.maxPriceUsd != null) {
    await notifyListings(w, listings, w.maxPriceUsd, "");
  }

  for (const rw of w.rarityWatch ?? []) {
    const { matches } = await findRarityMatches(browser, listings, {
      trait: rw.trait,
      value: rw.value,
      maxPriceUsd: rw.maxPriceUsd,
      cache: traitCacheProxy,
    });
    await notifyListings(w, matches, rw.maxPriceUsd, ` [${rw.value}]`);
  }
}

// listings(가격 오름차순) 중 목표가 이하이면서 아직 알린 적 없는 매물에 알림을 보낸다.
// 컬렉션 전체 최저가 감시(maxPriceUsd)와 등급별 감시(rarityWatch)가 이 함수를 공유한다.
async function notifyListings(w, listings, maxPriceUsd, label) {
  for (const l of listings) {
    if (l.priceUsd > maxPriceUsd) break; // 가격 오름차순이라 이후는 볼 필요 없음
    if (l.expirationTime && l.expirationTime * 1000 < Date.now()) continue;
    if (seen.has(l.orderId)) continue;

    seen.set(l.orderId, Date.now());
    seenDirty = true;
    await notify(
      `${w.name}${label} #${l.tokenId} 매물\n` +
        `$${l.priceUsd.toFixed(2)} (${l.priceBase} BNB) · 목표 $${maxPriceUsd} 이하\n` +
        `${assetUrl(l.contractAddress, l.tokenId)}`,
      { discordWebhookUrl: w.discordWebhookUrl },
    );
  }
}

// findRarityMatches 에 넘기는 캐시 어댑터. set 이 실제로 일어났을 때만
// traitCacheDirty 를 세워서 persist() 가 불필요한 디스크 쓰기를 건너뛸 수 있게 한다.
const traitCacheProxy = {
  get: (k) => traitCache.get(k),
  set: (k, v) => {
    traitCache.set(k, v);
    traitCacheDirty = true;
  },
};

function persist() {
  if (seenDirty) {
    const cutoff = Date.now() - 24 * 3600_000;
    for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(seen)));
    seenDirty = false;
  }

  if (traitCacheDirty) {
    // 너무 커지지 않게 최근 5000건만 유지
    if (traitCache.size > 5000) {
      for (const k of Array.from(traitCache.keys()).slice(0, traitCache.size - 5000)) {
        traitCache.delete(k);
      }
    }
    fs.writeFileSync(TRAIT_CACHE_FILE, JSON.stringify(Object.fromEntries(traitCache)));
    traitCacheDirty = false;
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  process.on("SIGINT", async () => {
    await browser.close();
    process.exit(0);
  });

  async function tick() {
    // 컬렉션을 동시에(Promise.allSettled) 확인해봤는데, 헤드리스 페이지가
    // 한꺼번에 여러 개 뜨면서(특히 등급 후보가 많을 때) 서로 리소스를 다 먹어
    // "Navigation timeout" 이 나는 걸 실제로 겪었다. 순서대로 하나씩 확인한다.
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
