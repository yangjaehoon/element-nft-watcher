// config.json 에 설정된 컬렉션들의 현재 최저가 매물을 한 번 조회해서 출력한다.
// 목표가(maxPriceUsd) 를 정할 때 참고용. API 키 불필요.
//
// 실행: npm run floors

import fs from "node:fs";
import puppeteer from "puppeteer";
import { fetchCheapestListings } from "./lib/element-scrape.js";

const cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const browser = await puppeteer.launch({ headless: true });

for (const w of cfg.watchlist ?? []) {
  if (!w.slug) {
    console.log(`${w.name}: slug 없음, 건너뜀`);
    continue;
  }
  try {
    const { listings, totalCount } = await fetchCheapestListings(browser, w.slug);
    if (listings.length === 0) {
      console.log(`${w.name}: 활성 매물 없음`);
      continue;
    }
    const top = listings.slice(0, 3);
    console.log(
      `${w.name} (활성 매물 ${totalCount}건, 최저 3개)\n` +
        top.map((l) => `  #${l.tokenId}  $${l.priceUsd.toFixed(2)}  (${l.priceBase} BNB)`).join("\n"),
    );
  } catch (e) {
    console.log(`${w.name}: 오류 - ${e.message}`);
  }
}

await browser.close();
