// config.json 에 설정된 컬렉션들의 현재 floor price 를 한 번 조회해서 출력한다.
// 목표가(maxPriceBnb / maxPriceUsd) 를 정할 때 참고용.
//
// 실행: npm run floors

import fs from "node:fs";

const cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
if (!process.env.NFTSCAN_API_KEY) {
  console.error("NFTSCAN_API_KEY 가 없습니다. .env 를 확인하세요.");
  process.exit(1);
}

const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
const bnbUsd = Number((await res.json()).price);
console.log(`BNB/USD: $${bnbUsd}\n`);

for (const w of cfg.watchlist ?? []) {
  try {
    const r = await fetch(`https://bnbapi.nftscan.com/api/v2/statistics/collection/${w.contract}`, {
      headers: { "X-API-KEY": process.env.NFTSCAN_API_KEY },
    });
    const body = await r.json();
    if (body.code !== 200 || !body.data) {
      console.log(`${w.name}: 조회 실패 (${body.code} ${body.msg ?? ""})`);
      continue;
    }
    const { floor_price, lowest_price_24h, items_total } = body.data;
    const floorUsd = (floor_price * bnbUsd).toFixed(0);
    console.log(
      `${w.name}\n` +
        `  floor       : ${floor_price} BNB (~$${floorUsd})\n` +
        `  24h lowest  : ${lowest_price_24h} BNB\n` +
        `  items       : ${items_total}\n`,
    );
  } catch (e) {
    console.log(`${w.name}: 오류 - ${e.message}`);
  }
}
