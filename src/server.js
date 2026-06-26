import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const dataDir = path.join(__dirname, "..", "data");
const clientsFile = path.join(dataDir, "clients.json");
const creditTransactionsFile = path.join(dataDir, "credit-transactions.json");

const SEEDANCE_API_KEY = String(process.env.SEEDANCE_API_KEY || "").trim();
const SEEDANCE_BASE_URL = String(process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com")
  .trim()
  .replace(/\/+$/, "");
const SEEDANCE_MODEL = String(process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-fast-260128").trim();
const SEEDANCE_TIMEOUT_MS = Number(process.env.SEEDANCE_TIMEOUT_MS) || 5 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS) || 3000;

const SUCCESS_STATES = new Set(["succeeded", "success", "completed", "done"]);
const FAILED_STATES = new Set(["failed", "error", "cancelled", "canceled"]);
const GENERATION_CREDIT_COST = 1;
const CREDIT_PACKAGES = Object.freeze([
  {
    id: "starter",
    name: "Starter Pack",
    credits: 7500,
    amountCents: 1999,
    currency: "USD",
    description: "Entry top-up pack with credits valid for 3 years.",
  },
  {
    id: "growth",
    name: "Growth Pack",
    credits: 13800,
    amountCents: 3699,
    currency: "USD",
    description: "Best value top-up pack for active creators.",
  },
  {
    id: "premium",
    name: "Premium Pack",
    credits: 37500,
    amountCents: 9999,
    currency: "USD",
    description: "Large top-up pack for frequent video generation.",
  },
]);
const sessions = new Map();
const storageReady = initializeStorage();

app.use(express.json());
app.use(express.static(publicDir));
app.use(async (_req, _res, next) => {
  try {
    await storageReady;
    next();
  } catch (error) {
    next(error);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initializeStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJsonFile(clientsFile, []);
  await ensureJsonFile(creditTransactionsFile, []);
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

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function safeClient(client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    credits: Number(client.credits || 0),
    createdAt: client.createdAt,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, hash] = String(passwordHash || "").split(":");
  if (!salt || !hash) {
    return false;
  }

  try {
    const attemptedHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attemptedHash, "hex"));
  } catch {
    return false;
  }
}

function createSession(clientId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    clientId,
    createdAt: Date.now(),
  });
  return token;
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "");
  if (!header.startsWith("Bearer ")) {
    return "";
  }
  return header.slice("Bearer ".length).trim();
}

async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Please log in before continuing." });
  }

  const session = sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }

  const clients = await readJson(clientsFile, []);
  const client = clients.find((entry) => entry.id === session.clientId);
  if (!client) {
    sessions.delete(token);
    return res.status(401).json({ error: "Account not found. Please log in again." });
  }

  req.authToken = token;
  req.client = client;
  return next();
}

function toCurrency(amountCents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function serializeCreditPackage(creditPackage) {
  return {
    ...creditPackage,
    priceLabel: toCurrency(creditPackage.amountCents, creditPackage.currency),
  };
}

function detectCardBrand(cardNumber) {
  if (/^4/.test(cardNumber)) {
    return "Visa";
  }
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) {
    return "Mastercard";
  }
  if (/^3[47]/.test(cardNumber)) {
    return "American Express";
  }
  if (/^6(?:011|5)/.test(cardNumber)) {
    return "Discover";
  }
  return "Card";
}

function passesLuhnCheck(cardNumber) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = cardNumber.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardNumber[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function parseExpiry(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1], 10);
  const yearRaw = Number.parseInt(match[2], 10);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  if (month < 1 || month > 12) {
    return null;
  }

  return { month, year };
}

function expiryIsFuture(expiry) {
  const now = new Date();
  const expiryBoundary = new Date(expiry.year, expiry.month, 1);
  return expiryBoundary > new Date(now.getFullYear(), now.getMonth(), 1);
}

function validateCardPayment(card) {
  const cardholderName = String(card?.cardholderName || "").trim();
  const cardNumber = String(card?.cardNumber || "").replace(/\D/g, "");
  const expiry = parseExpiry(card?.expiry);
  const cvc = String(card?.cvc || "").replace(/\D/g, "");
  const postalCode = String(card?.postalCode || "").trim();

  if (cardholderName.length < 2) {
    throw new Error("Cardholder name is required.");
  }
  if (cardNumber.length < 12 || cardNumber.length > 19 || !passesLuhnCheck(cardNumber)) {
    throw new Error("Please enter a valid credit card number.");
  }
  if (!expiry || !expiryIsFuture(expiry)) {
    throw new Error("Please enter a valid future expiry date.");
  }
  if (cvc.length < 3 || cvc.length > 4) {
    throw new Error("Please enter a valid card security code.");
  }
  if (postalCode.length < 3) {
    throw new Error("Billing postal code is required.");
  }

  return {
    brand: detectCardBrand(cardNumber),
    last4: cardNumber.slice(-4),
  };
}

function findCreditPackage(packageId) {
  return CREDIT_PACKAGES.find((entry) => entry.id === packageId);
}

