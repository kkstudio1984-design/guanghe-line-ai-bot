import { config } from "./config";
import { notion, queryAll, readProp, P } from "./notion";

export type Customer = {
  pageId: string;
  userId: string;
  name: string;
  status: string;
  pausedUntil: string | null;
  history: string;
  summary: string;
  messageCount: number;
};

// 本機測試用的記憶體版
const memory = new Map<string, Customer>();

function fromPage(p: any): Customer {
  return {
    pageId: p.id,
    userId: readProp(p, "LINE userId") ?? "",
    name: readProp(p, "名稱") ?? "",
    status: readProp(p, "狀態") ?? "AI 接待中",
    pausedUntil: readProp(p, "暫停 AI 到"),
    history: readProp(p, "最近對話") ?? "",
    summary: readProp(p, "需求摘要") ?? "",
    messageCount: readProp(p, "訊息數") ?? 0,
  };
}

export async function findOrCreateCustomer(userId: string, displayName: () => Promise<string>): Promise<Customer> {
  if (config.fixtureDir()) {
    let c = memory.get(userId);
    if (!c) {
      c = { pageId: `mem-${userId}`, userId, name: await displayName(), status: "AI 接待中",
        pausedUntil: null, history: "", summary: "", messageCount: 0 };
      memory.set(userId, c);
    }
    return c;
  }

  const found = await queryAll(config.customersDataSourceId(), {
    property: "LINE userId",
    rich_text: { equals: userId },
  });
  if (found.length > 0) return fromPage(found[0]);

  const name = await displayName();
  const now = new Date().toISOString();
  const page = await notion("/pages", {
    parent: { type: "data_source_id", data_source_id: config.customersDataSourceId() },
    properties: {
      名稱: P.title(name),
      "LINE userId": P.text(userId),
      狀態: P.select("AI 接待中"),
      加入時間: P.date(now),
      訊息數: P.number(0),
    },
  });
  return fromPage(page);
}

/** AI 是否該對這位客人閉嘴（真人接手中，或暫停時間還沒到） */
export function isAiPaused(c: Customer, now = new Date()): boolean {
  if (c.status === "真人接手中") return true;
  if (c.pausedUntil && new Date(c.pausedUntil) > now) return true;
  return false;
}

/** 把一來一往寫回對話紀錄（只留最後約 1,800 字） */
export function appendHistory(c: Customer, who: "客" | "光合", text: string) {
  const line = `${who}：${text.replace(/\s+/g, " ").trim()}`;
  const all = (c.history ? c.history + "\n" : "") + line;
  c.history = all.length > 1800 ? all.slice(all.length - 1800).replace(/^[^\n]*\n/, "") : all;
}

export async function saveCustomer(c: Customer, patch: { status?: string; pauseHours?: number; summary?: string }) {
  if (patch.status) c.status = patch.status;
  if (patch.summary) c.summary = patch.summary;
  if (patch.pauseHours) c.pausedUntil = new Date(Date.now() + patch.pauseHours * 3600_000).toISOString();
  c.messageCount += 1;

  if (config.fixtureDir()) {
    memory.set(c.userId, c);
    console.log(`[FIXTURE] 客人紀錄更新：${c.name}｜${c.status}｜暫停到 ${c.pausedUntil ?? "—"}\n${c.history}`);
    return;
  }

  await notion(`/pages/${c.pageId}`, {
    properties: {
      狀態: P.select(c.status),
      最近對話: P.text(c.history),
      最後訊息時間: P.date(new Date().toISOString()),
      訊息數: P.number(c.messageCount),
      ...(patch.summary ? { 需求摘要: P.text(c.summary) } : {}),
      ...(patch.pauseHours ? { "暫停 AI 到": P.date(c.pausedUntil) } : {}),
    },
  }, "PATCH");
}
