// 여러 알림 채널로 동시에 메시지를 보낸다.
// .env 에 설정된 채널만 활성화되고, 하나도 없으면 콘솔로만 출력한다.
//
// 지원 채널 (환경변수):
//   Telegram : TG_TOKEN, TG_CHAT_ID
//   Discord  : DISCORD_WEBHOOK_URL
//   Slack    : SLACK_WEBHOOK_URL
//   ntfy     : NTFY_TOPIC, (선택) NTFY_SERVER=https://ntfy.sh, (선택) NTFY_TOKEN
//   Pushover : PUSHOVER_TOKEN, PUSHOVER_USER
//   범용     : WEBHOOK_URL  ({ "text": "..." } 형태로 POST)

const channels = [
  { name: "telegram", enabled: () => process.env.TG_TOKEN && process.env.TG_CHAT_ID, send: sendTelegram },
  { name: "discord", enabled: () => process.env.DISCORD_WEBHOOK_URL, send: sendDiscord },
  { name: "slack", enabled: () => process.env.SLACK_WEBHOOK_URL, send: sendSlack },
  { name: "ntfy", enabled: () => process.env.NTFY_TOPIC, send: sendNtfy },
  { name: "pushover", enabled: () => process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER, send: sendPushover },
  { name: "webhook", enabled: () => process.env.WEBHOOK_URL, send: sendWebhook },
];

// text 는 여러 줄 문자열. 첫 줄을 제목으로 쓰는 채널(ntfy, pushover)이 있다.
export async function notify(text) {
  const active = channels.filter((c) => c.enabled());

  if (active.length === 0) {
    console.log("[notify]", text);
    return;
  }

  const results = await Promise.allSettled(active.map((c) => c.send(text)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[notify:${active[i].name}] 전송 실패`, r.reason?.message ?? r.reason);
    }
  });
}

function titleOf(text) {
  return text.split("\n", 1)[0].slice(0, 120);
}

async function post(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function sendTelegram(text) {
  return post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TG_CHAT_ID,
      text,
      disable_web_page_preview: false,
    }),
  });
}

function sendDiscord(text) {
  return post(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
}

function sendSlack(text) {
  return post(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function sendNtfy(text) {
  const server = process.env.NTFY_SERVER || "https://ntfy.sh";
  const headers = { Title: encodeURIComponent(titleOf(text)) };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  return post(`${server.replace(/\/$/, "")}/${process.env.NTFY_TOPIC}`, {
    method: "POST",
    headers,
    body: text,
  });
}

function sendPushover(text) {
  return post("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      title: titleOf(text),
      message: text,
    }),
  });
}

function sendWebhook(text) {
  return post(process.env.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
