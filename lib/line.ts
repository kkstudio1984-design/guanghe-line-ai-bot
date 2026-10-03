import crypto from "node:crypto";
import { config } from "./config";

const API = "https://api.line.me/v2/bot";

/** 驗證 LINE 送來的簽章，確認請求真的來自 LINE */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", config.lineChannelSecret())
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(path: string, body?: unknown, method = "POST") {
  if (config.dryRun()) {
    console.log(`[DRY_RUN] LINE ${method} ${path}`, body ? JSON.stringify(body) : "");
    return null;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.lineAccessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.error(`LINE API ${path} 失敗`, res.status, await res.text());
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** 回覆訊息（用 reply token，不算訊息則數） */
export async function reply(replyToken: string, texts: string[]) {
  const messages = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((text) => ({ type: "text", text: text.slice(0, 5000) }));
  if (messages.length === 0) return;
  await call("/message/reply", { replyToken, messages });
}

/** 主動推播（會算訊息則數，只用在通知同仁） */
export async function push(to: string, text: string) {
  await call("/message/push", { to, messages: [{ type: "text", text: text.slice(0, 5000) }] });
}

/** 顯示「輸入中…」動畫，讓客人知道有人在回 */
export async function showLoading(userId: string, seconds = 10) {
  await call("/chat/loading/start", { chatId: userId, loadingSeconds: seconds });
}

/** 取得客人的 LINE 顯示名稱 */
export async function getDisplayName(userId: string): Promise<string> {
  if (config.dryRun()) return "測試客人";
  const res = await call(`/profile/${userId}`, undefined, "GET");
  return res?.displayName ?? "LINE 客人";
}
