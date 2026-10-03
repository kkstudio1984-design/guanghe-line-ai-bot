import { verifySignature } from "@/lib/line";
import { handleEvent } from "@/lib/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // AI 回覆需要幾秒，給足時間

// LINE Webhook URL：https://你的網域/api/line/webhook
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-line-signature"))) {
    return new Response("invalid signature", { status: 401 });
  }

  const body = JSON.parse(raw);
  const events: any[] = body.events ?? [];

  // 一則一則處理；單一事件出錯不影響其他事件
  await Promise.all(
    events.map((e) => handleEvent(e).catch((err) => console.error("處理事件失敗", err))),
  );

  return new Response("ok");
}

// 方便確認有沒有部署成功
export async function GET() {
  return new Response("光合 LINE AI 客服 webhook 運作中");
}
