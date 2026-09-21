// element.market 컬렉션 페이지를 헤드리스 브라우저로 열어, 페이지 자신이 호출하는
// GraphQL(AssetsListForCollectionV2) 응답을 가로채서 가격 낮은 순 매물 목록을 얻는다.
//
// API 키가 필요 없다: 서명(X-Api-Key / X-Api-Sign)은 실제 브라우저 JS가 알아서
// 계산해서 보내므로, 우리는 응답만 읽으면 된다. 사람이 브라우저로 접속해
// 화면의 가격을 보는 것과 기술적으로 동일하다.

const GRAPHQL_ARG = "args=AssetsListForCollectionV2";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('puppeteer').Browser} browser
 * @param {string} slug element.market 컬렉션 슬러그
 * @returns {Promise<{listings: Array<{tokenId:string, contractAddress:string, orderId:string, priceUsd:number, priceBase:number, paymentToken:string, expirationTime:number}>, totalCount:number}>}
 *          listings 는 가격 오름차순, 최대 18건(페이지 크기)까지. totalCount 는 전체 매물 수.
 */
export async function fetchCheapestListings(browser, slug, { timeoutMs = 30000 } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  );

  let listings = null;
  let totalCount = 0;

  const onResponse = async (res) => {
    if (listings !== null) return;
    if (!res.url().includes(GRAPHQL_ARG)) return;
    try {
      const json = await res.json();
      totalCount = json?.data?.search?.totalCount ?? 0;
      const edges = json?.data?.search?.edges ?? [];
      listings = edges
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
        });
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
    for (let i = 0; i < timeoutMs / 300 && listings === null; i++) {
      await sleep(300);
    }
  } finally {
    page.off("response", onResponse);
    await page.close();
  }

  return { listings: listings ?? [], totalCount };
}
