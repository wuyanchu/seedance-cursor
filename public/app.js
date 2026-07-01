const TOKEN_KEY = "seedance_client_token";
const CLIENT_KEY = "seedance_client";
const BASE_GENERATION_CREDIT_COST = 300;
const DURATION_CREDIT_COSTS = Object.freeze({
  8: 800,
  10: 1000,
  12: 1200,
  15: 1500,
});
const HD_RESOLUTION_CREDIT_SURCHARGE = 300;
const EXTRA_GENERATION_CREDIT_COST = 200;
const DEFAULT_GUEST_CREDITS = 100;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  client: null,
  packages: [],
  loginRequested: false,
  creditFlowRequested: false,
};

const form = document.getElementById("video-form");
const generateButton = document.getElementById("generate-button");
const generateButtonLabel = generateButton.querySelector(".button-label");
const generatorPanel = document.getElementById("generator-panel");
const promptLoginPanel = document.getElementById("prompt-login-panel");
const generationCreditNote = document.querySelector(".generation-credit-note");
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
const creditModal = document.getElementById("credit-modal");
const creditModalMessage = document.getElementById("credit-modal-message");
const creditModalClose = document.getElementById("credit-modal-close");
const paypalStatus = document.getElementById("paypal-status");
const paypalButtons = document.getElementById("paypal-buttons");

const cachedClientRaw = localStorage.getItem(CLIENT_KEY);
if (cachedClientRaw) {
  try {
    state.client = JSON.parse(cachedClientRaw);
  } catch {
    state.client = null;
  }
}

function getClientDisplayName(client) {
  if (!client) {
    return "";
  }
  const name = String(client.name || "").trim();
  if (name) {
    return name;
  }
  return String(client.email || "").trim();
}

function setAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle("is-error", isError);
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

function getAvailableCredits() {
  if (state.client) {
    return Number(state.client.credits || 0);
  }
  return DEFAULT_GUEST_CREDITS;
}

function getGenerationCreditCost(duration, resolution) {
  const durationCost = DURATION_CREDIT_COSTS[Number(duration)] || BASE_GENERATION_CREDIT_COST;
  const resolutionSurcharge = String(resolution || "").trim().toLowerCase() === "1080p" ? HD_RESOLUTION_CREDIT_SURCHARGE : 0;
  return durationCost + resolutionSurcharge + EXTRA_GENERATION_CREDIT_COST;
}

function getSelectedGenerationCost() {
  if (!form) {
    return BASE_GENERATION_CREDIT_COST;
  }
  const durationField = form.querySelector('select[name="duration"]');
  const resolutionField = form.querySelector('select[name="resolution"]');
  const duration = Number.parseInt(durationField ? String(durationField.value || "5") : "5", 10);
  const resolution = resolutionField ? String(resolutionField.value || "720p") : "720p";
  return getGenerationCreditCost(duration, resolution);
}

function showCreditModal(requiredCredits, availableCredits) {
  creditModalMessage.textContent = `Insufficient credit, you need ${requiredCredits} credit to generate but only have ${availableCredits}.`;
  creditModal.classList.remove("hidden");
}

function hideCreditModal() {
  creditModal.classList.add("hidden");
}

