/**
 * fetch-ai-news.js
 * 每天 08:00 由 GitHub Actions 执行
 * 流程：抓取 6 个 AI/科技 RSS 源 → 提取标题+摘要 → 调 DeepSeek 整理分类打标 → 写入 ai-news-data.json
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DEEPSEEK_API_KEY = process.env.DSAPIKEY;

// ─── RSS 源配置 ────────────────────────────────────────────────
const RSS_SOURCES = [
  {
    name: "AIbase日报",
    url: "https://www.aibase.com/rss/news.xml",
    company: "aibase",
    lang: "zh",
  },
  {
    name: "36氪AI",
    url: "https://36kr.com/feed",
    company: "36kr",
    lang: "zh",
  },
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    company: "techcrunch",
    lang: "en",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    company: "theverge",
    lang: "en",
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    company: "mit",
    lang: "en",
  },
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
    company: "venturebeat",
    lang: "en",
  },
];

// ─── HTTP GET（支持重定向）─────────────────────────────────────
function fetchUrl(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClawNewsBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      timeout: 15000,
    };
    const req = lib.request(options, (res) => {
      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        return fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`请求超时: ${urlStr}`)); });
    req.end();
  });
}

// ─── 简单 RSS/Atom 解析（不依赖第三方库）──────────────────────
function parseRSS(xml, sourceName, maxItems = 8) {
  const items = [];

  // 同时支持 RSS <item> 和 Atom <entry>
  const itemRegex = /<(item|entry)[\s>]([\s\S]*?)<\/(item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[2];

    const getTag = (tag) => {
      // 支持 CDATA 和普通文本
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
      const m = block.match(r);
      return m ? m[1].trim() : "";
    };

    const title = getTag("title").replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#\d+;/g,"").trim();
    const link = getTag("link") || (block.match(/href="([^"]+)"/)?.[1] || "");
    // 摘要：优先 description，其次 summary/content
    let desc = getTag("description") || getTag("summary") || getTag("content:encoded") || "";
    desc = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

    const pubDate = getTag("pubDate") || getTag("published") || getTag("updated") || "";

    if (title && title.length > 5) {
      items.push({ title, link, desc, pubDate, source: sourceName });
    }
  }
  return items;
}

// ─── 抓取所有 RSS 源 ──────────────────────────────────────────
async function fetchAllRSS() {
  const allItems = [];
  for (const src of RSS_SOURCES) {
    try {
      console.log(`📡 抓取 ${src.name}...`);
      const xml = await fetchUrl(src.url);
      const items = parseRSS(xml, src.name, 8);
      console.log(`  └→ 获取 ${items.length} 条`);
      allItems.push(...items.map(i => ({ ...i, sourceName: src.name, lang: src.lang })));
    } catch (e) {
      console.warn(`  └→ ⚠️ ${src.name} 抓取失败: ${e.message}`);
    }
  }
  return allItems;
}

// ─── 调用 DeepSeek ────────────────────────────────────────────
function callDeepSeek(messages, maxTokens = 4000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
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
      timeout: 90000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || "");
        } catch {
          reject(new Error("DeepSeek 响应解析失败: " + data.slice(0, 300)));
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
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  console.log(`🤖 开始抓取 AI 简报数据 ${todayStr}...`);

  // 1. 抓取所有 RSS
  const rawItems = await fetchAllRSS();
  console.log(`\n📦 共抓取 ${rawItems.length} 条原始条目`);

  if (rawItems.length === 0) {
    console.error("❌ 所有 RSS 源均抓取失败，退出");
    process.exit(1);
  }

  // 2. 组装喂给 DeepSeek 的新闻列表（只发标题+摘要，省 token）
  const newsList = rawItems.map((item, i) =>
    `[${i+1}] 来源:${item.sourceName} | 标题:${item.title} | 摘要:${item.desc.slice(0,100)}`
  ).join("\n");

  // 3. 调 DeepSeek 做整理
  const prompt = `以下是从多个 AI/科技媒体 RSS 抓取的最新新闻条目，请帮我整理成结构化 JSON。

新闻列表：
${newsList}

输出要求（直接输出 JSON，不要任何解释文字）：
{
  "updatedAt": "${todayStr}",
  "news": [
    {
      "id": 1,
      "company": "公司id（openai/anthropic/google/meta/microsoft/apple/nvidia/xai/deepseek/minimax/zhipu/moonshot/bytedance/alibaba/huawei/other 之一）",
      "title": "中文标题（如原文是英文请翻译成中文，简洁准确）",
      "tag": "分类（产品发布/技术突破/战略合作/人事变动/行业动态 之一）",
      "time": "${todayStr}",
      "source": "来源媒体名",
      "sourceUrl": "原文链接（从新闻列表中提取）",
      "hot": true或false（是否是重要热点），
      "summary": "100-150字中文摘要，概括核心内容，如原文是英文请翻译"
    }
  ]
}

筛选规则：
- 只保留与 AI、大模型、科技公司相关的新闻，过滤无关内容
- 去重，相似新闻只保留一条
- hot=true 的条件：重大产品发布、重要技术突破、行业重磅事件
- 预计保留 10-20 条高质量新闻
- company 字段尽量识别具体公司，识别不出填 other
- 只输出 JSON，不要 markdown 代码块`;

  console.log("\n🧠 调用 DeepSeek 整理分类...");
  let rawJson = "";
  try {
    rawJson = await callDeepSeek([
      { role: "system", content: "你是一个专业的 AI 行业新闻编辑。请严格按照用户要求的 JSON 格式输出，不要有任何多余内容，不要用 markdown 代码块包裹。" },
      { role: "user", content: prompt }
    ]);
    console.log("✅ DeepSeek 返回内容长度:", rawJson.length);
  } catch (e) {
    console.error("❌ DeepSeek 调用失败:", e.message);
    process.exit(1);
  }

  // 4. 提取 JSON
  const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("❌ 无法从响应中提取 JSON:\n", rawJson.slice(0, 500));
    process.exit(1);
  }

  let aiNewsData;
  try {
    aiNewsData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("❌ JSON 解析失败:", e.message, "\n原始内容:\n", jsonMatch[0].slice(0, 500));
    process.exit(1);
  }

  // 5. 补充字段
  const now = new Date();
  aiNewsData.updatedAt = now.toISOString();
  aiNewsData.updatedAtCN = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  // 给每条新闻补 relTime 字段
  if (Array.isArray(aiNewsData.news)) {
    aiNewsData.news = aiNewsData.news.map((n, i) => ({
      ...n,
      id: i + 1,
      relTime: "今天",
    }));
  }

  // 6. 写入文件
  const outPath = path.join(__dirname, "..", "ai-news-data.json");
  fs.writeFileSync(outPath, JSON.stringify(aiNewsData, null, 2), "utf-8");

  const total = (aiNewsData.news || []).length;
  console.log(`\n✅ 完成！共整理 ${total} 条 AI 新闻，写入 ai-news-data.json`);
}

main().catch((e) => { console.error("❌ 脚本异常:", e); process.exit(1); });
