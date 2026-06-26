const TOKEN_KEY = "seedance_client_token";
const CLIENT_KEY = "seedance_client";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  client: null,
  packages: [],
  loginRequested: false,
};

const form = document.getElementById("video-form");
const generateButton = document.getElementById("generate-button");
const generateButtonLabel = generateButton.querySelector(".button-label");
const promptLoginPanel = document.getElementById("prompt-login-panel");
const statusText = document.getElementById("status-text");
const taskIdText = document.getElementById("task-id");
const resultCard = document.getElementById("result-card");
const resultVideo = document.getElementById("result-video");
const downloadLink = document.getElementById("download-link");
const openLink = document.getElementById("open-link");
const authStatus = document.getElementById("auth-status");
const creditBalance = document.getElementById("credit-balance");
const accountSection = document.getElementById("account");
const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const logoutButton = document.getElementById("logout-button");
const purchaseCard = document.getElementById("purchase-card");
const purchaseForm = document.getElementById("purchase-form");
const packageSelect = document.getElementById("package-select");
const packageDetails = document.getElementById("package-details");
const purchaseButton = document.getElementById("purchase-button");

const cachedClientRaw = localStorage.getItem(CLIENT_KEY);
if (cachedClientRaw) {
  try {
    state.client = JSON.parse(cachedClientRaw);
  } catch {
    state.client = null;
  }
}

function updateClient(client) {
  state.client = client;
  if (client) {
    localStorage.setItem(CLIENT_KEY, JSON.stringify(client));
  } else {
    localStorage.removeItem(CLIENT_KEY);
  }
  updateAuthUi();
}

function setSession(token, client) {
  state.token = token;
  localStorage.setItem(TOKEN_KEY, token);
  updateClient(client);
}

function clearSession() {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  updateClient(null);
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#fda4af" : "#cbd5e1";
}

function setGenerating(isGenerating) {
  generateButton.disabled = isGenerating;
  generateButton.classList.toggle("is-loading", isGenerating);
  generateButton.setAttribute("aria-busy", String(isGenerating));
  generateButtonLabel.textContent = isGenerating ? "Generating video..." : "Generate video";
}

function tryPlayVideo(video) {
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Browser autoplay policies can still block playback; controls remain visible.
    });
  }
}

function initAutoplayVideos() {
  document.querySelectorAll("video[autoplay]").forEach((video) => {
    video.muted = true;
    video.playsInline = true;
    tryPlayVideo(video);
  });
}

function updateAuthUi() {
  if (state.client) {
    authStatus.textContent = `Logged in as ${state.client.name} (${state.client.email}).`;
    creditBalance.textContent = String(state.client.credits || 0);
    accountSection.classList.remove("hidden");
    promptLoginPanel.classList.add("hidden");
    form.classList.remove("hidden");
    logoutButton.classList.remove("hidden");
    registerForm.classList.add("hidden");
    loginForm.classList.add("hidden");
    purchaseCard.classList.remove("hidden");
  } else {
    authStatus.textContent = "Create an account or log in to generate videos.";
    creditBalance.textContent = "0";
    accountSection.classList.toggle("hidden", !state.loginRequested);
    promptLoginPanel.classList.remove("hidden");
    form.classList.add("hidden");
    logoutButton.classList.add("hidden");
    registerForm.classList.remove("hidden");
    loginForm.classList.remove("hidden");
    purchaseCard.classList.add("hidden");
  }
}

function revealLoginArea({ scroll = true } = {}) {
  state.loginRequested = true;
  updateAuthUi();
  if (scroll) {
    accountSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function apiFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || "Request failed.");
  }

  return payload;
}

function renderPackages(packages) {
  packageSelect.innerHTML = "";

  for (const creditPackage of packages) {
    const option = document.createElement("option");
    option.value = creditPackage.id;
    option.textContent = `${creditPackage.name} - ${creditPackage.credits} credits (${creditPackage.priceLabel})`;
    packageSelect.appendChild(option);
  }

  updatePackageDetails();
}

