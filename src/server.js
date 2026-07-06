import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
app.set("trust proxy", true);
const port = Number(process.env.PORT) || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const dataDir = path.resolve(String(process.env.DATA_DIR || path.join(__dirname, "..", "data")).trim());
const clientsFile = path.join(dataDir, "clients.json");
const creditTransactionsFile = path.join(dataDir, "credit-transactions.json");

const SEEDANCE_API_KEY = String(process.env.SEEDANCE_API_KEY || "").trim();
const SEEDANCE_BASE_URL = String(process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com")
  .trim()
  .replace(/\/+$/, "");
const SEEDANCE_MODEL = String(process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-fast-260128").trim();
const SEEDANCE_TIMEOUT_MS = Number(process.env.SEEDANCE_TIMEOUT_MS) || 5 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS) || 3000;
const PAYPAL_CLIENT_ID = String(process.env.PAYPAL_CLIENT_ID || "").trim();
const PAYPAL_CLIENT_SECRET = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
const PAYPAL_ENV = String(process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const PAYPAL_API_BASE_URL = String(
  process.env.PAYPAL_API_BASE_URL ||
    (PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"),
)
  .trim()
  .replace(/\/+$/, "");
const AUTH_TOKEN_SECRET = String(
  process.env.AUTH_TOKEN_SECRET || process.env.PAYPAL_CLIENT_SECRET || process.env.SEEDANCE_API_KEY || "seedance-default-auth-secret",
).trim();
const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS) || 30 * 24 * 60 * 60 * 1000;
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

const SUCCESS_STATES = new Set(["succeeded", "success", "completed", "done"]);
const FAILED_STATES = new Set(["failed", "error", "cancelled", "canceled"]);
const INITIAL_MEMBER_CREDITS = 100;
const BASE_GENERATION_CREDIT_COST = 300;
const DURATION_CREDIT_COSTS = Object.freeze({
  8: 800,
  10: 1000,
  12: 1200,
  15: 1500,
});
const HD_RESOLUTION_CREDIT_SURCHARGE = 300;
const GENERATE_AUDIO_CREDIT_SURCHARGE = 200;
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
const DEMO_VIDEO_URLS = Object.freeze([
  "https://static.seedancev2.ai/uploads/videos/seedance2-page-03-stadium-template.mp4",
  "https://static.seedancev2.ai/uploads/videos/seedance2-page-07-london-street-lady.mp4",
  "https://static.seedancev2.ai/uploads/videos/seedance2-page-02-rain-dance-template.mp4",
  "https://static.seedancev2.ai/uploads/videos/seedance2-hero-1.mp4",
]);
const SITEMAP_GROUPS = Object.freeze({
  main: Object.freeze([
    {
      path: "/",
      changefreq: "daily",
      priority: "1.0",
      alternates: Object.freeze([
        { hreflang: "en", path: "/" },
        { hreflang: "zh-Hant", path: "/lawyers.html" },
        { hreflang: "x-default", path: "/" },
      ]),
    },
  ]),
  directory: Object.freeze([
    {
      path: "/lawyers.html",
      changefreq: "weekly",
      priority: "0.6",
      alternates: Object.freeze([
        { hreflang: "zh-Hant", path: "/lawyers.html" },
        { hreflang: "en", path: "/" },
        { hreflang: "x-default", path: "/" },
      ]),
    },
  ]),
});
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

function deriveClientName(rawName, email) {
  const providedName = String(rawName || "").trim();
  if (providedName) {
    return providedName;
  }

  const emailLocalPart = String(email || "").split("@")[0] || "";
  const candidate = emailLocalPart.replace(/[._-]+/g, " ").trim();
  return candidate || "Creator";
}

function parseCredits(value) {
  const credits = Number(value);
  if (!Number.isFinite(credits) || credits < 0) {
    return 0;
  }
  return credits;
}

function calculateGenerationCreditCost(duration, resolution, generateAudio) {
  const durationCost = DURATION_CREDIT_COSTS[Number(duration)] || BASE_GENERATION_CREDIT_COST;
  const resolutionSurcharge = String(resolution || "").trim().toLowerCase() === "1080p" ? HD_RESOLUTION_CREDIT_SURCHARGE : 0;
  const audioSurcharge = generateAudio ? GENERATE_AUDIO_CREDIT_SURCHARGE : 0;
  return durationCost + resolutionSurcharge + audioSurcharge;
}

async function ensureInitialCreditsForClient(clients, clientIndex) {
  const client = clients[clientIndex];
  if (!client) {
    return null;
  }

  if (client.initialCreditsGranted) {
    return client;
  }

  const upgradedClient = {
    ...client,
    credits: Math.max(parseCredits(client.credits), INITIAL_MEMBER_CREDITS),
    initialCreditsGranted: true,
  };
  clients[clientIndex] = upgradedClient;
  await writeJson(clientsFile, clients);
  return upgradedClient;
}

function safeClient(client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    credits: parseCredits(client.credits),
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
  const payload = {
    clientId,
    expiresAt: Date.now() + AUTH_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  const [encodedPayload, providedSignature] = String(token || "").split(".");
  if (!encodedPayload || !providedSignature) {
    return "";
  }

  const expectedSignature = crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(encodedPayload).digest("base64url");
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return "";
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return "";
  }

  if (!payload || typeof payload.clientId !== "string" || !payload.clientId.trim()) {
    return "";
  }

  const expiresAt = Number(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return "";
  }

  return payload.clientId;
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

  const clientId = verifySessionToken(token);
  if (!clientId) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }

  const clients = await readJson(clientsFile, []);
  const clientIndex = clients.findIndex((entry) => entry.id === clientId);
  if (clientIndex === -1) {
    return res.status(401).json({ error: "Account not found. Please log in again." });
  }

  const client = await ensureInitialCreditsForClient(clients, clientIndex);
  req.authClient = client;
  return next();
}

async function optionalAuth(req, _res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return next();
  }

  const clientId = verifySessionToken(token);
  if (!clientId) {
    return next();
  }

  const clients = await readJson(clientsFile, []);
  const clientIndex = clients.findIndex((entry) => entry.id === clientId);
  if (clientIndex === -1) {
    return next();
  }

  const client = await ensureInitialCreditsForClient(clients, clientIndex);
  req.authClient = client;
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

  return {
    brand: detectCardBrand(cardNumber),
    last4: cardNumber.slice(-4),
  };
}

