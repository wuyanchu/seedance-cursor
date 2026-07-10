const form = document.getElementById("video-form");
const generateButton = document.getElementById("generate-button");
const statusText = document.getElementById("status-text");
const taskIdText = document.getElementById("task-id");
const resultCard = document.getElementById("result-card");
const resultVideo = document.getElementById("result-video");
const downloadLink = document.getElementById("download-link");
const openLink = document.getElementById("open-link");
const GOOGLE_ADS_CONVERSION_SEND_TO = "AW-1001888846/NWDHCNnR58scEM643t0D";

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#fda4af" : "#cbd5e1";
}

function trackGoogleAdsConversion(value, currency) {
  if (typeof window.gtag !== "function") {
    return;
  }
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) && numericValue > 0 ? Number(numericValue.toFixed(2)) : 1.0;
  const safeCurrency = String(currency || "HKD").trim().toUpperCase() || "HKD";

  window.gtag("event", "conversion", {
    send_to: GOOGLE_ADS_CONVERSION_SEND_TO,
    value: safeValue,
    currency: safeCurrency,
  });
}

function resetResult() {
  resultCard.classList.add("hidden");
  taskIdText.textContent = "";
  resultVideo.removeAttribute("src");
  resultVideo.load();
  downloadLink.setAttribute("href", "#");
  openLink.setAttribute("href", "#");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetResult();

  const formData = new FormData(form);
  const prompt = String(formData.get("prompt") || "").trim();
  const duration = Number.parseInt(String(formData.get("duration") || "5"), 10);
  const resolution = String(formData.get("resolution") || "720p");
  const aspectRatio = String(formData.get("aspectRatio") || "16:9");
  const generateAudio = formData.get("generateAudio") === "on";

  if (prompt.length < 3) {
    setStatus("Please provide a longer prompt (at least 3 characters).", true);
    return;
  }

  generateButton.disabled = true;
  setStatus("Submitting request... video generation can take a while.");

  try {
    const response = await fetch("/api/videos/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Generation request failed.");
    }

    if (!payload.videoUrl || !payload.downloadUrl) {
      throw new Error("Generation finished but video URLs were missing.");
    }

    setStatus("Video generated successfully.");
    taskIdText.textContent = payload.taskId ? `Task ID: ${payload.taskId}` : "";
    resultCard.classList.remove("hidden");

    resultVideo.src = payload.videoUrl;
    resultVideo.load();

    downloadLink.href = payload.downloadUrl;
    openLink.href = payload.videoUrl;
    const conversionValue = Number(payload?.value ?? payload?.amount ?? payload?.price ?? duration) || 1.0;
    const conversionCurrency = payload?.currency || "HKD";
    trackGoogleAdsConversion(conversionValue, conversionCurrency);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected generation error.";
    setStatus(message, true);
  } finally {
    generateButton.disabled = false;
  }
});
