// 本機模擬 LINE 打 webhook：node scripts/simulate.mjs [網址]
// 需搭配：LINE_CHANNEL_SECRET=test DRY_RUN=1 MOCK_AI=1 FIXTURE_DIR=scripts/fixtures npm start
import crypto from "node:crypto";
const url = process.argv[2] ?? "http://localhost:3000/api/line/webhook";
const secret = process.env.LINE_CHANNEL_SECRET ?? "test";
const user = { type: "user", userId: "U-test-001" };

async function send(events, { badSig = false } = {}) {
  const body = JSON.stringify({ destination: "x", events });
  const sig = badSig ? "wrong" : crypto.createHmac("sha256", secret).update(body).digest("base64");
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sig }, body });
  return res.status;
}
const text = (t) => ({ type: "message", replyToken: "rt-" + Math.random(), source: user, message: { type: "text", id: "1", text: t } });

const cases = [
  ["簽章錯誤 → 應 401", [text("hi")], { badSig: true }],
  ["加好友", [{ type: "follow", replyToken: "rt", source: user }]],
  ["問美食（對得到）", [text("附近有便當店嗎")]],
  ["問代訂（對得到）", [text("可以幫我們訂午餐嗎")]],
  ["問不知道的（建草稿）", [text("可以帶小朋友來嗎")]],
  ["圖文選單按鈕（AI 不回）", [text("交通停車")]],
  ["長期優惠（轉真人＋暫停）", [text("如果長期租可以便宜一點嗎")]],
  ["暫停中再問（AI 不回）", [text("附近有便當店嗎")]],
  ["傳圖片（交給真人）", [{ type: "message", replyToken: "rt", source: user, message: { type: "image", id: "2" } }]],
];
for (const [name, events, opt] of cases) {
  console.log(`\n=== ${name} ===`);
  console.log("HTTP", await send(events, opt));
}