function updateGenerationCreditNote() {
  if (!generationCreditNote) {
    return;
  }
  const requiredCredits = getSelectedGenerationCost();
  const value = generationCreditNote.querySelector("strong");
  const description = generationCreditNote.querySelector("span");
  if (value) {
    value.textContent = `${requiredCredits} credits`;
  }
  if (description) {
    description.textContent = "required for current settings";
  }
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
    setAuthStatus(`Logged in as ${getClientDisplayName(state.client)}.`);
    creditBalance.textContent = String(state.client.credits || 0);
    accountSection.classList.toggle("hidden", !state.loginRequested && !state.creditFlowRequested);
    promptLoginPanel.classList.add("hidden");
    form.classList.remove("hidden");
    logoutButton.classList.remove("hidden");
    registerForm.classList.add("hidden");
    loginForm.classList.add("hidden");
    purchaseCard.classList.toggle("hidden", !state.creditFlowRequested);
    if (generationCreditNote) {
      generationCreditNote.classList.add("hidden");
    }
  } else {
    setAuthStatus("Create an account or log in to generate videos.");
    creditBalance.textContent = "0";
    accountSection.classList.toggle("hidden", !state.loginRequested);
    promptLoginPanel.classList.add("hidden");
    form.classList.remove("hidden");
    logoutButton.classList.add("hidden");
    registerForm.classList.remove("hidden");
    loginForm.classList.remove("hidden");
    purchaseCard.classList.add("hidden");
    if (generationCreditNote) {
      generationCreditNote.classList.remove("hidden");
    }
  }
}

function clearStandaloneModes() {
  document.body.classList.remove("generator-active", "account-flow-active", "checkout-flow-active");
}

function scrollToElement(element, smooth = true) {
  if (!element) {
    return;
  }

  const supportsSmooth = typeof document.documentElement.style.scrollBehavior === "string";
  const behavior = smooth && supportsSmooth ? "smooth" : "auto";

  try {
    element.scrollIntoView({ behavior, block: "start" });
  } catch {
    // Older Safari versions may only support the boolean signature.
    element.scrollIntoView(true);
  }
}

function getHashTarget(targetHash, fallbackId = "generator") {
  if (typeof targetHash === "string" && targetHash.startsWith("#")) {
    const id = targetHash.slice(1);
    if (id) {
      const byId = document.getElementById(id);
      if (byId) {
        return byId;
      }
    }
  }

  return document.getElementById(fallbackId);
}

function revealLoginArea({ scroll = true } = {}) {
  state.loginRequested = true;
  state.creditFlowRequested = false;
  clearStandaloneModes();
  document.body.classList.add("account-flow-active");
  updateAuthUi();
  if (scroll) {
    scrollToElement(accountSection);
  }
}

function openPaymentView({ scroll = true } = {}) {
  state.loginRequested = true;
  state.creditFlowRequested = true;
  clearStandaloneModes();
  document.body.classList.add("checkout-flow-active");
  updateAuthUi();
  if (scroll) {
    scrollToElement(purchaseCard);
  }
}

function openCreditFlow() {
  hideCreditModal();
  if (state.client) {
    openPaymentView();
    return;
  }

  state.loginRequested = true;
  state.creditFlowRequested = true;
  clearStandaloneModes();
  document.body.classList.add("account-flow-active");
  updateAuthUi();
  scrollToElement(accountSection);
}

function closeAccountFlow() {
  state.loginRequested = false;
  state.creditFlowRequested = false;
  clearStandaloneModes();
  updateAuthUi();
  scrollToElement(document.getElementById("pricing"));
}

function openGeneratorView(targetHash = "#generator") {
  clearStandaloneModes();
  document.body.classList.add("generator-active");
  generatorPanel.classList.remove("hidden");

  const target = getHashTarget(targetHash, "generator");
  scrollToElement(target);
}