function extractTaskId(payload) {
  return firstNonEmptyString(
    payload?.id,
    payload?.task_id,
    payload?.taskId,
    payload?.data?.id,
    payload?.data?.task_id,
    payload?.data?.taskId,
    payload?.result?.id,
    payload?.result?.task_id,
    payload?.output?.task_id,
  );
}

function extractStatus(payload) {
  return firstNonEmptyString(
    payload?.status,
    payload?.task_status,
    payload?.state,
    payload?.data?.status,
    payload?.data?.task_status,
    payload?.result?.status,
    payload?.output?.status,
  ).toLowerCase();
}

function extractVideoUrl(payload) {
  return firstNonEmptyString(
    payload?.content?.video_url,
    payload?.content?.videoUrl,
    payload?.video_url,
    payload?.videoUrl,
    payload?.data?.content?.video_url,
    payload?.data?.content?.videoUrl,
    payload?.data?.video_url,
    payload?.data?.videoUrl,
    payload?.output?.video_url,
    payload?.result?.video_url,
    payload?.content?.video?.url,
    payload?.data?.content?.video?.url,
  );
}

function extractErrorMessage(payload) {
  return firstNonEmptyString(
    payload?.error?.message,
    payload?.error?.msg,
    payload?.message,
    payload?.msg,
    payload?.data?.message,
    payload?.data?.msg,
  );
}

function normalizeStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (SUCCESS_STATES.has(normalized)) {
    return "success";
  }
  if (FAILED_STATES.has(normalized)) {
    return "failed";
  }
  if (!normalized) {
    return "unknown";
  }
  return "running";
}

