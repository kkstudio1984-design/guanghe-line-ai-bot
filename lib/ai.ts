import { config } from "./config";
import type { KbEntry } from "./kb";

export type Decision = {
  action: "answer" | "handoff" | "unknown" | "smalltalk";
  messages: string[];
  used_entry_ids: string[];
  draft_question: string;
  handoff_reason: string;
  need_summary: string;
};

/** 現在是不是櫃台時間（週一至週五 09:30–18:30，台北時間） */
export function isOfficeHours(now = new Date()): boolean {
  const tpe = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = tpe.getDay();
  const mins = tpe.getHours() * 60 + tpe.getMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 18 * 60 + 30;
}

function buildSystemPrompt(entries: KbEntry[], voice: string, officeHours: boolean): string {
  const kb = entries
    .map((e) =>
      [
        `<entry id="${e.id}">`,
        `問題：${e.question}`,
        e.aliases ? `其他問法：${e.aliases}` : "",
        `標準回答：${e.answer}`,
        e.needsHuman ? "【這題需要轉真人】" : "",
        `</entry>`,
      ].filter(Boolean).join("\n"),
    )
    .join("\n");

  const links = [
    config.priceUrl() && `價目表：${config.priceUrl()}`,
    config.bookingUrl() && `一樓預約登記：${config.bookingUrl()}`,
    config.mapUrl() && `Google 地圖：${config.mapUrl()}`,
    config.foodMapUrl() && `周邊美食地圖：${config.foodMapUrl()}`,
  ].filter(Boolean).join("\n");

  return `你是「光合創學」LINE 官方帳號的小幫手，幫忙回覆客人。光合創學在新北市新店區十四張站旁，一樓是可租借的活動場地，二樓是共享工位。

# 最重要的規則
1. 事實只能來自下面 <knowledge> 裡的條目。條目沒寫的事，一律不能自己編，包括價格數字、檔期、設備、規定。
2. 不報任何價格數字。客人問價格，附價目表連結，或說「告訴我日期和人數，我幫你算」然後轉真人。
3. 不承諾任何日期有空。客人問某天能不能借，說「我幫你看那天的時段」並轉真人確認。
4. 對到的條目標了【這題需要轉真人】→ action 用 "handoff"：先回應客人、收集需要的資料（日期、人數、活動內容、單位名稱），說會請光光或同事跟他聯絡。
5. 沒有任何條目能回答 → action 用 "unknown"：說「這個我先確認一下再回你」，可以順便問一個有助於確認的細節。draft_question 寫成一句標準問題，讓同仁補進知識庫。
6. 客人問「你是真人嗎」→ 誠實說是光合的小幫手，想找真人隨時說一聲。
7. 客人說要找真人、生氣、抱怨、或講到退費糾紛 → action 用 "handoff"。
8. 打招呼、道謝、閒聊 → action 用 "smalltalk"，簡短自然地回，順勢問他需要什麼。

# 回覆格式
- messages 放 1–2 則短訊息，每則約 60 字以內，像真人在 LINE 打字。
- 不用條列、不用粗體、不用「親」「您好很高興為您服務」「如有任何問題歡迎隨時詢問」這類客服套話。
- 先接住客人說的事，再給這次需要的一兩個重點，最後用一個問題往下推（日期？人數？時段？）。
- 需要時可以附上這些連結（只能用這裡有的連結，沒有就不要附）：
${links || "（目前沒有設定連結）"}
${officeHours ? "" : "- 現在不是櫃台時間（週一至週五 09:30–18:30）。如果要轉真人，告訴客人同仁上班後會回覆。"}

# 語氣指南（照這份的說話方式）
<voice>
${voice || "用「你」稱呼對方，句子短，表情符號一則最多一個。"}
</voice>

# 知識庫（只有這些是確定的事實）
<knowledge>
${kb || "（目前沒有已確認的條目，所有問題都用 unknown 或 handoff 處理）"}
</knowledge>

need_summary：用一句話整理目前知道的客人需求（例如「週一晚上 15 人練太鼓，想長期租」），不知道就留空。`;
}

const TOOL = {
  name: "reply_to_customer",
  description: "決定怎麼回覆這位 LINE 客人",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["answer", "handoff", "unknown", "smalltalk"] },
      messages: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
      used_entry_ids: { type: "array", items: { type: "string" }, description: "這次回覆用到的知識庫條目 id" },
      draft_question: { type: "string", description: "action=unknown 時，寫成一句標準問題" },
      handoff_reason: { type: "string", description: "action=handoff 時，給同仁看的一句話原因" },
      need_summary: { type: "string" },
    },
    required: ["action", "messages", "used_entry_ids", "draft_question", "handoff_reason", "need_summary"],
  },
};

export async function decideReply(opts: {
  entries: KbEntry[];
  voice: string;
  customerName: string;
  history: string;
  previousSummary: string;
  text: string;
}): Promise<Decision> {
  if (config.mockAi()) return mockDecide(opts.entries, opts.text);

  const system = buildSystemPrompt(opts.entries, opts.voice, isOfficeHours());
  const user = `客人 LINE 名稱：${opts.customerName}
${opts.previousSummary ? `目前已知需求：${opts.previousSummary}\n` : ""}${opts.history ? `最近的對話：\n${opts.history}\n` : ""}
客人剛剛傳來：
${opts.text}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropicModel(),
      max_tokens: 800,
      system,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API 失敗 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const block = data.content?.find((c: any) => c.type === "tool_use");
  if (!block) throw new Error("Claude 沒有回傳 tool_use");
  return sanitize(block.input, opts.entries);
}

/** 防呆：確保格式正確、id 真的存在 */
function sanitize(d: any, entries: KbEntry[]): Decision {
  const ids = new Set(entries.map((e) => e.id));
  const messages = (Array.isArray(d.messages) ? d.messages : [String(d.messages ?? "")])
    .map((m: unknown) => String(m).trim()).filter(Boolean).slice(0, 2);
  return {
    action: ["answer", "handoff", "unknown", "smalltalk"].includes(d.action) ? d.action : "unknown",
    messages: messages.length ? messages : ["收到！我先確認一下再回你喔"],
    used_entry_ids: (d.used_entry_ids ?? []).filter((id: string) => ids.has(id)),
    draft_question: String(d.draft_question ?? ""),
    handoff_reason: String(d.handoff_reason ?? ""),
    need_summary: String(d.need_summary ?? ""),
  };
}

/** 本機測試用：不呼叫 Claude，用關鍵字粗略比對 */
function mockDecide(entries: KbEntry[], text: string): Decision {
  const hit = entries.find((e) =>
    [e.question, ...e.aliases.split(/[？?、，,\s]+/)].some((k) => k && k.length >= 2 && text.includes(k.replace(/[？?]/g, ""))),
  );
  if (!hit) {
    return { action: "unknown", messages: ["這個我先確認一下再回你喔"], used_entry_ids: [],
      draft_question: text, handoff_reason: "", need_summary: "" };
  }
  return {
    action: hit.needsHuman ? "handoff" : "answer",
    messages: [hit.answer.slice(0, 60)],
    used_entry_ids: [hit.id],
    draft_question: "",
    handoff_reason: hit.needsHuman ? `客人問到：${hit.question}` : "",
    need_summary: "",
  };
}
