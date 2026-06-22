import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const SEEDANCE_API_KEY = String(process.env.SEEDANCE_API_KEY || "").trim();
const SEEDANCE_BASE_URL = String(process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com")
  .trim()
  .replace(/\/+$/, "");
const SEEDANCE_MODEL = String(process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-fast-260128").trim();
const SEEDANCE_TIMEOUT_MS = Number(process.env.SEEDANCE_TIMEOUT_MS) || 5 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = Number(process.env.SEEDANCE_POLL_INTERVAL_MS) || 3000;

const SUCCESS_STATES = new Set(["succeeded", "success", "completed", "done"]);
const FAILED_STATES = new Set(["failed", "error", "cancelled", "canceled"]);

app.use(express.json());
app.use(express.static(publicDir));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
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

app.post("/api/videos/generate", async (req, res) => {
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

    return res.status(201).json({
      taskId,
      videoUrl,
      downloadUrl: `/api/videos/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFilename)}`,
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
