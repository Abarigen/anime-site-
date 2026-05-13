const form = document.querySelector("#order-form");
const cardSelect = document.querySelector("#card-select");
const status = document.querySelector("#form-status");
const buttons = document.querySelectorAll(".select-card");

const productMeta = {
  "Naruto Uzumaki": { content_id: "NU-0001-KONOHA", content_name: "Naruto Uzumaki ID Card", value: 100 },
  "Satoru Gojo": { content_id: "SG-1207-EYES", content_name: "Satoru Gojo ID Card", value: 100 },
  "Monkey D. Luffy": { content_id: "MDL-0505-STRAW", content_name: "Monkey D. Luffy ID Card", value: 100 }
};

function getTikTokContent(cardName) {
  const product = productMeta[cardName] || productMeta["Naruto Uzumaki"];
  return {
    contents: [{ ...product, content_type: "product" }],
    value: product.value,
    currency: "USD"
  };
}

function trackTikTok(eventName, payload) {
  if (window.ttq && typeof window.ttq.track === "function") {
    window.ttq.track(eventName, payload);
  }
}

async function sha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || !window.crypto?.subtle) return "";

  const bytes = new TextEncoder().encode(normalized);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

trackTikTok("ViewContent", getTikTokContent(cardSelect.value));

buttons.forEach((button) => {
  button.addEventListener("click", () => {
    const product = button.closest("[data-card]");
    cardSelect.value = product.dataset.card;
    trackTikTok("AddToCart", getTikTokContent(cardSelect.value));
    window.location.hash = "order";
    document.querySelector("#order").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => form.querySelector("input[name='firstName']").focus(), 450);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form).entries());

  status.className = "form-status";
  status.textContent = "Надсилаємо замовлення...";
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Помилка надсилання");
    }

    status.className = "form-status success";
    status.textContent = result.message;
    const hashedPhone = await sha256(data.phone);

    if (hashedPhone && window.ttq && typeof window.ttq.identify === "function") {
      window.ttq.identify({
        phone_number: hashedPhone,
        external_id: hashedPhone
      });
    }

    trackTikTok("SubmitForm", getTikTokContent(data.cardName));
    trackTikTok("CompleteRegistration", getTikTokContent(data.cardName));
    form.reset();
  } catch (error) {
    status.className = "form-status error";
    status.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
