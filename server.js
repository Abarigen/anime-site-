import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const root = resolve(".");
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const storeFile = join(dataDir, "store.json");
const env = { ...loadEnv(), ...process.env };
const port = Number(env.PORT) || 3000;
const sessions = new Set();
let storeCache = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function loadEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};

  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .reduce((acc, line) => {
      const index = line.indexOf("=");
      if (index === -1) return acc;
      acc[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return acc;
    }, {});
}

function defaultStore() {
  return {
    categories: [
      { id: "anime", name: "Аніме картки" },
      { id: "movies", name: "Кіно та серіали" }
    ],
    products: [
      {
        id: "naruto",
        categoryId: "anime",
        name: "Картка Naruto Uzumaki",
        price: 149,
        oldPrice: 0,
        image: "/assets/naruto-front.svg",
        description: "Колекційна PVC-картка з чистим помаранчево-чорним дизайном і кодом KONOHA.",
        stock: 24,
        active: true
      },
      {
        id: "gojo",
        categoryId: "anime",
        name: "Картка Satoru Gojo",
        price: 149,
        oldPrice: 0,
        image: "/assets/gojo-front.svg",
        description: "Контрастна картка у холодній естетиці з акцентом на символіку очей.",
        stock: 18,
        active: true
      },
      {
        id: "luffy",
        categoryId: "anime",
        name: "Картка Monkey D. Luffy",
        price: 149,
        oldPrice: 0,
        image: "/assets/luffy-front.svg",
        description: "Свіжий дизайн для фанатів пригод, піратських знаків і виразної графіки.",
        stock: 20,
        active: true
      }
    ],
    promotions: [
      { id: "single", title: "Придбати одну картку", buy: 1, gift: 0, discount: 0, popular: false },
      { id: "buy2gift1", title: "Придбай 2, отримай 1 в подарунок", buy: 2, gift: 1, discount: 33, popular: true }
    ],
    orders: []
  };
}

function ensureStore() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(storeFile)) writeStore(defaultStore());
}

function readStore() {
  ensureStore();
  if (!storeCache) {
    storeCache = JSON.parse(readFileSync(storeFile, "utf8"));
  }
  return storeCache;
}

function writeStore(store) {
  storeCache = store;
  mkdirSync(dirname(storeFile), { recursive: true });
  try {
    writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`);
  } catch (error) {
    console.error(`Store file write failed, keeping data in memory: ${error.message}`);
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 6_000_000) {
        rejectBody(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body ? JSON.parse(body) : {}));
    request.on("error", rejectBody);
  });
}

function isAuthorized(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return sessions.has(token);
}

function requireFields(payload, fields) {
  return fields.filter((field) => !String(payload[field] || "").trim());
}

function createOrderId() {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  const randomPart = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${datePart}${randomPart}`;
}

function publicStore(store) {
  return {
    categories: store.categories,
    products: store.products.filter((product) => product.active),
    promotions: activePromotions(store.promotions)
  };
}

function activePromotions(promotions = []) {
  return promotions.filter((promo) => ["single", "buy2gift1"].includes(promo.id));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sendTelegramOrder(order) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const items = order.items
    .map((item) => {
      const gift = Number(item.giftQuantity || 0);
      return gift
        ? `${escapeHtml(item.name)} · всього ${Number(item.quantity) + gift}, входить у ціну ${item.quantity}, подарунок ${gift}`
        : `${escapeHtml(item.name)} x ${item.quantity}`;
    })
    .join("\n");
  const text = [
    "<b>Нове замовлення ID CARD Store</b>",
    "",
    `<b>Замовлення:</b> ${escapeHtml(order.id)}`,
    `<b>Товари:</b>\n${items}`,
    `<b>Сума:</b> ${escapeHtml(order.total)} грн`,
    `<b>ПІБ:</b> ${escapeHtml(order.fullName)}`,
    `<b>Телефон:</b> ${escapeHtml(order.phone)}`,
    `<b>Нова пошта:</b> ${escapeHtml(order.postOffice)}`,
    `<b>Оплата:</b> ${escapeHtml(order.paymentMethod)}`
  ].join("\n");

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
    });

    if (!telegramResponse.ok) {
      const details = await telegramResponse.text();
      console.error(`Telegram error: ${details}`);
    }
  } catch (error) {
    console.error(`Telegram delivery failed: ${error.message}`);
  }
}

function normalizeProduct(payload, previous = {}) {
  return {
    id: previous.id || payload.id || randomUUID(),
    categoryId: String(payload.categoryId || previous.categoryId || "").trim(),
    name: String(payload.name || previous.name || "").trim(),
    price: Number(payload.price ?? previous.price ?? 0),
    oldPrice: Number(payload.oldPrice ?? previous.oldPrice ?? 0),
    image: String(payload.image || previous.image || "/assets/naruto-front.svg").trim(),
    description: String(payload.description || previous.description || "").trim(),
    stock: Number(payload.stock ?? previous.stock ?? 0),
    active: Boolean(payload.active ?? previous.active ?? true)
  };
}

function saveUploadedImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return "";
  return dataUrl;
}

function applyUploadedImage(payload) {
  if (!payload.imageData) return payload;
  const image = saveUploadedImage(payload.imageData);
  const { imageData, ...rest } = payload;
  return image ? { ...rest, image } : rest;
}

