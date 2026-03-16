/**
 * fetch-news.js
 * 每天 08:00 由 GitHub Actions 执行
 * 调用 DeepSeek 联网搜索，整理当日中文新闻 → 写入 news-data.json
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DEEPSEEK_API_KEY = process.env.DSAPIKEY;

// ─── 调用 DeepSeek ────────────────────────────────────────────
function callDeepSeek(messages, maxTokens = 3000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    });
    const options = {
      hostname: "api.deepseek.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 60000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || "");
        } catch {
          reject(new Error("DeepSeek 响应解析失败: " + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("DeepSeek 超时")); });
    req.write(body);
    req.end();
  });
}

// ─── 主流程 ───────────────────────────────────────────────────
async function main() {
  if (!DEEPSEEK_API_KEY) {
    console.error("❌ 未配置 DSAPIKEY 环境变量");
    process.exit(1);
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;
  console.log(`📰 开始整理 ${dateStr} 新闻...`);

  const prompt = `请整理${dateStr}的最新新闻，输出严格符合以下 JSON 格式，不要有任何多余文字，直接输出 JSON：

{
  "summary": ["今日要点1（50字以内）", "今日要点2", "今日要点3", "今日要点4", "今日要点5"],
  "categories": [
    {
      "category": "international",
      "label": "🌍 国际局势",
      "color": "#60a5fa",
      "items": [
        {"title": "新闻标题", "desc": "100字以内的中文摘要", "tag": "分类标签", "link": ""}
      ]
    },
    {
      "category": "china",
      "label": "🏛️ 国内要闻",
      "color": "#4ade80",
      "items": []
    },
    {
      "category": "tech",
      "label": "💻 科技产业",
      "color": "#c084fc",
      "items": []
    },
    {
      "category": "finance",
      "label": "📊 金融市场",
      "color": "#fb923c",
      "items": []
    },
    {
      "category": "sports",
      "label": "⚽ 体育动态",
      "color": "#f87171",
      "items": []
    }
  ]
}

要求：
- 每个分类 3-5 条新闻
- 全部使用中文
- tag 字段填写简短分类词（如：军事、科技、金融、政策等）
- summary 是今日最值得关注的5条跨分类精华，每条不超过60字
- 只输出 JSON，不要有任何解释文字`;

  let rawJson = "";
  try {
    rawJson = await callDeepSeek([
      { role: "system", content: "你是一个专业的新闻编辑，擅长整理每日全球要闻。请严格按照用户要求的 JSON 格式输出，不要有任何多余内容。" },
      { role: "user", content: prompt }
    ]);
    console.log("✅ DeepSeek 返回内容长度:", rawJson.length);
  } catch(e) {
    console.error("❌ DeepSeek 调用失败:", e.message);
    process.exit(1);
  }

  // 提取 JSON（防止模型输出了额外文字）
  const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("❌ 无法从响应中提取 JSON:\n", rawJson.slice(0, 500));
    process.exit(1);
  }

  let newsData;
  try {
    newsData = JSON.parse(jsonMatch[0]);
  } catch(e) {
    console.error("❌ JSON 解析失败:", e.message);
    process.exit(1);
  }

  // 补充时间字段
  const now = new Date();
  newsData.updatedAt = now.toISOString();
  newsData.updatedAtCN = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  const outPath = path.join(__dirname, "..", "news-data.json");
  fs.writeFileSync(outPath, JSON.stringify(newsData, null, 2), "utf-8");

  const totalItems = (newsData.categories || []).reduce((n, c) => n + (c.items||[]).length, 0);
  console.log(`✅ 完成！共整理 ${totalItems} 条新闻，写入 news-data.json`);
}

main().catch((e) => { console.error("❌ 脚本异常:", e); process.exit(1); });
