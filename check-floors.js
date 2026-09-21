// config.json 에 설정된 컬렉션들의 현재 최저가 매물(+등급별 감시 항목)을
// 한 번 조회해서 출력한다. 목표가를 정할 때 참고용. API 키 불필요.
//
// 실행: npm run floors

import puppeteer from "puppeteer";
import { loadConfigOrExit } from "./lib/config.js";
import { fetchCheapestListings, findRarityMatches } from "./lib/element-scrape.js";

const cfg = loadConfigOrExit();
const browser = await puppeteer.launch({ headless: true });

for (const w of cfg.watchlist ?? []) {
  if (!w.slug) {
    console.log(`${w.name}: slug 없음, 건너뜀`);
    continue;
  }

  let listings = [];
  try {
    const r = await fetchCheapestListings(browser, w.slug);
    listings = r.listings;
    if (listings.length === 0) {
      console.log(`${w.name}: 활성 매물 없음`);
    } else {
      const top = listings.slice(0, 3);
      console.log(
        `${w.name} (활성 매물 ${r.totalCount}건, 최저 3개)\n` +
          top.map((l) => `  #${l.tokenId}  $${l.priceUsd.toFixed(2)}  (${l.priceBase} BNB)`).join("\n"),
      );
    }
  } catch (e) {
    console.log(`${w.name}: 오류 - ${e.message}`);
  }

  for (const rw of w.rarityWatch ?? []) {
    try {
      const { matches, checkedCount } = await findRarityMatches(browser, listings, {
        trait: rw.trait,
        value: rw.value,
        maxPriceUsd: rw.maxPriceUsd,
      });
      if (matches.length === 0) {
        console.log(`  [${rw.value}] $${rw.maxPriceUsd} 이하 매물 중 없음 (후보 ${checkedCount}개 확인)`);
      } else {
        console.log(
          `  [${rw.value}] $${rw.maxPriceUsd} 이하에서 발견!\n` +
            matches.map((l) => `    #${l.tokenId}  $${l.priceUsd.toFixed(2)}  (${l.priceBase} BNB)`).join("\n"),
        );
      }
    } catch (e) {
      console.log(`  [${rw.value}] 확인 실패 - ${e.message}`);
    }
  }
}

await browser.close();
