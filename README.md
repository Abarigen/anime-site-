# ID CARD Store

Мінімалістичний сайт для продажу колекційних ID-карток. Покупець обирає картку, вводить ім'я, прізвище та телефон, після чого заявка надсилається в Telegram-бот.

## Запуск

```powershell
npm start
```

Сайт відкриється за адресою:

```text
http://localhost:3000
```

## Настройка Telegram

1. Створіть бота через `@BotFather` і отримайте `TELEGRAM_BOT_TOKEN`.
2. Дізнайтеся `TELEGRAM_CHAT_ID`, куди мають приходити заявки.
3. Скопіюйте `.env.example` у `.env`.
4. Заповніть значення:

```env
PORT=3000
TELEGRAM_BOT_TOKEN=1234567890:your_bot_token_here
TELEGRAM_CHAT_ID=123456789
```

Після цього перезапустіть сервер. У Telegram буде приходити вибрана картка, ім'я, прізвище та номер телефону.

## Перед хостингом

У репозиторії вже є SVG-зображення карток у `public/assets`, тому Railway може деплоїти сайт без локальних файлів із комп'ютера.

Якщо потрібно замінити SVG на реальні фото, покладіть файли в `public/assets` і оновіть шляхи в `server.js` та `public/index.html`.

Файл `.env` не потрібно завантажувати в GitHub або на хостинг. На хостингу ці значення додаються як Environment Variables.

## Хостинг на Render

1. Створіть репозиторій на GitHub і завантажте туди проект.
2. У Render створіть новий Blueprint або Web Service з цього репозиторію.
3. Build command: `npm install`
4. Start command: `npm start`
5. Додайте Environment Variables:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=-1003766248840
```

Після деплою Render видасть публічне посилання на сайт.

## Хостинг на Railway

1. Створіть новий проект у Railway з GitHub-репозиторію.
2. Виберіть цей репозиторій.
3. Railway візьме стартову команду з `railway.json`: `npm start`.
4. Додайте Variables:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=-1003766248840
```

Сервер автоматично слухає порт із `process.env.PORT`, тому додатково налаштовувати порт не потрібно.

## TikTok Pixel

Pixel `D82D0KBC77UDUGTVFU80` встановлений у `public/index.html`.

Події:

- `PageView` через `ttq.page()` під час відкриття сторінки.
- `ViewContent` під час завантаження каталогу.
- `AddToCart` під час вибору картки.
- `SubmitForm` та `CompleteRegistration` після успішної відправки заявки в Telegram.

Телефон покупця передається в `ttq.identify()` тільки у вигляді SHA-256 хешу на клієнтській стороні.
