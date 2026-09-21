// element.market 컬렉션 페이지를 헤드리스 브라우저로 주기적으로 열어
// 가격 낮은 순 매물을 확인하고, 목표가(USD) 이하 매물이 있으면 알림을 보낸다.
// API 키 불필요 — lib/element-scrape.js 참고.
//
// 실행: npm run poll   (node --env-file=.env watcher.js)

import fs from "node:fs";
import puppeteer from "puppeteer";
import { notify } from "./notify.js";
import { fetchCheapestListings } from "./lib/element-scrape.js";

const CONFIG_FILE = "./config.json";
const STATE_FILE = "./seen.json";

const cfg = loadJson(CONFIG_FILE, null);
if (!cfg) {
  console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
  process.exit(1);
}

const intervalMs = cfg.intervalMs ?? 90_000;

// orderId -> 알림 보낸 시각. 같은 매물 재알림 방지 (재시작해도 유지)
const seen = new Map(Object.entries(loadJson(STATE_FILE, {})));

async function checkCollection(browser, w) {
  if (!w.slug) {
    console.warn(`[${w.name}] slug 가 필요합니다`);
    return;
  }

  const { listings } = await fetchCheapestListings(browser, w.slug);

  for (const l of listings) {
    if (l.expirationTime && l.expirationTime * 1000 < Date.now()) continue;
    if (l.priceUsd > w.maxPriceUsd) break; // 가격 오름차순이라 이후는 볼 필요 없음
    if (seen.has(l.orderId)) continue;

    seen.set(l.orderId, Date.now());
    await notify(
      `${w.name} #${l.tokenId} 매물\n` +
        `$${l.priceUsd.toFixed(2)} (${l.priceBase} BNB) · 목표 $${w.maxPriceUsd} 이하\n` +
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