function closeGeneratorView() {
  document.body.classList.remove("generator-active");
  generatorPanel.classList.add("hidden");
  scrollToElement(document.getElementById("generator"));
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
    const errorMessage = payload && payload.error ? payload.error : "Request failed.";
    throw new Error(errorMessage);
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

function selectedPackageId() {
  return String(packageSelect.value || "").trim();
}

async function loadPackages() {
  const payload = await apiFetch("/api/credits/packages");
  state.packages = payload.packages || [];
  renderPackages(state.packages);
}

function setPayPalStatus(message, isError = false) {
  paypalStatus.textContent = message;
  paypalStatus.style.color = isError ? "#be123c" : "#667085";
}

function loadPayPalSdk(clientId, currency) {
  if (window.paypal && window.paypal.Buttons) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(
      currency,
    )}&intent=capture`;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load PayPal checkout."));
    document.head.appendChild(script);
  });
}

async function initPayPalCheckout() {
  if (!paypalButtons || !paypalStatus) {
    return;
  }

  try {
    const config = await apiFetch("/api/paypal/config");
    if (!config.configured || !config.clientId) {
      setPayPalStatus("PayPal is not configured yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.", true);
      return;
    }

    await loadPayPalSdk(config.clientId, config.currency || "USD");
    setPayPalStatus("Choose a package, then complete payment with PayPal.");
    paypalButtons.innerHTML = "";

    window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          shape: "pill",
          label: "paypal",
        },
        createOrder: async () => {
          const packageId = selectedPackageId();
          if (!packageId) {
            throw new Error("Please select a credit package first.");
          }
          setPayPalStatus("Creating PayPal order...");
          const payload = await apiFetch("/api/paypal/orders", {
            method: "POST",
            body: JSON.stringify({ packageId }),
          });
          return payload.id;
        },
        onApprove: async (data) => {
          setPayPalStatus("Capturing PayPal payment...");
          const payload = await apiFetch(`/api/paypal/orders/${encodeURIComponent(data.orderID)}/capture`, {
            method: "POST",
            body: JSON.stringify({ packageId: selectedPackageId() }),
          });
          updateClient(payload.client);
          setPayPalStatus(`PayPal payment complete. Added ${payload.transaction.credits} credits.`);
          setStatus(`Purchased ${payload.transaction.credits} credits with PayPal.`);
        },
        onCancel: () => {
          setPayPalStatus("PayPal payment was cancelled.");
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "PayPal payment failed.";
          setPayPalStatus(message, true);
        },
      })
      .render("#paypal-buttons");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to initialize PayPal checkout.";
    setPayPalStatus(message, true);
  }
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
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    setSession(payload.token, payload.client);
    registerForm.reset();
    setStatus("Account created. Continue to buy credits.");
    if (state.creditFlowRequested) {
      openPaymentView();
    }
  } catch (error) {
    setAuthStatus(error instanceof Error ? error.message : "Registration failed.", true);
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
    if (state.creditFlowRequested) {
      openPaymentView();
    }
  } catch (error) {
    setAuthStatus(error instanceof Error ? error.message : "Login failed.", true);
    setStatus(error instanceof Error ? error.message : "Login failed.", true);
  }
});

document.querySelectorAll("[data-open-login]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    revealLoginArea();
  });
});

creditModalClose.addEventListener("click", hideCreditModal);

creditModal.addEventListener("click", (event) => {
  if (event.target === creditModal) {
    hideCreditModal();
  }
});

document.querySelectorAll("[data-buy-credits]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openCreditFlow();
  });
});

document.querySelectorAll("[data-close-account-flow]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    closeAccountFlow();
  });
});

document.querySelectorAll("[data-open-generator]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const currentTarget = event.currentTarget;
    const targetHash =
      currentTarget && typeof currentTarget.getAttribute === "function" ? currentTarget.getAttribute("href") || "#generator" : "#generator";
    openGeneratorView(targetHash);
  });
});

document.querySelectorAll("[data-close-generator]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    closeGeneratorView();
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
  state.creditFlowRequested = false;
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

  const availableCredits = getAvailableCredits();
  const requiredCredits = getGenerationCreditCost(duration, resolution);
  if (availableCredits < requiredCredits) {
    showCreditModal(requiredCredits, availableCredits);
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

form.addEventListener("change", (event) => {
  const target = event.target;
  if (!target) {
    return;
  }
  if (target.name === "duration" || target.name === "resolution") {
    updateGenerationCreditNote();
  }
});

updateGenerationCreditNote();

restoreSession()
  .then(loadPackages)
  .then(initPayPalCheckout)
  .then(initAutoplayVideos)
  .catch((error) => {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Unable to initialize account features.", true);
  });
