import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const MAX_QUESTION_LENGTH = 3000;
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const LAWYERS_FILE = path.join(DATA_DIR, "lawyers.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
const openaiApiKey = process.env.OPENAI_API_KEY || "";

const provider = deepseekApiKey ? "deepseek" : "openai";
const apiKey = deepseekApiKey || openaiApiKey;
const hasApiKey = Boolean(apiKey);

const MODEL_NAME = deepseekApiKey
  ? process.env.DEEPSEEK_MODEL || "deepseek-chat"
  : process.env.OPENAI_MODEL || "gpt-4.1-mini";

const BASE_URL = deepseekApiKey
  ? process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1"
  : process.env.OPENAI_BASE_URL || undefined;

const openai = hasApiKey
  ? new OpenAI({
      apiKey,
      baseURL: BASE_URL,
    })
  : null;

const sessions = new Map();
const storageReady = initializeStorage();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(async (_req, _res, next) => {
  try {
    await storageReady;
    next();
  } catch (error) {
    next(error);
  }
});

async function initializeStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await ensureJsonFile(LAWYERS_FILE, []);
  await ensureJsonFile(USERS_FILE, []);
  await ensureJsonFile(REVIEWS_FILE, []);
}

async function ensureJsonFile(filePath, defaultData) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), "utf8");
  }
}

async function readJson(filePath, defaultData) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return defaultData;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hashed = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, hash] = String(passwordHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }
  try {
    const hashedAttempt = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashedAttempt, "hex"));
  } catch {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    userId,
    createdAt: Date.now(),
  });
  return token;
}

function getTokenFromRequest(req) {
  const authHeader = req.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "請先登入。" });
  }

  const session = sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: "登入已失效，請重新登入。" });
  }

  const users = await readJson(USERS_FILE, []);
  const user = users.find((entry) => entry.id === session.userId);
  if (!user) {
    sessions.delete(token);
    return res.status(401).json({ error: "帳號不存在，請重新登入。" });
  }

  req.authToken = token;
  req.user = user;
  return next();
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const cleanHistory = history
    .filter((item) => item && typeof item.content === "string")
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, MAX_QUESTION_LENGTH),
    }));

  return cleanHistory;
}

function createSystemPrompt() {
  return [
    "你是「香港法律 AI 助手」，只使用繁體中文回覆。",
    "你需要盡力回答香港特別行政區法律問題（民事、刑事、僱傭、公司、租務、家庭、知識產權、合規等）。",
    "回答格式：",
    "1) 先給出重點結論（簡短）",
    "2) 再列出法律分析（條列式）",
    "3) 如能確認，提供相關香港法例名稱、章號或常見法律原則",
    "4) 給出實務下一步建議",
    "5) 補充風險與不確定性",
    "請避免虛構法例與條文；如果無法確認，直接說明「未能確認具體章節，建議進一步查證」。",
    "這不是正式法律意見，請提醒使用者在重要案件上諮詢香港執業律師。",
  ].join("\n");
}

function fallbackMessage() {
  return [
    "目前系統尚未設定 AI 金鑰，所以暫時未能提供即時法律分析。",
    "",
    "請由網站管理員在伺服器設定以下環境變數後重試：",
    "- （擇一）DEEPSEEK_API_KEY 或 OPENAI_API_KEY",
    "- （DeepSeek 可選）DEEPSEEK_MODEL，例如 deepseek-chat",
    "- （DeepSeek 可選）DEEPSEEK_BASE_URL，預設為 https://api.deepseek.com/v1",
    "- （OpenAI 可選）OPENAI_MODEL，例如 gpt-4.1-mini",
    "- （OpenAI 可選）OPENAI_BASE_URL（如使用相容 API 服務）",
  ].join("\n");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey,
    provider,
    model: MODEL_NAME,
  });
});

