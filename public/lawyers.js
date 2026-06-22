const TOKEN_KEY = "lexbridge_auth_token";
const USER_KEY = "lexbridge_auth_user";

const state = {
  query: "",
  category: "",
  page: 1,
  pageSize: 9,
  total: 0,
  totalPages: 0,
  lawyers: [],
  selectedLawyerId: null,
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: null,
};

const els = {
  search: document.querySelector("#lawyer-search"),
  category: document.querySelector("#category-filter"),
  resultSummary: document.querySelector("#result-summary"),
  results: document.querySelector("#lawyer-results"),
  prevPage: document.querySelector("#prev-page"),
  nextPage: document.querySelector("#next-page"),
  pageLabel: document.querySelector("#page-label"),
  detail: document.querySelector("#lawyer-detail"),
  reviews: document.querySelector("#lawyer-reviews"),
  authStatus: document.querySelector("#auth-status"),
  registerForm: document.querySelector("#register-form"),
  loginForm: document.querySelector("#login-form"),
  logoutBtn: document.querySelector("#logout-btn"),
  reviewForm: document.querySelector("#review-form"),
  reviewRating: document.querySelector("#review-rating"),
  reviewComment: document.querySelector("#review-comment"),
};

const cachedUserRaw = localStorage.getItem(USER_KEY);
if (cachedUserRaw) {
  try {
    state.user = JSON.parse(cachedUserRaw);
  } catch {
    state.user = null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    throw new Error(payload.error || "請求失敗");
  }

  return payload;
}

function updateAuthUi() {
  if (state.user) {
    els.authStatus.textContent = `已登入：${state.user.name}（${state.user.email}）`;
    els.logoutBtn.classList.remove("hidden");
  } else {
    els.authStatus.textContent = "未登入，請先登入或註冊。";
    els.logoutBtn.classList.add("hidden");
  }
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  updateAuthUi();
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  updateAuthUi();
}

async function loadCategories() {
  const payload = await apiFetch("/api/law-categories");
  const options = payload.categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");

  els.category.insertAdjacentHTML("beforeend", options);
}

function renderLawyers() {
  if (state.lawyers.length === 0) {
    els.results.innerHTML = `<p class="muted">暫時找不到相關律師，請嘗試其他關鍵字或分類。</p>`;
    return;
  }

  const cards = state.lawyers
    .map((lawyer) => {
      const ratingText =
        lawyer.averageRating === null
          ? "尚未有評分"
          : `⭐ ${lawyer.averageRating} (${lawyer.reviewCount} 則評論)`;

      const categories = (lawyer.categories || [])
        .map((category) => `<span>${escapeHtml(category)}</span>`)
        .join("");

      return `
        <article class="lawyer-card" data-lawyer-id="${escapeHtml(lawyer.id)}">
          <div class="lawyer-card-head">
            <h3>${escapeHtml(lawyer.nameZh || lawyer.nameEn)}</h3>
            <p>${escapeHtml(lawyer.nameEn || "")}</p>
          </div>
          <p class="lawyer-firm">${escapeHtml(lawyer.firmZh || lawyer.firmEn || "未提供律師行資料")}</p>
          <p class="muted">${escapeHtml(lawyer.district || "香港")} · ${escapeHtml(
        `${lawyer.yearsExperience || 0} 年經驗`,
      )}</p>
          <p class="muted">${ratingText}</p>
          <div class="category-tags">${categories}</div>
          <button class="secondary-btn full-width" type="button">查看詳情及評論</button>
        </article>
      `;
    })
    .join("");

  els.results.innerHTML = cards;
}

function renderReviews(items) {
  if (!items.length) {
    els.reviews.innerHTML = `<p class="muted">此律師暫未有評論，歡迎成為第一位評價者。</p>`;
    return;
  }

  const html = items
    .map(
      (review) => `
      <article class="review-item">
        <div class="review-item-head">
          <strong>${escapeHtml(review.userName || "匿名用戶")}</strong>
          <span>⭐ ${escapeHtml(review.rating)}</span>
        </div>
        <p>${escapeHtml(review.comment || "")}</p>
        <small>${escapeHtml(new Date(review.updatedAt || review.createdAt).toLocaleString("zh-HK"))}</small>
      </article>
    `,
    )
    .join("");

  els.reviews.innerHTML = html;
}