function updatePackageDetails() {
  const selectedPackage = state.packages.find((entry) => entry.id === packageSelect.value);
  if (!selectedPackage) {
    packageDetails.textContent = "Select a package to see details.";
    return;
  }

  packageDetails.innerHTML = `<strong>${selectedPackage.credits} credits</strong> for ${selectedPackage.priceLabel}. ${selectedPackage.description}`;
}

async function loadPackages() {
  const payload = await apiFetch("/api/credits/packages");
  state.packages = payload.packages || [];
  renderPackages(state.packages);
}

async function restoreSession() {
  if (!state.token) {
    clearSession();
    return;
  }

  updateAuthUi();
  try {
    const payload = await apiFetch("/api/auth/me");
    updateClient(payload.client);
  } catch {
    clearSession();
  }
}

function resetResult() {
  resultCard.classList.add("hidden");
  taskIdText.textContent = "";
  resultVideo.removeAttribute("src");
  resultVideo.load();
  downloadLink.setAttribute("href", "#");
  openLink.setAttribute("href", "#");
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(registerForm);

  try {
    const payload = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    setSession(payload.token, payload.client);
    registerForm.reset();
    setStatus("Account created. Buy credits to start generating.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Registration failed.", true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    const payload = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    setSession(payload.token, payload.client);
    loginForm.reset();
    setStatus("Logged in. Your credits are ready to use.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Login failed.", true);
  }
});

document.querySelectorAll("[data-open-login]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    revealLoginArea();
  });
});

logoutButton.addEventListener("click", async () => {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Local logout should still work if the server session already expired.
  }
  clearSession();
  state.loginRequested = false;
  updateAuthUi();
  setStatus("Logged out.");
});

packageSelect.addEventListener("change", updatePackageDetails);

purchaseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.token) {
    setStatus("Please log in before buying credits.", true);
    revealLoginArea();
    return;
  }

  const formData = new FormData(purchaseForm);
  purchaseButton.disabled = true;
  purchaseButton.textContent = "Processing card...";

  try {
    const payload = await apiFetch("/api/credits/purchase", {
      method: "POST",
      body: JSON.stringify({
        packageId: formData.get("packageId"),
        card: {
          cardholderName: formData.get("cardholderName"),
          cardNumber: formData.get("cardNumber"),
          expiry: formData.get("expiry"),
          cvc: formData.get("cvc"),
          postalCode: formData.get("postalCode"),
        },
      }),
    });

    updateClient(payload.client);
    purchaseForm.reset();
    renderPackages(state.packages);
    setStatus(
      `Purchased ${payload.transaction.credits} credits with ${payload.transaction.cardBrand} ending in ${payload.transaction.cardLast4}.`,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Credit purchase failed.", true);
  } finally {
    purchaseButton.disabled = false;
    purchaseButton.textContent = "Buy credits";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetResult();

  if (!state.token) {
    setStatus("Please log in and buy credits before generating a video.", true);
    revealLoginArea();
    return;
  }

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

  setGenerating(true);
  setStatus("Submitting request... video generation can take a while.");

  try {
    const payload = await apiFetch("/api/videos/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
      }),
    });

    if (!payload.videoUrl || !payload.downloadUrl) {
      throw new Error("Generation finished but video URLs were missing.");
    }

    setStatus(payload.notice || "Video generated successfully.");
    if (Number.isFinite(payload.creditsRemaining)) {
      updateClient({
        ...state.client,
        credits: payload.creditsRemaining,
      });
    }
    taskIdText.textContent = payload.taskId ? `Task ID: ${payload.taskId}` : "";
    resultCard.classList.remove("hidden");

    resultVideo.src = payload.videoUrl;
    resultVideo.muted = true;
    resultVideo.autoplay = true;
    resultVideo.load();
    resultVideo.addEventListener("loadedmetadata", () => tryPlayVideo(resultVideo), { once: true });

    downloadLink.href = payload.downloadUrl;
    openLink.href = payload.videoUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected generation error.";
    setStatus(message, true);
  } finally {
    setGenerating(false);
  }
});

restoreSession()
  .then(loadPackages)
  .then(initAutoplayVideos)
  .catch((error) => {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Unable to initialize account features.", true);
  });
