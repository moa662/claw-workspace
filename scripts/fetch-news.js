/**
 * fetch-news.js
 * 每天 08:00 由 GitHub Actions 执行
 * 抓取 RSS → 调用 DeepSeek 生成摘要 → 写入 news-data.json
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DEEPSEEK_API_KEY = process.env.DSAPIKEY;

// ─── RSS 新闻源 ───────────────────────────────────────────────
const SOURCES = [
  {
    category: "international",
    label: "🌍 国际要闻",
    feeds: [
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://feeds.reuters.com/reuters/worldNews",
    ],
  },
  {
    category: "china",
    label: "🇨🇳 国内要闻",
    feeds: [
      "http://www.xinhuanet.com/politics/news_politics.xml",
      "https://rsshub.app/cctv/world",
    ],
  },
  {
    category: "finance",
    label: "📈 财经动态",
    feeds: [
      "https://feeds.bloomberg.com/markets/news.rss",
      "https://rsshub.app/cls/telegraph",
    ],
  },
];

// ─── 工具函数 ─────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : require("http");
    const req = mod.get(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 NewsBot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseRSS(xml, maxItems = 5) {
  const items = [];
  const itemReg = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemReg.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                   block.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || "";
    const link  = (block.match(/<link[^>]*>(.*?)<\/link>/i) || [])[1] || "";
    const desc  = (block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i) ||
                   block.match(/<description[^>]*>(.*?)<\/description>/i) || [])[1] || "";
    const pubDate = (block.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) || [])[1] || "";
    if (title.trim()) {
      items.push({
        title: title.trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        link: link.trim(),
        desc: desc.replace(/<[^>]+>/g, "").trim().slice(0, 120),
        pubDate: pubDate.trim(),
      });
    }
  }
  return items;
}

async function fetchCategory(source) {
  const items = [];
  for (const feed of source.feeds) {
    try {
      const xml = await fetchUrl(feed);
      const parsed = parseRSS(xml, 4);
      items.push(...parsed);
    } catch (e) {
      console.warn(`[WARN] 抓取失败: ${feed} → ${e.message}`);
    }
  }
  return { category: source.category, label: source.label, items: items.slice(0, 6) };
}

// ─── DeepSeek 摘要 ────────────────────────────────────────────
function callDeepSeek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 0.5,
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
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || "摘要生成失败");
        } catch {
          reject(new Error("DeepSeek 响应解析失败"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("DeepSeek 超时")); });
    req.write(body);
    req.end();
  });
}

async function generateSummary(allItems) {
  if (!DEEPSEEK_API_KEY) return ["（未配置 API Key，跳过 AI 摘要）"];
  const headlines = allItems
    .flatMap((c) => c.items.slice(0, 3).map((i) => `- ${i.title}`))
    .slice(0, 15)
    .join("\n");
  const prompt = `以下是今日全球新闻标题，请用中文提炼出5条最值得关注的要点，每条50字以内，格式为编号列表（1. 2. 3. 4. 5.），语气简洁专业：\n\n${headlines}`;
  try {
    const result = await callDeepSeek(prompt);
    return result.split("\n").filter((l) => /^\d+\./.test(l.trim())).slice(0, 5);
  } catch (e) {
    console.warn("[WARN] AI 摘要失败:", e.message);
    return ["（AI 摘要暂时不可用）"];
  }
}

// ─── 主流程 ───────────────────────────────────────────────────
async function main() {
  console.log("📰 开始抓取新闻...");
  const results = await Promise.all(SOURCES.map(fetchCategory));

  console.log("🤖 生成 AI 要点摘要...");
  const summary = await generateSummary(results);

  const now = new Date();
  const output = {
    updatedAt: now.toISOString(),
    updatedAtCN: `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`,
    summary,
    categories: results,
  };

  const outPath = path.join(__dirname, "..", "news-data.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`✅ 完成！共抓取 ${results.reduce((n, c) => n + c.items.length, 0)} 条新闻，写入 news-data.json`);
}

main().catch((e) => { console.error("❌ 脚本异常:", e); process.exit(1); });
