// 설정된 알림 채널이 실제로 동작하는지 확인하는 테스트.
// config.json 의 watchlist 에 컬렉션별 discordWebhookUrl 이 있으면 그것도 각각 테스트한다.
// 실행: npm run test:notify
import fs from "node:fs";
import { notify } from "./notify.js";

await notify(
  "element-nft-watcher 알림 테스트 (전역 채널)\n" +
    "이 메시지가 보이면 .env 의 채널 설정이 정상입니다.\n" +
    `시각: ${new Date().toISOString()}`,
);

const cfg = tryLoadJson("./config.json");
const withOwnWebhook = (cfg?.watchlist ?? []).filter((w) => w.discordWebhookUrl);

for (const w of withOwnWebhook) {
  await notify(
    `element-nft-watcher 알림 테스트 (${w.name} 전용 채널)\n` +
      `이 메시지가 이 컬렉션의 디스코드 채널에 뜨면 정상입니다.`,
    { discordWebhookUrl: w.discordWebhookUrl },
  );
}

console.log(
  `전송 시도 완료 (전역 1건 + 컬렉션별 ${withOwnWebhook.length}건). 위에 [notify:...] 오류 로그가 없으면 성공.`,
);

function tryLoadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