async function callSeedanceApi(method, endpoint, body) {
  const url = `${SEEDANCE_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${SEEDANCE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const providerMessage = extractErrorMessage(payload);
    throw new Error(
      providerMessage
        ? `Seedance request failed (${response.status}): ${providerMessage}`
        : `Seedance request failed with status ${response.status}.`,
    );
  }

  return payload;
}

function buildCreatePayloads({ prompt, duration, resolution, aspectRatio, generateAudio }) {
  const shared = {
    model: SEEDANCE_MODEL,
    resolution,
    ratio: aspectRatio,
    duration,
    generate_audio: generateAudio,
  };

  return [
    {
      ...shared,
      content: [{ type: "text", text: prompt }],
    },
    {
      ...shared,
      prompt,
    },
    {
      model: SEEDANCE_MODEL,
      input: {
        prompt,
        resolution,
        aspect_ratio: aspectRatio,
        duration: String(duration),
        generate_audio: generateAudio,
      },
    },
  ];
}

async function createGenerationTask(options) {
  const payloads = buildCreatePayloads(options);
  let lastError = null;

  for (const payload of payloads) {
    try {
      const response = await callSeedanceApi("POST", "/api/v3/contents/generations/tasks", payload);
      const taskId = extractTaskId(response);
      if (taskId) {
        return { taskId, providerResponse: response };
      }
      lastError = new Error("Task created but task ID was missing in provider response.");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to create Seedance task.");
}

async function waitForTaskCompletion(taskId) {
  const deadline = Date.now() + SEEDANCE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await callSeedanceApi(
      "GET",
      `/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    );
    const status = normalizeStatus(extractStatus(response));
    const videoUrl = extractVideoUrl(response);

    if (status === "success") {
      if (!videoUrl) {
        throw new Error("Seedance task succeeded but no video URL was returned.");
      }
      return { taskId, videoUrl, providerResponse: response };
    }

    if (status === "failed") {
      const providerMessage = extractErrorMessage(response);
      throw new Error(providerMessage || "Seedance task failed.");
    }

    if (videoUrl) {
      return { taskId, videoUrl, providerResponse: response };
    }

    await sleep(SEEDANCE_POLL_INTERVAL_MS);
  }

  throw new Error("Seedance task timed out before completion.");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "new-project",
    model: SEEDANCE_MODEL,
    apiConfigured: Boolean(SEEDANCE_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({ client: safeClient(req.client) });
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const clients = await readJson(clientsFile, []);
  if (clients.some((client) => client.email === email)) {
    return res.status(409).json({ error: "An account already exists for this email." });
  }

  const client = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    credits: 0,
    createdAt: new Date().toISOString(),
  };

  clients.push(client);
  await writeJson(clientsFile, clients);

  const token = createSession(client.id);
  return res.status(201).json({
    token,
    client: safeClient(client),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const clients = await readJson(clientsFile, []);
  const client = clients.find((entry) => entry.email === email);
  if (!client || !verifyPassword(password, client.passwordHash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  const token = createSession(client.id);
  return res.json({
    token,
    client: safeClient(client),
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  sessions.delete(req.authToken);
  return res.json({ ok: true });
});

app.get("/api/credits/packages", (_req, res) => {
  return res.json({ packages: CREDIT_PACKAGES.map(serializeCreditPackage) });
});

app.post("/api/credits/purchase", requireAuth, async (req, res) => {
  const packageId = String(req.body?.packageId || "").trim();
  const selectedPackage = findCreditPackage(packageId);
  if (!selectedPackage) {
    return res.status(400).json({ error: "Please select a valid credit package." });
  }

  let payment;
  try {
    payment = validateCardPayment(req.body?.card);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Card payment details are invalid.",
    });
  }

  const clients = await readJson(clientsFile, []);
  const clientIndex = clients.findIndex((client) => client.id === req.client.id);
  if (clientIndex === -1) {
    sessions.delete(req.authToken);
    return res.status(401).json({ error: "Account not found. Please log in again." });
  }

  clients[clientIndex].credits = Number(clients[clientIndex].credits || 0) + selectedPackage.credits;
  await writeJson(clientsFile, clients);

  const transaction = {
    id: crypto.randomUUID(),
    clientId: req.client.id,
    packageId: selectedPackage.id,
    packageName: selectedPackage.name,
    credits: selectedPackage.credits,
    amountCents: selectedPackage.amountCents,
    currency: selectedPackage.currency,
    cardBrand: payment.brand,
    cardLast4: payment.last4,
    status: "succeeded",
    createdAt: new Date().toISOString(),
  };

  const transactions = await readJson(creditTransactionsFile, []);
  transactions.push(transaction);
  await writeJson(creditTransactionsFile, transactions);

  return res.status(201).json({
    client: safeClient(clients[clientIndex]),
    transaction: {
      id: transaction.id,
      packageName: transaction.packageName,
      credits: transaction.credits,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      priceLabel: toCurrency(transaction.amountCents, transaction.currency),
      cardBrand: transaction.cardBrand,
      cardLast4: transaction.cardLast4,
      createdAt: transaction.createdAt,
    },
  });
});

app.post("/api/videos/generate", requireAuth, async (req, res) => {
  if (!SEEDANCE_API_KEY) {
    return res.status(500).json({
      error: "Server is missing SEEDANCE_API_KEY. Add it to your .env file.",
    });
  }

  const prompt = String(req.body?.prompt || "").trim();
  const resolution = String(req.body?.resolution || "720p").trim();
  const aspectRatio = String(req.body?.aspectRatio || "16:9").trim();
  const duration = Number.parseInt(String(req.body?.duration || "5"), 10);
  const generateAudio = Boolean(req.body?.generateAudio);

  if (prompt.length < 3) {
    return res.status(400).json({ error: "Prompt must be at least 3 characters." });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({ error: "Prompt is too long (max: 2000 characters)." });
  }

  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    return res.status(400).json({ error: "Duration must be an integer between 4 and 15 seconds." });
  }

  if (Number(req.client.credits || 0) < GENERATION_CREDIT_COST) {
    return res.status(402).json({
      error: "You need at least 1 credit to generate a video. Please buy credits first.",
    });
  }

  try {
    const { taskId } = await createGenerationTask({
      prompt,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
    });

    const { videoUrl } = await waitForTaskCompletion(taskId);
    const safeFilename = `${taskId}.mp4`;
    const clients = await readJson(clientsFile, []);
    const clientIndex = clients.findIndex((client) => client.id === req.client.id);
    if (clientIndex === -1) {
      sessions.delete(req.authToken);
      return res.status(401).json({ error: "Account not found. Please log in again." });
    }
    if (Number(clients[clientIndex].credits || 0) < GENERATION_CREDIT_COST) {
      return res.status(402).json({
        error: "Your credit balance changed. Please buy credits before generating again.",
      });
    }

    clients[clientIndex].credits = Number(clients[clientIndex].credits || 0) - GENERATION_CREDIT_COST;
    await writeJson(clientsFile, clients);

    return res.status(201).json({
      taskId,
      videoUrl,
      downloadUrl: `/api/videos/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFilename)}`,
      creditsRemaining: Number(clients[clientIndex].credits || 0),
    });
  } catch (error) {
    console.error("Seedance generation error:", error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Video generation failed.",
    });
  }
});

app.get("/api/videos/download", async (req, res) => {
  const urlParam = String(req.query.url || "").trim();
  const filename = String(req.query.filename || "seedance-video.mp4")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  if (!urlParam) {
    return res.status(400).json({ error: "Missing url query parameter." });
  }

  let downloadUrl;
  try {
    downloadUrl = new URL(urlParam);
  } catch {
    return res.status(400).json({ error: "Invalid video URL." });
  }

  if (downloadUrl.protocol !== "http:" && downloadUrl.protocol !== "https:") {
    return res.status(400).json({ error: "Only http/https URLs are supported." });
  }

  try {
    const upstream = await fetch(downloadUrl.toString());
    if (!upstream.ok) {
      return res.status(502).json({
        error: `Video download failed with status ${upstream.status}.`,
      });
    }

    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const content = await upstream.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(Buffer.from(content));
  } catch (error) {
    console.error("Video proxy download error:", error);
    return res.status(500).json({ error: "Unable to download video file." });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
