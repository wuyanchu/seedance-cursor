const chatEl = document.querySelector("#chat");
const formEl = document.querySelector("#ask-form");
const questionEl = document.querySelector("#question");
const submitBtnEl = document.querySelector("#submit-btn");

const history = [];

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;

  article.appendChild(bubble);
  chatEl.appendChild(article);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setLoading(isLoading) {
  submitBtnEl.disabled = isLoading;
  questionEl.disabled = isLoading;
  submitBtnEl.textContent = isLoading ? "AI 回答中..." : "送出問題";
}

async function askLawQuestion(question) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question,
      history,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "發生未知錯誤");
  }

  return payload.answer;
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionEl.value.trim();
  if (!question) {
    return;
  }

  appendMessage("user", question);
  history.push({ role: "user", content: question });
  questionEl.value = "";
  setLoading(true);

  try {
    const answer = await askLawQuestion(question);
    appendMessage("assistant", answer);
    history.push({ role: "assistant", content: answer });
  } catch (error) {
    appendMessage("assistant", `抱歉，系統暫時無法回應：${error.message}`);
  } finally {
    setLoading(false);
    questionEl.focus();
  }
});
