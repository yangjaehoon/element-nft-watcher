// element.market 컬렉션 페이지를 헤드리스 브라우저로 열어, 페이지 자신이 호출하는
// GraphQL(AssetsListForCollectionV2 / 필터 적용 시 AssetsListForCollection) 응답을
// 가로채서 가격 낮은 순 매물 목록을 얻는다.
//
// API 키가 필요 없다: 서명(X-Api-Key / X-Api-Sign)은 실제 브라우저 JS가 알아서
// 계산해서 보내므로, 우리는 응답만 읽으면 된다. 사람이 브라우저로 접속해
// 화면의 가격을 보는 것과 기술적으로 동일하다.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 매물의 element.market 상세 페이지 URL. 알림 메시지·상세 페이지 조회 양쪽에서 쓴다.
export function assetUrl(contractAddress, tokenId) {
  return `https://element.market/assets/bsc/${contractAddress}/${tokenId}`;
}

function mapEdgesToListings(edges) {
  return edges
    .map((e) => e.node?.asset)
    .filter((a) => a?.orderData?.bestAsk) // 오퍼(bid)만 있고 판매 매물(ask)이 없는 항목은 제외
    .map((a) => {
      const ask = a.orderData.bestAsk;
      return {
        tokenId: a.tokenId,
        contractAddress: a.contractAddress,
        orderId: ask.orderId,
        priceUsd: Number(ask.priceUSD),
        priceBase: Number(ask.priceBase),
        paymentToken: ask.paymentToken,
        expirationTime: Number(ask.expirationTime),
      };
    })
    .sort((a, b) => a.priceUsd - b.priceUsd);
}

/**
 * @param {import('puppeteer').Browser} browser
 * @param {string} slug element.market 컬렉션 슬러그
 * @returns {Promise<{listings: Array<{tokenId:string, contractAddress:string, orderId:string, priceUsd:number, priceBase:number, paymentToken:string, expirationTime:number}>, totalCount:number}>}
 *          listings 는 가격 오름차순. totalCount 는 전체 매물 수.
 */
export async function fetchCheapestListings(browser, slug, { timeoutMs = 30000 } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  // element.market 은 "화면을 채울 만큼" 한 번에 요청하는 방식(무한스크롤)을 쓴다.
  // 뷰포트를 아주 크게 잡으면 스크롤 없이도 활성 매물 전체를 한 번에 다 받아온다
  // (예: 80건짜리 컬렉션도 커버 확인됨). 컬렉션이 수백~수천 건씩 활성 매물이 있는
  // 경우엔 그만큼 요청이 늘어나니 너무 크게 잡지 않는다.
  await page.setViewport({ width: 1440, height: 20000 });

  const edgesByCursor = new Map(); // cursor -> edge, 여러 응답에 걸쳐 중복 없이 누적
  let totalCount = 0;
  let lastResponseAt = Date.now();

  const onResponse = async (res) => {
    if (!res.url().includes("args=AssetsListForCollectionV2")) return;
    try {
      const json = await res.json();
      totalCount = json?.data?.search?.totalCount ?? totalCount;
      for (const e of json?.data?.search?.edges ?? []) edgesByCursor.set(e.cursor, e);
      lastResponseAt = Date.now();
    } catch {
      // 이 응답이 아니거나 파싱 실패 — 무시하고 다음 응답을 기다린다
    }
  };
  page.on("response", onResponse);

  try {
    await page.goto(`https://element.market/collections/${slug}`, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });

    // 페이지네이션 요청이 연쇄로 이어질 수 있어, 한동안(1.2초) 응답이 조용해지거나
    // 전체 개수를 다 받을 때까지 기다린다.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(400);
      const gotAll = totalCount > 0 && edgesByCursor.size >= totalCount;
      const quiet = edgesByCursor.size > 0 && Date.now() - lastResponseAt > 1200;
      if (gotAll || quiet) break;
    }
  } finally {
    page.off("response", onResponse);
    await page.close();
  }

  const listings = mapEdgesToListings([...edgesByCursor.values()]);
  return { listings, totalCount: totalCount || listings.length };
}

/**
 * 특정 매물(token)의 상세 페이지에서 "특성(Traits)" 값 하나를 읽어온다.
 * 예: fetchAssetTrait(browser, contract, "8861", "Rarity") -> "Mythic"
 *
 * (컬렉션 페이지의 왼쪽 트레잇 필터를 직접 눌러 필터링된 매물 목록을 받아오는
 *  방식도 시도했지만, 가상 스크롤 타이밍 문제와 일부 컬렉션에서 필터 적용 시
 *  element.market 자체가 "이 작업은 현재 완료할 수 없습니다" 오류를 내는 경우가
 *  있어 신뢰할 수 없었다. 대신 이미 안정적으로 동작하는 fetchCheapestListings 로
 *  받은 "저렴한 매물" 후보 각각의 상세 페이지를 열어 등급을 직접 확인하는
 *  방식이 더 안정적이다 — watcher.js 의 rarityWatch 가 이렇게 동작한다.)
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} contractAddress
 * @param {string} tokenId
 * @param {string} [traitName] 기본값 "Rarity"
 * @returns {Promise<string|null>} 해당 특성 값. 못 찾으면 null.
 */
export async function fetchAssetTrait(browser, contractAddress, tokenId, traitName = "Rarity") {
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  try {
    await page.goto(assetUrl(contractAddress, tokenId), {
      waitUntil: "networkidle2",
      timeout: 20000,
    });

    return await page.evaluate((name) => {
      const items = Array.from(document.querySelectorAll(".assets-detail-new-page-attributes-item"));
      for (const item of items) {
        const type = item
          .querySelector(".assets-detail-new-page-attributes-item-type")
          ?.textContent.trim();
        if (type === name) {
          return (
            item.querySelector(".assets-detail-new-page-attributes-item-name")?.textContent.trim() ?? null
          );
        }
      }
      return null;
    }, traitName);
  } finally {
    await page.close();
  }
}

/**
 * listings(가격 오름차순, fetchCheapestListings 의 결과) 중 maxPriceUsd 이하인
 * 저렴한 후보들의 등급을 확인해서 value 와 일치하는 매물만 돌려준다.
 * watcher.js(상시 감시)와 check-floors.js(1회 조회) 가 공유하는 등급 감시 로직.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {Array} listings fetchCheapestListings 가 반환한 목록(가격 오름차순)
 * @param {{trait?: string, value: string, maxPriceUsd: number, cache?: Map<string, Record<string,string>>}} opts
 *        cache 를 주면(orderId -> {trait: value}) 이미 확인한 매물은 상세 페이지를 다시 열지 않는다.
 * @returns {Promise<{matches: Array, checkedCount: number}>}
 */
export async function findRarityMatches(browser, listings, opts) {
  const { trait = "Rarity", value, maxPriceUsd, cache } = opts;

  const candidates = [];
  for (const l of listings) {
    if (l.priceUsd > maxPriceUsd) break; // 가격 오름차순이라 이후는 볼 필요 없음
    candidates.push(l);
  }

  const checked = await Promise.all(
    candidates.map(async (l) => {
      const cached = cache?.get(l.orderId)?.[trait];
      const traitValue = cached ?? (await fetchAssetTrait(browser, l.contractAddress, l.tokenId, trait));
      if (cache && cached === undefined) {
        cache.set(l.orderId, { ...cache.get(l.orderId), [trait]: traitValue });
      }
      return { listing: l, traitValue };
    }),
  );

  return {
    matches: checked.filter((c) => c.traitValue === value).map((c) => c.listing),
    checkedCount: candidates.length,
  };
}
