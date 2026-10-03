// 所有設定都從環境變數讀（Vercel → Settings → Environment Variables）

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`缺少環境變數 ${name}`);
  }
  return v;
}

export const config = {
  // LINE Messaging API（LINE Developers → 你的 Channel → Basic settings / Messaging API）
  lineChannelSecret: () => env("LINE_CHANNEL_SECRET"),
  lineAccessToken: () => env("LINE_CHANNEL_ACCESS_TOKEN"),

  // Notion（建立 integration 後，把知識庫、語氣指南、LINE 客人三個頁面都「連接」給它）
  notionToken: () => env("NOTION_TOKEN"),
  kbDataSourceId: () => env("NOTION_KB_DATA_SOURCE_ID", "ba4bb142-d9ed-49ab-aed8-59ad5c746235"),
  customersDataSourceId: () => env("NOTION_CUSTOMERS_DATA_SOURCE_ID", "e88b68d9-6da8-4e3c-991c-410cfdbe0e13"),
  voiceGuidePageId: () => env("NOTION_VOICE_GUIDE_PAGE_ID", "3ee0fcad0bc6813aa1a8f9a1be58ad80"),

  // Claude API
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  anthropicModel: () => env("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),

  // 對外連結（AI 講到價格、預約、地圖時附上）
  priceUrl: () => process.env.PRICE_URL ?? "",
  bookingUrl: () => process.env.BOOKING_URL ?? "",
  mapUrl: () => process.env.MAP_URL ?? "",
  foodMapUrl: () => process.env.FOOD_MAP_URL ?? "",

  // 轉真人時要推播通知的 LINE userId（逗號分隔）。推播會算官方帳號的訊息則數，留空就只寫進 Notion。
  staffNotifyUserIds: () =>
    (process.env.STAFF_NOTIFY_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  // 轉真人後，AI 對這位客人暫停幾小時
  handoffPauseHours: () => Number(process.env.HANDOFF_PAUSE_HOURS ?? "24"),

  // 這些字由 LINE 後台的「關鍵字自動回應」處理（圖文選單按鈕會送出這些字），AI 不再重複回
  menuKeywords: () =>
    (process.env.MENU_KEYWORDS ??
      "一樓場地,價格方案,怎麼預約,交通停車,美食地圖,找真人,時段,無障礙,設備,工位")
      .split(",").map((s) => s.trim()).filter(Boolean),

  // 只記錄、不打 LINE API（本機測試用）
  dryRun: () => process.env.DRY_RUN === "1",
  // 不呼叫 Claude，用假回覆（本機測試用）
  mockAi: () => process.env.MOCK_AI === "1",
  // 用本機 JSON 代替 Notion（本機測試用）
  fixtureDir: () => process.env.FIXTURE_DIR ?? "",
};