async function handleApi(request, response, url) {
  const store = readStore();

  if (request.method === "GET" && url.pathname === "/api/store") {
    sendJson(response, 200, publicStore(store));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    const payload = await readBody(request);
    const missing = requireFields(payload, ["fullName", "phone", "postOffice", "paymentMethod"]);
    if (missing.length || !Array.isArray(payload.items) || payload.items.length === 0) {
      sendJson(response, 400, { ok: false, message: "Заповніть усі поля та додайте товар у кошик." });
      return true;
    }

    const items = payload.items
      .map((item) => {
        const product = store.products.find((entry) => entry.id === item.productId && entry.active);
        if (!product) return null;
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const giftQuantity = Math.max(0, Number(item.giftQuantity) || 0);
        const chosenProducts = Array.isArray(item.chosenProducts)
          ? item.chosenProducts
              .map((id) => store.products.find((entry) => entry.id === id))
              .filter(Boolean)
              .map((entry) => entry.name)
          : [product.name];
        return {
          productId: product.id,
          name: item.promoId ? `Акційний набір: ${chosenProducts.join(", ")}` : product.name,
          price: product.price,
          quantity,
          giftQuantity,
          lineTotal: product.price * quantity
        };
      })
      .filter(Boolean);

    if (!items.length) {
      sendJson(response, 400, { ok: false, message: "Обрані товари не знайдено." });
      return true;
    }

    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const order = {
      id: createOrderId(),
      items,
      fullName: String(payload.fullName).trim(),
      phone: String(payload.phone).trim(),
      postOffice: String(payload.postOffice).trim(),
      paymentMethod: String(payload.paymentMethod).trim(),
      total,
      status: "new",
      createdAt: new Date().toISOString()
    };

    store.orders.unshift(order);
    writeStore(store);
    await sendTelegramOrder(order);
    sendJson(response, 200, {
      ok: true,
      orderId: order.id,
      message: "Замовлення прийнято в роботу. Наш менеджер найближчим часом зв'яжеться для підтвердження."
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    const payload = await readBody(request);
    const login = env.ADMIN_LOGIN || "admin";
    const password = env.ADMIN_PASSWORD || "admin123";

    if (payload.login === login && payload.password === password) {
      const token = randomBytes(24).toString("hex");
      sessions.add(token);
      sendJson(response, 200, { ok: true, token });
    } else {
      sendJson(response, 401, { ok: false, message: "Невірний логін або пароль." });
    }
    return true;
  }

  if (!url.pathname.startsWith("/api/admin/")) return false;
  if (!isAuthorized(request)) {
    sendJson(response, 401, { ok: false, message: "Потрібна авторизація адміністратора." });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/store") {
    sendJson(response, 200, { ...store, promotions: activePromotions(store.promotions) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/categories") {
    const payload = await readBody(request);
    if (!String(payload.name || "").trim()) {
      sendJson(response, 400, { ok: false, message: "Назва категорії обов'язкова." });
      return true;
    }

    store.categories.push({ id: randomUUID(), name: String(payload.name).trim() });
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  const categoryMatch = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (categoryMatch && request.method === "PUT") {
    const payload = await readBody(request);
    const category = store.categories.find((entry) => entry.id === categoryMatch[1]);
    if (!category) {
      sendJson(response, 404, { ok: false, message: "Категорію не знайдено." });
      return true;
    }
    category.name = String(payload.name || category.name).trim();
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  if (categoryMatch && request.method === "DELETE") {
    store.categories = store.categories.filter((entry) => entry.id !== categoryMatch[1]);
    store.products = store.products.map((product) =>
      product.categoryId === categoryMatch[1] ? { ...product, categoryId: store.categories[0]?.id || "" } : product
    );
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/products") {
    const payload = applyUploadedImage(await readBody(request));
    const product = normalizeProduct(payload);
    const missing = requireFields(product, ["name", "categoryId", "description"]);
    if (missing.length || product.price <= 0) {
      sendJson(response, 400, { ok: false, message: "Заповніть назву, категорію, опис та ціну товару." });
      return true;
    }
    store.products.unshift(product);
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch && request.method === "PUT") {
    const payload = applyUploadedImage(await readBody(request));
    const index = store.products.findIndex((entry) => entry.id === productMatch[1]);
    if (index === -1) {
      sendJson(response, 404, { ok: false, message: "Товар не знайдено." });
      return true;
    }
    store.products[index] = normalizeProduct(payload, store.products[index]);
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  if (productMatch && request.method === "DELETE") {
    store.products = store.products.filter((entry) => entry.id !== productMatch[1]);
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch && request.method === "PATCH") {
    const payload = await readBody(request);
    const order = store.orders.find((entry) => entry.id === orderMatch[1]);
    if (!order) {
      sendJson(response, 404, { ok: false, message: "Замовлення не знайдено." });
      return true;
    }
    order.status = payload.status === "sent" ? "sent" : "new";
    writeStore(store);
    sendJson(response, 200, { ok: true, store });
    return true;
  }

  sendJson(response, 404, { ok: false, message: "API route not found." });
  return true;
}

function serveFile(response, filePath) {
  if (!existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": [".html", ".js", ".css"].includes(extension) ? "no-store" : "public, max-age=300"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (await handleApi(request, response, url)) return;

    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }

    const safePath = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(publicDir, safePath);

    if (!filePath.startsWith(publicDir)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    if (!existsSync(filePath) && !extname(filePath)) {
      filePath = join(publicDir, "index.html");
    }

    serveFile(response, filePath);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: "Внутрішня помилка сервера." });
  }
});

server.listen(port, () => {
  ensureStore();
  console.log(`ID CARD Store is running at http://localhost:${port}`);
});
