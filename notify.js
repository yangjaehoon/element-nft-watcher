// Telegram 알림 전송. 토큰이 없으면 콘솔로 출력만 한다.
export async function notify(text) {
  const token = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!token || !chatId) {
    console.log("[notify]", text);
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      console.error("[notify] telegram 응답 오류", res.status);
    }
  } catch (e) {
    console.error("[notify] 전송 실패", e.message);
  }
}