function findCreditPackage(packageId) {
  return CREDIT_PACKAGES.find((entry) => entry.id === packageId);
}

function isGoogleAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID);
}

function isPayPalConfigured() {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

function amountLabel(amountCents) {
  return (amountCents / 100).toFixed(2);
}

function toIsoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getRequestBaseUrl(req) {
  if (PUBLIC_SITE_URL) {
    return PUBLIC_SITE_URL;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").trim() || "localhost";
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function toAbsoluteUrl(baseUrl, pathname) {
  return `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function buildSitemapIndexXml(baseUrl) {
  const generatedAt = toIsoDate();
  const entries = Object.keys(SITEMAP_GROUPS)
    .map((group) => {
      const loc = escapeXml(toAbsoluteUrl(baseUrl, `/sitemaps/${group}.xml`));
      return `  <sitemap>
    <loc>${loc}</loc>
    <lastmod>${generatedAt}</lastmod>
  </sitemap>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}

function buildSitemapGroupXml(baseUrl, pages) {
  const generatedAt = toIsoDate();
  const urlEntries = pages
    .map((entry) => {
      const loc = escapeXml(toAbsoluteUrl(baseUrl, entry.path));
      const alternates = Array.isArray(entry.alternates)
        ? entry.alternates
            .map((alternate) => {
              const href = escapeXml(toAbsoluteUrl(baseUrl, alternate.path));
              return `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${href}" />`;
            })
            .join("\n")
        : "";
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${generatedAt}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
${alternates}
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries}
</urlset>`;
}

async function verifyGoogleCredential(idToken) {
  const token = String(idToken || "").trim();
  if (!token) {
    throw new Error("Missing Google credential token.");
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Unable to verify Google credential.");
  }

  const issuer = String(payload.iss || "").trim();
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") {
    throw new Error("Google credential issuer is invalid.");
  }
  if (!payload?.email || String(payload.email_verified || "").toLowerCase() !== "true") {
    throw new Error("Google account email is not verified.");
  }
  if (GOOGLE_CLIENT_ID && String(payload.aud || "").trim() !== GOOGLE_CLIENT_ID) {
    throw new Error("Google credential does not match this app.");
  }

  const email = normalizeEmail(payload.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Google account email is invalid.");
  }
  const name = deriveClientName(payload.name || payload.given_name, email);
  const googleSub = String(payload.sub || "").trim();

  return { email, name, googleSub };
}

async function getPayPalAccessToken() {
  const response = await fetch(`${PAYPAL_API_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to authenticate with PayPal.");
  }

  return payload.access_token;
}

async function callPayPalApi(endpoint, { method = "GET", body } = {}) {
  if (!isPayPalConfigured()) {
    throw new Error("PayPal is not configured on this server.");
  }

  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.message || payload.error_description || payload.name || "PayPal request failed.";
    throw new Error(message);
  }

  return payload;
}

function extractPayPalCapture(orderPayload) {
  return orderPayload?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

function selectDemoVideoUrl(prompt) {
  const seed = Array.from(String(prompt || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return DEMO_VIDEO_URLS[seed % DEMO_VIDEO_URLS.length];
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

app.get("/robots.txt", (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  const robotsText = `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
  res.type("text/plain");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.send(robotsText);
});

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  const sitemap = buildSitemapIndexXml(baseUrl);
  res.type("application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.send(sitemap);
});

app.get("/sitemaps/:group.xml", (req, res) => {
  const group = String(req.params.group || "").trim();
  const pages = SITEMAP_GROUPS[group];
  if (!pages) {
    return res.status(404).type("text/plain").send("Sitemap group not found.");
  }

  const baseUrl = getRequestBaseUrl(req);
  const sitemap = buildSitemapGroupXml(baseUrl, pages);
  res.type("application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.send(sitemap);
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({ client: safeClient(req.authClient) });
});

app.post("/api/auth/register", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const name = deriveClientName(req.body?.name, email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
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
    credits: INITIAL_MEMBER_CREDITS,
    initialCreditsGranted: true,
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
  const clientIndex = clients.findIndex((entry) => entry.email === email);
  if (clientIndex === -1 || !verifyPassword(password, clients[clientIndex].passwordHash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  const client = await ensureInitialCreditsForClient(clients, clientIndex);
  const token = createSession(client.id);
  return res.json({
    token,
    client: safeClient(client),
  });
});

app.get("/api/auth/google/config", (_req, res) => {
  return res.json({
    configured: isGoogleAuthConfigured(),
    clientId: isGoogleAuthConfigured() ? GOOGLE_CLIENT_ID : "",
  });
});

app.post("/api/auth/google", async (req, res) => {
  if (!isGoogleAuthConfigured()) {
    return res.status(503).json({ error: "Google login is not configured on this server." });
  }

  let googleProfile;
  try {
    googleProfile = await verifyGoogleCredential(req.body?.credential);
  } catch (error) {
    return res.status(401).json({
      error: error instanceof Error ? error.message : "Google sign-in failed.",
    });
  }

  const clients = await readJson(clientsFile, []);
  const existingIndex = clients.findIndex((entry) => entry.email === googleProfile.email);
  let client;

  if (existingIndex === -1) {
    client = {
      id: crypto.randomUUID(),
      name: googleProfile.name,
      email: googleProfile.email,
      googleSub: googleProfile.googleSub,
      passwordHash: "",
      credits: INITIAL_MEMBER_CREDITS,
      initialCreditsGranted: true,
      createdAt: new Date().toISOString(),
    };
    clients.push(client);
    await writeJson(clientsFile, clients);
  } else {
    let didUpdate = false;
    const existing = clients[existingIndex];
    if (!String(existing.googleSub || "").trim() && googleProfile.googleSub) {
      existing.googleSub = googleProfile.googleSub;
      didUpdate = true;
    }
    if (!String(existing.name || "").trim()) {
      existing.name = googleProfile.name;
      didUpdate = true;
    }
    if (didUpdate) {
      await writeJson(clientsFile, clients);
    }
    client = await ensureInitialCreditsForClient(clients, existingIndex);
  }

  const token = createSession(client.id);
  return res.json({
    token,
    client: safeClient(client),
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  // Stateless auth tokens are invalidated client-side by clearing local storage.
  return res.json({ ok: true });
});

app.get("/api/credits/packages", (_req, res) => {
  return res.json({ packages: CREDIT_PACKAGES.map(serializeCreditPackage) });
});

app.get("/api/paypal/config", (_req, res) => {
  return res.json({
    configured: isPayPalConfigured(),
    clientId: isPayPalConfigured() ? PAYPAL_CLIENT_ID : "",
    currency: "USD",
    environment: PAYPAL_ENV === "live" ? "live" : "sandbox",
  });
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
  const clientIndex = clients.findIndex((client) => client.id === req.authClient.id);
  if (clientIndex === -1) {
    return res.status(401).json({ error: "Account not found. Please log in again." });
  }

  clients[clientIndex].credits = Number(clients[clientIndex].credits || 0) + selectedPackage.credits;
  await writeJson(clientsFile, clients);

  const transaction = {
    id: crypto.randomUUID(),
    clientId: req.authClient.id,
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

app.post("/api/paypal/orders", requireAuth, async (req, res) => {
  if (!isPayPalConfigured()) {
    return res.status(503).json({ error: "PayPal is not configured on this server." });
  }

  const packageId = String(req.body?.packageId || "").trim();
  const selectedPackage = findCreditPackage(packageId);
  if (!selectedPackage) {
    return res.status(400).json({ error: "Please select a valid credit package." });
  }

  try {
    const order = await callPayPalApi("/v2/checkout/orders", {
      method: "POST",
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: selectedPackage.id,
            custom_id: `${req.authClient.id}:${selectedPackage.id}`,
            description: `${selectedPackage.name} - ${selectedPackage.credits} credits`,
            amount: {
              currency_code: selectedPackage.currency,
              value: amountLabel(selectedPackage.amountCents),
            },
          },
        ],
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
    });

    return res.status(201).json({ id: order.id });
  } catch (error) {
    console.error("PayPal order create error:", error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to create PayPal order.",
    });
  }
});

app.post("/api/paypal/orders/:orderId/capture", requireAuth, async (req, res) => {
  if (!isPayPalConfigured()) {
    return res.status(503).json({ error: "PayPal is not configured on this server." });
  }

  const orderId = String(req.params.orderId || "").trim();
  if (!orderId) {
    return res.status(400).json({ error: "Missing PayPal order ID." });
  }

  try {
    const existingTransactions = await readJson(creditTransactionsFile, []);
    const existingTransaction = existingTransactions.find(
      (transaction) => transaction.provider === "paypal" && transaction.paypalOrderId === orderId,
    );
    if (existingTransaction) {
      const clients = await readJson(clientsFile, []);
      const client = clients.find((entry) => entry.id === req.authClient.id);
      return res.json({
        client: safeClient(client || req.authClient),
        transaction: existingTransaction,
      });
    }

    const capturedOrder = await callPayPalApi(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
    });
    const capture = extractPayPalCapture(capturedOrder);
    const packageId = String(capturedOrder?.purchase_units?.[0]?.reference_id || req.body?.packageId || "").trim();
    const selectedPackage = findCreditPackage(packageId);

    if (!selectedPackage) {
      return res.status(400).json({ error: "PayPal order did not include a valid credit package." });
    }
    if (capturedOrder.status !== "COMPLETED" && capture?.status !== "COMPLETED") {
      return res.status(402).json({ error: "PayPal payment was not completed." });
    }

    const paidCurrency = capture?.amount?.currency_code || capturedOrder?.purchase_units?.[0]?.amount?.currency_code;
    const paidCents = Math.round(Number(capture?.amount?.value || 0) * 100);
    if (paidCurrency !== selectedPackage.currency || paidCents !== selectedPackage.amountCents) {
      return res.status(400).json({ error: "PayPal payment amount did not match the selected package." });
    }

    const clients = await readJson(clientsFile, []);
    const clientIndex = clients.findIndex((client) => client.id === req.authClient.id);
    if (clientIndex === -1) {
      return res.status(401).json({ error: "Account not found. Please log in again." });
    }

    clients[clientIndex].credits = Number(clients[clientIndex].credits || 0) + selectedPackage.credits;
    await writeJson(clientsFile, clients);

    const transaction = {
      id: crypto.randomUUID(),
      provider: "paypal",
      clientId: req.authClient.id,
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      credits: selectedPackage.credits,
      amountCents: selectedPackage.amountCents,
      currency: selectedPackage.currency,
      paypalOrderId: orderId,
      paypalCaptureId: capture?.id || "",
      payerEmail: capturedOrder?.payer?.email_address || "",
      status: "succeeded",
      createdAt: new Date().toISOString(),
    };

    const transactions = await readJson(creditTransactionsFile, []);
    transactions.push(transaction);
    await writeJson(creditTransactionsFile, transactions);

    return res.status(201).json({
      client: safeClient(clients[clientIndex]),
      transaction: {
        ...transaction,
        priceLabel: toCurrency(transaction.amountCents, transaction.currency),
      },
    });
  } catch (error) {
    console.error("PayPal order capture error:", error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to capture PayPal payment.",
    });
  }
});

app.post("/api/videos/generate", optionalAuth, async (req, res) => {
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

  const creditsRequired = calculateGenerationCreditCost(duration, resolution, generateAudio);

  if (!SEEDANCE_API_KEY) {
    const taskId = `demo-${crypto.randomUUID()}`;
    const videoUrl = selectDemoVideoUrl(prompt);
    const safeFilename = `${taskId}.mp4`;

    return res.status(201).json({
      taskId,
      videoUrl,
      downloadUrl: `/api/videos/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFilename)}`,
      creditsRequired,
      creditsRemaining: req.authClient ? parseCredits(req.authClient.credits) : null,
      demo: true,
      notice:
        "Demo video returned because the server is missing SEEDANCE_API_KEY. Add the key to enable real Seedance generation.",
    });
  }

  let authClientContext = null;
  if (req.authClient) {
    const clients = await readJson(clientsFile, []);
    const clientIndex = clients.findIndex((client) => client.id === req.authClient.id);
    if (clientIndex === -1) {
      return res.status(401).json({ error: "Account not found. Please log in again." });
    }

    const currentCredits = parseCredits(clients[clientIndex].credits);
    if (currentCredits < creditsRequired) {
      return res.status(402).json({
        error: `Insufficient credit, you need ${creditsRequired} credit to generate but only have ${currentCredits}.`,
        creditsRequired,
        creditsRemaining: currentCredits,
      });
    }

    authClientContext = { clients, clientIndex };
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
    let creditsRemaining = null;

    if (authClientContext) {
      const { clients, clientIndex } = authClientContext;
      const currentCredits = parseCredits(clients[clientIndex].credits);
      clients[clientIndex].credits = Math.max(0, currentCredits - creditsRequired);
      await writeJson(clientsFile, clients);
      creditsRemaining = parseCredits(clients[clientIndex].credits);
    }

    return res.status(201).json({
      taskId,
      videoUrl,
      downloadUrl: `/api/videos/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFilename)}`,
      creditsRequired,
      creditsRemaining,
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
