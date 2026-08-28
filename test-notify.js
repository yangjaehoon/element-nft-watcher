// 설정된 알림 채널이 실제로 동작하는지 확인하는 테스트.
// 실행: npm run test:notify
import { notify } from "./notify.js";

await notify(
  "element-nft-watcher 알림 테스트\n" +
    "이 메시지가 보이면 채널 설정이 정상입니다.\n" +
    `시각: ${new Date().toISOString()}`,
);
console.log("전송 시도 완료. 위에 [notify:...] 오류 로그가 없으면 성공.");