async function loadLawyerDetails(lawyerId) {
  state.selectedLawyerId = lawyerId;

  const [lawyer, reviewsPayload] = await Promise.all([
    apiFetch(`/api/lawyers/${encodeURIComponent(lawyerId)}`),
    apiFetch(`/api/lawyers/${encodeURIComponent(lawyerId)}/reviews`),
  ]);

  const categories = (lawyer.categories || [])
    .map((category) => `<span>${escapeHtml(category)}</span>`)
    .join("");
  const languages = (lawyer.languages || []).map((language) => escapeHtml(language)).join(" / ");

  els.detail.innerHTML = `
    <h3>${escapeHtml(lawyer.nameZh || lawyer.nameEn)}</h3>
    <p class="muted">${escapeHtml(lawyer.nameEn || "")}</p>
    <p><strong>律師行：</strong>${escapeHtml(lawyer.firmZh || lawyer.firmEn || "未提供")}</p>
    <p><strong>地區：</strong>${escapeHtml(lawyer.district || "香港")}</p>
    <p><strong>語言：</strong>${languages || "未提供"}</p>
    <p><strong>評分：</strong>${
      lawyer.averageRating === null
        ? "尚未有評分"
        : `⭐ ${escapeHtml(lawyer.averageRating)}（${escapeHtml(lawyer.reviewCount)} 則評論）`
    }</p>
    <div class="category-tags">${categories}</div>
  `;

  renderReviews(reviewsPayload.items || []);
}

function updatePagination() {
  els.pageLabel.textContent = `第 ${state.page} 頁 / 共 ${Math.max(state.totalPages, 1)} 頁`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.totalPages === 0 || state.page >= state.totalPages;
}

async function loadLawyers() {
  const params = new URLSearchParams({
    query: state.query,
    category: state.category,
    page: String(state.page),
    pageSize: String(state.pageSize),
  });

  const payload = await apiFetch(`/api/lawyers?${params.toString()}`);
  state.lawyers = payload.items || [];
  state.total = payload.total || 0;
  state.totalPages = payload.totalPages || 0;
  state.page = payload.page || 1;

  els.resultSummary.textContent = `搜尋結果：${state.total} 位律師`;
  renderLawyers();
  updatePagination();
}

async function tryRestoreSession() {
  if (!state.token) {
    clearSession();
    return;
  }

  try {
    const payload = await apiFetch("/api/auth/me");
    state.user = payload.user;
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
    updateAuthUi();
  } catch {
    clearSession();
  }
}

function initEvents() {
  let debounceTimer = null;

  els.search.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = els.search.value.trim();
      state.page = 1;
      loadLawyers().catch((error) => {
        alert(error.message);
      });
    }, 250);
  });

  els.category.addEventListener("change", () => {
    state.category = els.category.value;
    state.page = 1;
    loadLawyers().catch((error) => {
      alert(error.message);
    });
  });

  els.prevPage.addEventListener("click", () => {
    if (state.page <= 1) {
      return;
    }
    state.page -= 1;
    loadLawyers().catch((error) => alert(error.message));
  });

  els.nextPage.addEventListener("click", () => {
    if (state.totalPages === 0 || state.page >= state.totalPages) {
      return;
    }
    state.page += 1;
    loadLawyers().catch((error) => alert(error.message));
  });

  els.results.addEventListener("click", (event) => {
    const card = event.target.closest("[data-lawyer-id]");
    if (!card) {
      return;
    }
    const lawyerId = card.getAttribute("data-lawyer-id");
    if (!lawyerId) {
      return;
    }

    loadLawyerDetails(lawyerId).catch((error) => alert(error.message));
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(els.registerForm);

    try {
      const payload = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      setSession(payload.token, payload.user);
      els.registerForm.reset();
      alert("註冊成功，已自動登入。");
    } catch (error) {
      alert(error.message);
    }
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(els.loginForm);

    try {
      const payload = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      setSession(payload.token, payload.user);
      els.loginForm.reset();
      alert("登入成功。");
    } catch (error) {
      alert(error.message);
    }
  });

  els.logoutBtn.addEventListener("click", async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors and clear local state anyway.
    }
    clearSession();
  });

  els.reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.selectedLawyerId) {
      alert("請先選擇一位律師。");
      return;
    }

    if (!state.token) {
      alert("請先登入，才可提交評論。");
      return;
    }

    try {
      await apiFetch(`/api/lawyers/${encodeURIComponent(state.selectedLawyerId)}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          rating: Number(els.reviewRating.value),
          comment: els.reviewComment.value.trim(),
        }),
      });

      els.reviewForm.reset();
      await loadLawyerDetails(state.selectedLawyerId);
      await loadLawyers();
      alert("評論已提交。");
    } catch (error) {
      if (error.message.includes("登入已失效")) {
        clearSession();
      }
      alert(error.message);
    }
  });
}

async function init() {
  updateAuthUi();
  initEvents();
  await tryRestoreSession();
  await loadCategories();
  await loadLawyers();
}

init().catch((error) => {
  console.error(error);
  alert(`初始化失敗：${error.message}`);
});
