import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";

const root = resolve(".");
const publicDir = join(root, "public");
const assetsDir = join(publicDir, "assets");
const downloadDir = "C:\\Users\\Administrator\\Downloads\\Telegram Desktop";
const port = Number(process.env.PORT) || Number(loadEnv().PORT) || 3000;
const env = { ...loadEnv(), ...process.env };

function imagePath(assetName, localName) {
  const hostedPath = join(assetsDir, assetName);
  return existsSync(hostedPath) ? hostedPath : join(downloadDir, localName);
}

const imageMap = {
  "/images/gojo-front.svg": join(assetsDir, "gojo-front.svg"),
  "/images/gojo-back.svg": join(assetsDir, "gojo-back.svg"),
  "/images/naruto-front.svg": join(assetsDir, "naruto-front.svg"),
  "/images/naruto-back.svg": join(assetsDir, "naruto-back.svg"),
  "/images/luffy-front.svg": join(assetsDir, "luffy-front.svg"),
  "/images/luffy-back.svg": join(assetsDir, "luffy-back.svg")
};

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

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        rejectBody(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
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

  if (!token || !chatId) {
    throw new Error("Telegram bot token or chat id is missing");
  }

  const text = [
    "<b>Нове замовлення ID CARD</b>",
    "",
    `<b>Картка:</b> ${escapeHtml(order.cardName)}`,
    `<b>Ім'я:</b> ${escapeHtml(order.firstName)}`,
    `<b>Прізвище:</b> ${escapeHtml(order.lastName)}`,
    `<b>Телефон:</b> ${escapeHtml(order.phone)}`
  ].join("\n");

  const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML"
    })
  });

  if (!telegramResponse.ok) {
    const details = await telegramResponse.text();
    throw new Error(`Telegram error: ${details}`);
  }
}

function serveFile(response, filePath) {
  if (!existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const isAsset = filePath.startsWith(join(publicDir, "assets")) || filePath.includes(`${normalize("\\assets\\")}`);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": isAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/order") {
    try {
      const order = JSON.parse(await readBody(request));
      const required = ["cardName", "firstName", "lastName", "phone"];
      const missing = required.find((field) => !String(order[field] || "").trim());

      if (missing) {
        sendJson(response, 400, { ok: false, message: "Заповніть усі поля замовлення." });
        return;
      }

      await sendTelegramOrder(order);
      sendJson(response, 200, { ok: true, message: "Замовлення надіслано. Ми скоро зв'яжемося з вами." });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, {
        ok: false,
        message: "Не вдалося надіслати замовлення. Перевірте налаштування Telegram у .env."
      });
    }
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  if (imageMap[url.pathname]) {
    serveFile(response, imageMap[url.pathname]);
    return;
  }

  const safePath = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  serveFile(response, filePath);
});

server.listen(port, () => {
  console.log(`ID cards shop is running at http://localhost:${port}`);
});
