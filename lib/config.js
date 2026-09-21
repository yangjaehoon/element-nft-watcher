// watcher.js / stream-watcher.js / check-floors.js / test-notify.js 가 공통으로
// 쓰는 JSON 설정 로더. (이전엔 각 스크립트가 이 try/catch 를 따로 구현하고 있었다.)
import fs from "node:fs";

export function loadJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// config.json 을 읽는다. 없으면 안내 메시지를 출력하고 프로세스를 종료한다.
export function loadConfigOrExit(path = "./config.json") {
  const cfg = loadJson(path, null);
  if (!cfg) {
    console.error("config.json 이 없습니다. config.example.json 을 복사해서 작성하세요.");
    process.exit(1);
  }
  return cfg;
}
