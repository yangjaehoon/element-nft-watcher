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

function parseSearchResult(json) {
  const totalCount = json?.data?.search?.totalCount ?? 0;
  const edges = json?.data?.search?.edges ?? [];
  const listings = edges
    .map((e) => e.node?.asset)
    .filter((a) => a?.orderData?.bestAsk)
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
  return { listings, totalCount };
}

/**
 * @param {import('puppeteer').Browser} browser
 * @param {string} slug element.market 컬렉션 슬러그
 * @returns {Promise<{listings: Array<{tokenId:string, contractAddress:string, orderId:string, priceUsd:number, priceBase:number, paymentToken:string, expirationTime:number}>, totalCount:number}>}
 *          listings 는 가격 오름차순, 최대 18~24건(페이지 크기)까지. totalCount 는 전체 매물 수.
 */
export async function fetchCheapestListings(browser, slug, { timeoutMs = 30000 } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  let result = null;

  const onResponse = async (res) => {
    if (result !== null) return;
    if (!res.url().includes("args=AssetsListForCollectionV2")) return;
    try {
      result = parseSearchResult(await res.json());
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
    for (let i = 0; i < timeoutMs / 300 && result === null; i++) {
      await sleep(300);
    }
  } finally {
    page.off("response", onResponse);
    await page.close();
  }

  return result ?? { listings: [], totalCount: 0 };
}

/**
 * 컬렉션 페이지에서 왼쪽 "특성(Traits)" 필터의 특정 항목(예: Rarity → Mythic)을
 * 실제로 클릭해서 적용한 뒤, 그 필터가 걸린 매물 목록을 가져온다.
 * (element.market 왼쪽 필터 UI를 그대로 조작하는 방식이라 사이트 UI가 바뀌면 깨질 수 있다.)
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} slug
 * @param {string} traitValue 예: "Mythic", "Legendary"
 * @param {{traitName?: string, timeoutMs?: number}} [opts] traitName 기본값 "Rarity"
 * @returns {Promise<{listings: Array<...>, totalCount: number}>} fetchCheapestListings 와 동일한 형태
 */
export async function fetchListingsByTrait(browser, slug, traitValue, opts = {}) {
  const { traitName = "Rarity", timeoutMs = 30000 } = opts;
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 1200 });

  let result = null;

  const onResponse = async (res) => {
    if (result !== null) return;
    if (!res.url().includes("/graphql")) return;
    const body = res.request().postData() || "";
    if (!body.includes('"traitFilters"') || !body.includes(traitValue)) return;
    try {
      result = parseSearchResult(await res.json());
    } catch {
      // 무시하고 다음 응답을 기다린다
    }
  };
  page.on("response", onResponse);

  try {
    await page.goto(`https://element.market/collections/${slug}`, {
      waitUntil: "networkidle2",
      timeout: timeoutMs,
    });

    const opened = await page.evaluate((name) => {
      const header = Array.from(document.querySelectorAll("div")).find(
        (e) => e.textContent.trim() === name && e.children.length <= 1,
      );
      if (header) {
        header.scrollIntoView({ block: "center" });
        header.click();
        return true;
      }
      return false;
    }, traitName);
    if (!opened) throw new Error(`"${traitName}" 특성 필터를 찾지 못함 (element.market UI 변경 가능성)`);

    await sleep(700);

    const clicked = await page.evaluate((value) => {
      const label = Array.from(document.querySelectorAll("*")).find(
        (e) => e.textContent.trim() === value && e.children.length === 0,
      );
      const row = label?.closest(".filter-left-list-wrap-item");
      if (row) {
        row.click();
        return true;
      }
      return false;
    }, traitValue);
    if (!clicked) throw new Error(`"${traitValue}" 값을 찾지 못함 (특성명/값 철자 확인)`);

    for (let i = 0; i < timeoutMs / 300 && result === null; i++) {
      await sleep(300);
    }
  } finally {
    page.off("response", onResponse);
    await page.close();
  }

  return result ?? { listings: [], totalCount: 0 };
}