app.get("/api/law-categories", async (_req, res) => {
  const lawyers = await readJson(LAWYERS_FILE, []);
  const categories = [
    ...new Set(
      lawyers
        .flatMap((lawyer) => (Array.isArray(lawyer.categories) ? lawyer.categories : []))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-Hant"));

  return res.json({ categories });
});

app.get("/api/lawyers", async (req, res) => {
  const query = String(req.query.query || "").trim().toLowerCase();
  const category = String(req.query.category || "").trim();
  const pageRaw = Number.parseInt(String(req.query.page || "1"), 10);
  const pageSizeRaw = Number.parseInt(String(req.query.pageSize || "12"), 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 6), 24) : 12;

  const lawyers = await readJson(LAWYERS_FILE, []);
  const reviews = await readJson(REVIEWS_FILE, []);

  const filtered = lawyers.filter((lawyer) => {
    const searchHaystack = [
      lawyer.nameZh,
      lawyer.nameEn,
      lawyer.firmZh,
      lawyer.firmEn,
      lawyer.district,
      ...(Array.isArray(lawyer.languages) ? lawyer.languages : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const queryMatched = !query || searchHaystack.includes(query);
    const categoryMatched =
      !category ||
      (Array.isArray(lawyer.categories) && lawyer.categories.some((entry) => entry === category));

    return queryMatched && categoryMatched;
  });

  const reviewSummaryMap = reviews.reduce((acc, review) => {
    if (!acc[review.lawyerId]) {
      acc[review.lawyerId] = { count: 0, total: 0 };
    }
    acc[review.lawyerId].count += 1;
    acc[review.lawyerId].total += Number(review.rating || 0);
    return acc;
  }, {});

  const total = filtered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;

  const items = filtered.slice(startIndex, startIndex + pageSize).map((lawyer) => {
    const summary = reviewSummaryMap[lawyer.id] || { count: 0, total: 0 };
    const averageRating = summary.count === 0 ? null : Number((summary.total / summary.count).toFixed(1));
    return {
      ...lawyer,
      reviewCount: summary.count,
      averageRating,
    };
  });

  return res.json({
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
  });
});

app.get("/api/lawyers/:lawyerId/reviews", async (req, res) => {
  const { lawyerId } = req.params;
  const lawyers = await readJson(LAWYERS_FILE, []);
  const exists = lawyers.some((lawyer) => lawyer.id === lawyerId);
  if (!exists) {
    return res.status(404).json({ error: "找不到指定律師。" });
  }

  const reviews = await readJson(REVIEWS_FILE, []);
  const lawyerReviews = reviews
    .filter((review) => review.lawyerId === lawyerId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  return res.json({ items: lawyerReviews });
});

app.get("/api/lawyers/:lawyerId", async (req, res) => {
  const { lawyerId } = req.params;
  const lawyers = await readJson(LAWYERS_FILE, []);
  const lawyer = lawyers.find((entry) => entry.id === lawyerId);
  if (!lawyer) {
    return res.status(404).json({ error: "找不到指定律師。" });
  }

  const reviews = await readJson(REVIEWS_FILE, []);
  const lawyerReviews = reviews.filter((review) => review.lawyerId === lawyerId);
  const ratingTotal = lawyerReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
  const averageRating =
    lawyerReviews.length === 0 ? null : Number((ratingTotal / lawyerReviews.length).toFixed(1));

  return res.json({
    ...lawyer,
    reviewCount: lawyerReviews.length,
    averageRating,
  });
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!name || !email || !password) {
    return res.status(400).json({ error: "請填寫姓名、電郵及密碼。" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "請輸入有效電郵地址。" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "密碼至少 8 個字元。" });
  }

  const users = await readJson(USERS_FILE, []);
  if (users.some((user) => user.email === email)) {
    return res.status(409).json({ error: "此電郵已被註冊。" });
  }

  const newUser = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  await writeJson(USERS_FILE, users);

  const token = createSession(newUser.id);
  return res.status(201).json({
    token,
    user: safeUser(newUser),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "請輸入電郵及密碼。" });
  }

  const users = await readJson(USERS_FILE, []);
  const user = users.find((entry) => entry.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "帳號或密碼不正確。" });
  }

  const token = createSession(user.id);
  return res.json({
    token,
    user: safeUser(user),
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  return res.json({
    user: safeUser(req.user),
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  sessions.delete(req.authToken);
  return res.json({ ok: true });
});

app.post("/api/lawyers/:lawyerId/reviews", requireAuth, async (req, res) => {
  const { lawyerId } = req.params;
  const rating = Number.parseInt(String(req.body?.rating || "0"), 10);
  const comment = String(req.body?.comment || "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "評分必須為 1 至 5。" });
  }

  if (comment.length < 10) {
    return res.status(400).json({ error: "評論內容至少 10 個字。" });
  }

  if (comment.length > 1200) {
    return res.status(400).json({ error: "評論內容不可超過 1200 字。" });
  }

  const lawyers = await readJson(LAWYERS_FILE, []);
  const lawyerExists = lawyers.some((lawyer) => lawyer.id === lawyerId);
  if (!lawyerExists) {
    return res.status(404).json({ error: "找不到指定律師。" });
  }

  const reviews = await readJson(REVIEWS_FILE, []);
  const existingReview = reviews.find(
    (review) => review.lawyerId === lawyerId && review.userId === req.user.id,
  );

  if (existingReview) {
    existingReview.rating = rating;
    existingReview.comment = comment;
    existingReview.updatedAt = new Date().toISOString();
  } else {
    reviews.push({
      id: crypto.randomUUID(),
      lawyerId,
      userId: req.user.id,
      userName: req.user.name,
      rating,
      comment,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await writeJson(REVIEWS_FILE, reviews);
  return res.status(201).json({ ok: true });
});

app.post("/api/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const history = normalizeHistory(req.body?.history);

  if (!question) {
    return res.status(400).json({
      error: "請輸入法律問題。",
    });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      error: `問題過長，請限制在 ${MAX_QUESTION_LENGTH} 字內。`,
    });
  }

  if (!openai) {
    return res.json({
      answer: fallbackMessage(),
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: createSystemPrompt(),
        },
        ...history,
        {
          role: "user",
          content: question,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(502).json({
        error: "AI 未返回有效內容，請稍後再試。",
      });
    }

    return res.json({ answer });
  } catch (error) {
    console.error("AI request failed:", error);
    return res.status(500).json({
      error: "AI 服務暫時不可用，請稍後再試。",
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (process.argv[1] === __filename) {
  app.listen(PORT, () => {
    console.log(`香港法律 AI 網站已啟動：http://localhost:${PORT}`);
  });
}

export { app };
