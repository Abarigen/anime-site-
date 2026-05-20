const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });
const CART_VERSION = "bundle-cart-v4";

if (localStorage.getItem("cartVersion") !== CART_VERSION) {
  localStorage.setItem("cartVersion", CART_VERSION);
  localStorage.setItem("cart", "[]");
}

const state = {
  store: { categories: [], products: [], promotions: [], orders: [] },
  cart: JSON.parse(localStorage.getItem("cart") || "[]"),
  adminToken: sessionStorage.getItem("adminToken") || "",
  activeCategory: "all",
  adminLoaded: false
};

function normalizeStore(store) {
  return {
    ...store,
    promotions: (store.promotions || []).filter((promo) => ["single", "buy2gift1"].includes(promo.id))
  };
}

const app = document.querySelector("#app");
const cartCount = document.querySelector("#cart-count");
const toast = document.querySelector("#toast");
const orderModal = document.querySelector("#order-modal");
const orderModalText = document.querySelector("#order-modal-text");
const orderModalNumber = document.querySelector("#order-modal-number");
const editorImages = new WeakMap();

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.adminToken) headers.Authorization = `Bearer ${state.adminToken}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "Помилка запиту.");
  return payload;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function showOrderModal(result) {
  orderModalText.textContent = result.message || "Замовлення прийнято в роботу. Наш менеджер найближчим часом зв'яжеться для підтвердження.";
  const numericOrderId = String(result.orderId || "").replace(/\D/g, "");
  orderModalNumber.textContent = numericOrderId ? `Номер замовлення: ${numericOrderId}` : "";
  orderModal.classList.remove("hidden");
}

function navigate(path) {
  history.pushState({}, "", path);
  renderRoute();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(state.cart));
  updateCartCount();
}

function updateCartCount() {
  cartCount.textContent = state.cart.reduce((sum, item) => sum + item.quantity + (item.giftQuantity || 0), 0);
}

function productById(id) {
  return state.store.products.find((product) => product.id === id);
}

function categoryName(id) {
  return state.store.categories.find((category) => category.id === id)?.name || "Категорія";
}

function getCartRows() {
  return state.cart
    .map((item) => ({
      ...item,
      product: productById(item.productId),
      selectedProducts: (item.chosenProducts || [item.productId]).map((id) => productById(id)).filter(Boolean)
    }))
    .filter((item) => item.product);
}

function addToCart(productId, quantity = 1, replace = false) {
  const product = productById(productId);
  if (!product) return false;
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity = replace ? quantity : existing.quantity + quantity;
  } else {
    state.cart.push({ productId, quantity });
  }
  saveCart();
  notify("Товар додано до вашого кошика");
  return true;
}

function addBundleToCart(productId, replace = false) {
  const product = productById(productId);
  const selectedPromo = document.querySelector("[data-promo-quantity].selected");
  if (!product || !selectedPromo) {
    return addToCart(productId, selectedQuantity(document, productId), replace);
  }

  const promoId = selectedPromo.dataset.promoId;
  const paidQuantity = Math.max(1, Number(selectedPromo.dataset.promoQuantity) || 1);
  const giftQuantity = Math.max(0, Number(selectedPromo.dataset.promoGift) || 0);
  const chosenProducts = [
    productId,
    ...[...document.querySelectorAll("[data-bundle-select]")].map((select) => select.value)
  ];
  if (chosenProducts.some((id) => !id)) {
    notify("Оберіть усі картки для акційного набору");
    return false;
  }
  const bundleKey = `${productId}:${promoId}:${chosenProducts.join(",")}`;
  const bundleItem = {
    productId,
    promoId,
    bundleKey,
    quantity: paidQuantity,
    giftQuantity,
    chosenProducts
  };
  const existing = state.cart.find((item) => item.bundleKey === bundleKey);

  if (existing) {
    existing.quantity = replace ? paidQuantity : existing.quantity + paidQuantity;
  } else {
    state.cart.push(bundleItem);
  }

  saveCart();
  notify("Набір додано до вашого кошика");
  return true;
}

function quantityControl(productId, value = 1, compact = false, cartKey = "") {
  return `
    <div class="qty ${compact ? "compact" : ""}" data-qty="${productId}" ${cartKey ? `data-cart-key="${cartKey}"` : ""}>
      <button type="button" data-step="-1" aria-label="Зменшити кількість">-</button>
      <input type="number" min="1" max="99" value="${value}" aria-label="Кількість" />
      <button type="button" data-step="1" aria-label="Збільшити кількість">+</button>
    </div>
  `;
}

function selectedQuantity(root, productId) {
  return Math.max(1, Number(root.querySelector(`[data-qty="${productId}"] input`)?.value) || 1);
}

function renderCatalog() {
  const products = state.store.products.filter(
    (product) => state.activeCategory === "all" || product.categoryId === state.activeCategory
  );
  const feature = products[0] || state.store.products[0];
  const categories = [{ id: "all", name: "Усі" }, ...state.store.categories];

  app.innerHTML = `
    <section class="storefront">
      <div class="storefront-copy">
        <p class="tiny">Каталог</p>
        <h1>Картки</h1>
        <p>Сувенірні картки з відомими персонажами. Обирайте товар, кількість або акційний набір і переходьте до оформлення.</p>
      </div>
      ${feature ? `
        <a class="feature-product" href="/product/${feature.id}" data-link>
          <img src="${feature.image}" alt="${feature.name}" />
          <span>${feature.name}</span>
          <strong>${money.format(feature.price)} UAH</strong>
        </a>
      ` : ""}
    </section>

    <section class="category-strip" aria-label="Категорії">
      ${categories
        .map(
          (category) => `
            <button class="${state.activeCategory === category.id ? "active" : ""}" type="button" data-category="${category.id}">
              ${category.name}
            </button>
          `
        )
        .join("")}
    </section>

    <section class="product-grid">
      ${products.map(renderProductCard).join("") || `<div class="empty-state">У цій категорії поки немає товарів.</div>`}
    </section>
  `;
}

function renderProductCard(product) {
  return `
    <article class="product-card">
      <a class="product-image" href="/product/${product.id}" data-link>
        <img src="${product.image}" alt="${product.name}" loading="lazy" decoding="async" />
      </a>
      <div class="product-info">
        <a href="/product/${product.id}" data-link>
          <h2>${product.name}</h2>
        </a>
        <p>${categoryName(product.categoryId)}</p>
        <strong>${money.format(product.price)} UAH</strong>
        <div class="card-actions">
          ${quantityControl(product.id, 1, true)}
          <button class="button dark" type="button" data-add="${product.id}">Додати</button>
        </div>
      </div>
    </article>
  `;
}

function renderProductPage(productId) {
  const product = productById(productId) || state.store.products[0];
  if (!product) {
    app.innerHTML = `<section class="empty-state">Товар не знайдено.</section>`;
    return;
  }

  const defaultPromo = state.store.promotions[0];

  app.innerHTML = `
    <section class="product-page" data-current-product="${product.id}">
      <div class="product-gallery">
        <img src="${product.image}" alt="${product.name}" />
      </div>
      <div class="product-buybox">
        <p class="tiny">${categoryName(product.categoryId)}</p>
        <h1>${product.name}</h1>
        <div class="price-line">
          <strong>${money.format(product.price)} UAH</strong>
          ${product.oldPrice ? `<s>${money.format(product.oldPrice)} UAH</s>` : ""}
        </div>
        <p class="tax-note">Податки включено. Доставка розраховується під час оформлення замовлення.</p>

        <div class="promo-title"><span></span><h2>Акція</h2><span></span></div>
        <div class="promo-list">${state.store.promotions.map((promo, index) => renderPromoCard(promo, product, index)).join("")}</div>
        <div class="bundle-builder" id="bundle-builder">${renderBundleBuilder(product, defaultPromo)}</div>

        <div class="buy-actions">
          <div class="bundle-summary" id="bundle-summary">${renderBundleSummary(defaultPromo)}</div>
          <button class="button outline wide" type="button" data-add="${product.id}">Додати до кошика</button>
          <button class="button dark wide" type="button" data-buy="${product.id}">Купити зараз</button>
        </div>
      </div>
    </section>

    <section class="description-page">
      <h2>Опис</h2>
      <p>${product.description}</p>
      <p>Наявність: ${product.stock > 0 ? `${product.stock} шт.` : "під замовлення"}</p>
    </section>
  `;
}

function renderPromoCard(promo, product, index) {
  const paid = promo.buy * product.price;
  const full = (promo.buy + promo.gift) * product.price;
  const isSelected = index === 0;
  return `
    <button class="promo-card ${isSelected ? "selected" : ""}" type="button" data-promo-quantity="${promo.buy}" data-promo-gift="${promo.gift}" data-promo-id="${promo.id}">
      ${promo.popular ? `<span class="popular">Most Popular</span>` : ""}
      <span class="radio"></span>
      <div class="promo-main">
        <h3>${promo.title}</h3>
        ${promo.discount ? `<b>Збережи ${promo.discount}%</b>` : ""}
        <div class="mini-product">
          <img src="${product.image}" alt="" />
          <span>${product.name}</span>
        </div>
      </div>
      <div class="promo-money">
        <strong>${money.format(paid)}</strong>
        ${promo.gift ? `<s>${money.format(full)}</s>` : ""}
      </div>
    </button>
  `;
}

function renderBundleBuilder(product, promo) {
  if (!promo || !promo.gift) {
    return `
      <div class="bundle-note">
        <strong>У наборі</strong>
        <span>${product.name}</span>
      </div>
    `;
  }

  const totalCards = promo.buy + promo.gift;
  const extraSlots = Math.max(0, totalCards - 1);
  const options = state.store.products
    .map((entry) => `<option value="${entry.id}">${entry.name}</option>`)
    .join("");

  return `
    <div class="bundle-note">
      <strong>Оберіть склад набору</strong>
      <span>Основна картка: ${product.name}. Додайте ще ${extraSlots} ${extraSlots === 1 ? "картку" : "картки"} для цієї акції.</span>
    </div>
    <div class="bundle-fixed-card">
      <img src="${product.image}" alt="" />
      <span>Картка 1</span>
      <strong>${product.name}</strong>
    </div>
    <div class="bundle-slots">
      ${Array.from({ length: extraSlots }, (_, index) => `
        <label class="bundle-slot empty">
          <span class="bundle-placeholder" data-bundle-preview>+</span>
          <span>Картка ${index + 2}</span>
          <select data-bundle-select>
            <option value="" selected>Оберіть картку</option>
            ${options}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

function renderBundleSummary(promo) {
  const buy = Math.max(1, Number(promo?.buy) || 1);
  const gift = Math.max(0, Number(promo?.gift) || 0);
  return `
    <span>У наборі: ${buy + gift} ${buy + gift === 1 ? "картка" : "картки"}</span>
    <strong>До оплати: ${buy}</strong>
    ${gift ? `<em>Подарунок: ${gift}</em>` : ""}
  `;
}

function renderCartPage() {
  const rows = getCartRows();
  const total = rows.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
  app.innerHTML = `
    <section class="page-head">
      <p class="tiny">Кошик</p>
      <h1>Ваше замовлення</h1>
    </section>
    <section class="cart-page">
      <div class="cart-list">
        ${
          rows.length
            ? rows
                .map(renderCartItem)
                .join("")
            : `<div class="empty-state">Кошик порожній. Перейдіть у каталог і додайте товар.</div>`
        }
      </div>
      <aside class="summary">
        <span>Разом</span>
        <strong>${money.format(total)} UAH</strong>
        <button class="button dark wide" type="button" data-go-checkout ${rows.length ? "" : "disabled"}>Підтвердити замовлення</button>
        <button class="button outline wide" type="button" data-go-catalog>Продовжити покупки</button>
      </aside>
    </section>
  `;
}

function renderCartItem(row) {
  if (row.promoId) {
    const isSingle = row.promoId === "single";
    return `
      <article class="cart-item ${isSingle ? "" : "bundle-cart-item"}">
        <img src="${row.product.image}" alt="${row.product.name}" />
        <div>
          <h2>${isSingle ? row.product.name : "Акційний набір"}</h2>
          ${isSingle ? `
            <p>${money.format(row.product.price)} UAH</p>
          ` : `
            <div class="cart-badges">
              <span>Всього: ${row.quantity + row.giftQuantity}</span>
              <span>Входить у ціну: ${row.quantity}</span>
              <span>Подарунок: ${row.giftQuantity}</span>
            </div>
            <div class="cart-composition">
              ${row.selectedProducts
                .map(
                  (entry, index) => `
                    <div class="cart-card-line">
                      <img src="${entry.image}" alt="" />
                      <span>Картка ${index + 1}</span>
                      <strong>${entry.name}</strong>
                      <em>${index < row.quantity ? "Входить у ціну" : "Подарунок"}</em>
                    </div>
                  `
                )
                .join("")}
            </div>
            <p>Сума набору: ${money.format(row.product.price * row.quantity)} UAH</p>
          `}
        </div>
        <button class="remove" type="button" data-remove="${row.bundleKey}">Видалити з кошика</button>
      </article>
    `;
  }

  return `
    <article class="cart-item">
      <img src="${row.product.image}" alt="${row.product.name}" />
      <div>
        <h2>${row.product.name}</h2>
        <p>${money.format(row.product.price)} x ${row.quantity}</p>
        ${quantityControl(row.product.id, row.quantity, true, row.productId)}
      </div>
      <button class="remove" type="button" data-remove="${row.product.id}">Видалити з кошика</button>
    </article>
  `;
}

function renderCheckoutPage() {
  const rows = getCartRows();
  if (!rows.length) {
    navigate("/cart");
    return;
  }

  app.innerHTML = `
    <section class="page-head">
      <p class="tiny">Доставка</p>
      <h1>Дані для відправки</h1>
    </section>
    <section class="checkout-page">
      <form class="checkout-form" id="checkout-form">
        <label>ФІО<input name="fullName" type="text" autocomplete="name" placeholder="Іваненко Іван Іванович" required /></label>
        <label>Номер телефону<input name="phone" type="tel" autocomplete="tel" placeholder="+380 00 000 00 00" required /></label>
        <label>Відділення Нової пошти<input name="postOffice" type="text" placeholder="м. Київ, відділення №12" required /></label>
        <label>
          Метод оплати
          <select name="paymentMethod" required>
            <option value="Повна оплата за реквізитами">Повна оплата за реквізитами</option>
            <option value="Оплата при отриманні">Оплата при отриманні</option>
          </select>
        </label>
        <button class="button dark wide" type="submit">Підтвердити замовлення</button>
        <p class="form-status" id="checkout-status" role="status"></p>
      </form>
      <aside class="summary">
        ${rows.map((row) => `<p>${row.promoId ? "Акційний набір" : row.product.name}: ${row.selectedProducts.map((entry) => entry.name).join(", ")} x ${row.quantity}</p>`).join("")}
        <strong>${money.format(rows.reduce((sum, row) => sum + row.product.price * row.quantity, 0))} UAH</strong>
      </aside>
    </section>
  `;
}

function renderLoginPage() {
  app.innerHTML = `
    <section class="login-page">
      <form class="login-card" id="login-form">
        <p class="tiny">Кабінет</p>
        <h1>Увійти</h1>
        <label>Логін<input name="login" type="text" autocomplete="username" required /></label>
        <label>Пароль<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="button dark wide" type="submit">Увійти</button>
        <p class="form-status" id="login-status" role="status"></p>
      </form>
    </section>
  `;
}

function renderDashboardPage() {
  if (!state.adminToken) {
    renderLoginPage();
    return;
  }

  app.innerHTML = `
    <section class="dashboard-head">
      <div>
        <p class="tiny">Кабінет</p>
        <h1>Керування магазином</h1>
      </div>
      <button class="button outline" type="button" data-logout>Вийти</button>
    </section>
    <section class="dashboard-tabs">
      <button class="active" type="button" data-panel="products">Товари</button>
      <button type="button" data-panel="categories">Категорії</button>
      <button type="button" data-panel="orders">Замовлення</button>
    </section>
    <section class="dashboard-panel" id="dashboard-panel">${productsPanel()}</section>
  `;
  setupImageEditors();
}

function productsPanel() {
  return `
    <div class="dashboard-grid">
      <div>
        <h2>Новий товар</h2>
        ${productForm()}
      </div>
      <div class="stack">
        ${state.store.products.map((product) => `<details><summary>${product.name}<span>${money.format(product.price)}</span></summary>${productForm(product)}</details>`).join("")}
      </div>
    </div>
  `;
}

function productForm(product = {}) {
  const isEdit = Boolean(product.id);
  const defaultCategory = product.categoryId || state.store.categories[0]?.id || "anime";
  return `
    <form class="admin-form" data-product-form="${product.id || ""}">
      <label>Назва товару<input name="name" placeholder="Наприклад: Картка Luffy" value="${product.name || ""}" required /></label>
      <label>Опис<textarea name="description" placeholder="Короткий опис товару" required>${product.description || ""}</textarea></label>
      <label>Ціна<input name="price" type="number" min="1" placeholder="149" value="${product.price || 149}" required /></label>
      <input name="categoryId" type="hidden" value="${defaultCategory}" />
      <input name="oldPrice" type="hidden" value="${product.oldPrice || 0}" />
      <input name="stock" type="hidden" value="${product.stock || 999}" />
      <input name="active" type="hidden" value="true" />
      <input name="image" type="hidden" value="${product.image || "/assets/naruto-front.svg"}" />
      <input name="imageData" type="hidden" />
      <div class="image-editor" data-image-editor>
        <label>Фото товару<input name="photoFile" type="file" accept="image/*" /></label>
        <div class="image-editor-stage">
          <canvas width="948" height="600" data-image-canvas></canvas>
        </div>
        <div class="image-tools">
          <label>Масштаб<input name="photoZoom" type="range" min="1" max="3" step="0.01" value="1" /></label>
          <label>Горизонталь<input name="photoX" type="range" min="-100" max="100" step="1" value="0" /></label>
          <label>Вертикаль<input name="photoY" type="range" min="-100" max="100" step="1" value="0" /></label>
        </div>
      </div>
      <button class="button dark" type="submit">${isEdit ? "Зберегти" : "Додати товар"}</button>
      ${isEdit ? `<button class="button danger" type="button" data-delete-product="${product.id}">Видалити</button>` : ""}
    </form>
  `;
}

function categoriesPanel() {
  return `
    <form class="admin-form row-form" id="category-form">
      <input name="name" placeholder="Нова категорія" required />
      <button class="button dark" type="submit">Додати</button>
    </form>
    <div class="stack">
      ${state.store.categories
        .map(
          (category) => `
            <form class="admin-form row-form" data-category-form="${category.id}">
              <input name="name" value="${category.name}" required />
              <button class="button outline" type="submit">Зберегти</button>
              <button class="button danger" type="button" data-delete-category="${category.id}">Видалити</button>
            </form>
          `
        )
        .join("")}
    </div>
  `;
}

function ordersPanel() {
  return state.store.orders.length
    ? `<div class="stack">${state.store.orders
        .map(
          (order) => `
            <article class="order-card ${order.status === "sent" ? "sent" : ""}">
              <div>
                <p>${new Date(order.createdAt).toLocaleString("uk-UA")} · ${order.id}</p>
                <h2>${order.fullName}</h2>
                <p>${order.phone}</p>
                <p>${order.postOffice}</p>
                <p>${order.paymentMethod}</p>
                <ul>${order.items.map((item) => `<li>${formatOrderItem(item)}</li>`).join("")}</ul>
              </div>
              <div>
                <strong>${money.format(order.total)} UAH</strong>
                <button class="button ${order.status === "sent" ? "outline" : "dark"}" type="button" data-order-status="${order.id}">
                  ${order.status === "sent" ? "Повернути" : "Відправлено"}
                </button>
              </div>
            </article>
          `
        )
        .join("")}</div>`
    : `<div class="empty-state">Замовлень поки немає.</div>`;
}

function formatOrderItem(item) {
  const gift = Number(item.giftQuantity || 0);
  if (!gift) return `${item.name} x ${item.quantity}`;
  return `${item.name} · всього ${Number(item.quantity) + gift}, входить у ціну ${item.quantity}, подарунок ${gift}`;
}

function renderRoute() {
  updateCartCount();
  const path = location.pathname;
  if (path === "/" || path === "/catalog") return renderCatalog();
  if (path.startsWith("/product/")) return renderProductPage(decodeURIComponent(path.split("/").pop()));
  if (path === "/cart") return renderCartPage();
  if (path === "/checkout") return renderCheckoutPage();
  if (path === "/login") return state.adminToken ? renderDashboardPage() : renderLoginPage();
  if (path === "/dashboard") {
    if (!state.adminToken) return renderLoginPage();
    if (!state.adminLoaded) {
      loadAdminStore().catch(() => {
        state.adminToken = "";
        sessionStorage.removeItem("adminToken");
        renderLoginPage();
      });
      return;
    }
    return renderDashboardPage();
  }
  renderCatalog();
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-link]");
  if (link) {
    event.preventDefault();
    navigate(new URL(link.href).pathname);
    return;
  }

  const category = event.target.closest("[data-category]");
  if (category) {
    state.activeCategory = category.dataset.category;
    renderCatalog();
    return;
  }

  const step = event.target.closest("[data-step]");
  if (step) {
    const qty = step.closest("[data-qty]");
    const input = qty.querySelector("input");
    input.value = Math.max(1, Math.min(99, Number(input.value || 1) + Number(step.dataset.step)));
    const cartKey = qty.dataset.cartKey;
    const row = cartKey
      ? state.cart.find((item) => (item.bundleKey || item.productId) === cartKey)
      : state.cart.find((item) => item.productId === qty.dataset.qty);
    if (row && location.pathname === "/cart") {
      row.quantity = Number(input.value);
      saveCart();
      renderCartPage();
    }
    return;
  }

  const bundleSelect = event.target.closest("[data-bundle-select]");
  if (bundleSelect) {
    const product = productById(bundleSelect.value);
    const preview = bundleSelect.closest(".bundle-slot")?.querySelector("[data-bundle-preview]");
    if (product && preview) preview.src = product.image;
  }

  const promo = event.target.closest("[data-promo-quantity]");
  if (promo) {
    document.querySelectorAll("[data-promo-quantity]").forEach((card) => card.classList.toggle("selected", card === promo));
    const productId = document.querySelector(".product-page")?.dataset.currentProduct;
    const builder = document.querySelector("#bundle-builder");
    const summary = document.querySelector("#bundle-summary");
    const product = productById(productId);
    const promoData = state.store.promotions.find((entry) => entry.id === promo.dataset.promoId);
    if (builder && product && promoData) builder.innerHTML = renderBundleBuilder(product, promoData);
    if (summary && promoData) summary.innerHTML = renderBundleSummary(promoData);
    return;
  }

  const add = event.target.closest("[data-add]");
  if (add) {
    if (document.querySelector(".product-page")) {
      addBundleToCart(add.dataset.add);
    } else {
      addToCart(add.dataset.add, selectedQuantity(document, add.dataset.add));
    }
    return;
  }

  const buy = event.target.closest("[data-buy]");
  if (buy) {
    let added = false;
    if (document.querySelector(".product-page")) {
      added = addBundleToCart(buy.dataset.buy, true);
    } else {
      added = addToCart(buy.dataset.buy, selectedQuantity(document, buy.dataset.buy), true);
    }
    if (added) navigate("/cart");
    return;
  }

  const remove = event.target.closest("[data-remove]");
  if (remove) {
    state.cart = state.cart.filter((item) => (item.bundleKey || item.productId) !== remove.dataset.remove);
    saveCart();
    renderCartPage();
    return;
  }

  if (event.target.closest("[data-go-checkout]")) navigate("/checkout");
  if (event.target.closest("[data-go-catalog]")) navigate("/catalog");
  if (event.target.closest("[data-modal-catalog]")) {
    orderModal.classList.add("hidden");
    navigate("/catalog");
  }

  const panel = event.target.closest("[data-panel]");
  if (panel) {
    document.querySelectorAll("[data-panel]").forEach((button) => button.classList.toggle("active", button === panel));
    const target = document.querySelector("#dashboard-panel");
    target.innerHTML = panel.dataset.panel === "products" ? productsPanel() : panel.dataset.panel === "categories" ? categoriesPanel() : ordersPanel();
    setupImageEditors();
  }

  if (event.target.closest("[data-logout]")) {
    state.adminToken = "";
    sessionStorage.removeItem("adminToken");
    navigate("/login");
  }

  const deleteProduct = event.target.closest("[data-delete-product]");
  if (deleteProduct) {
    await api(`/api/admin/products/${deleteProduct.dataset.deleteProduct}`, { method: "DELETE" });
    await loadAdminStore();
    notify("Товар видалено.");
  }

  const deleteCategory = event.target.closest("[data-delete-category]");
  if (deleteCategory) {
    await api(`/api/admin/categories/${deleteCategory.dataset.deleteCategory}`, { method: "DELETE" });
    await loadAdminStore();
    notify("Категорію видалено.");
  }

  const orderStatus = event.target.closest("[data-order-status]");
  if (orderStatus) {
    const order = state.store.orders.find((entry) => entry.id === orderStatus.dataset.orderStatus);
    await api(`/api/admin/orders/${orderStatus.dataset.orderStatus}`, {
      method: "PATCH",
      body: JSON.stringify({ status: order?.status === "sent" ? "new" : "sent" })
    });
    await loadAdminStore();
  }
});

document.addEventListener("change", (event) => {
  const bundleSelect = event.target.closest("[data-bundle-select]");
  const photoInput = event.target.closest("[name='photoFile']");
  if (photoInput) {
    loadPhotoFile(photoInput);
    return;
  }

  if (!bundleSelect) return;

  const product = productById(bundleSelect.value);
  const preview = bundleSelect.closest(".bundle-slot")?.querySelector("[data-bundle-preview]");
  const slot = bundleSelect.closest(".bundle-slot");
  if (!preview || !slot) return;

  if (product) {
    preview.outerHTML = `<img src="${product.image}" alt="" data-bundle-preview />`;
    slot.classList.remove("empty");
  } else {
    preview.outerHTML = `<span class="bundle-placeholder" data-bundle-preview>+</span>`;
    slot.classList.add("empty");
  }
});

document.addEventListener("input", (event) => {
  if (event.target.closest("[name='photoZoom'], [name='photoX'], [name='photoY']")) {
    updateImageEditor(event.target.closest("[data-image-editor]"));
  }
});

document.addEventListener("submit", async (event) => {
  const checkout = event.target.closest("#checkout-form");
  if (checkout) {
    event.preventDefault();
    const status = checkout.querySelector("#checkout-status");
    status.textContent = "Оформлюємо замовлення...";
    try {
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ ...Object.fromEntries(new FormData(checkout).entries()), items: state.cart })
      });
      state.cart = [];
      saveCart();
      status.textContent = result.message;
      showOrderModal(result);
    } catch (error) {
      status.textContent = error.message;
    }
    return;
  }

  const login = event.target.closest("#login-form");
  if (login) {
    event.preventDefault();
    const status = login.querySelector("#login-status");
    status.textContent = "Перевіряємо доступ...";
    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(login).entries()))
      });
      state.adminToken = result.token;
      sessionStorage.setItem("adminToken", result.token);
      navigate("/dashboard");
    } catch (error) {
      status.textContent = error.message;
    }
    return;
  }

  const productFormEl = event.target.closest("[data-product-form]");
  if (productFormEl) {
    event.preventDefault();
    const id = productFormEl.dataset.productForm;
    const data = await getProductFormData(productFormEl);
    await api(id ? `/api/admin/products/${id}` : "/api/admin/products", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(data)
    });
    await loadAdminStore();
    notify(id ? "Товар оновлено." : "Товар додано.");
    return;
  }

  const categoryForm = event.target.closest("#category-form");
  if (categoryForm) {
    event.preventDefault();
    await api("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(categoryForm).entries()))
    });
    await loadAdminStore();
    notify("Категорію додано.");
    return;
  }

  const categoryRow = event.target.closest("[data-category-form]");
  if (categoryRow) {
    event.preventDefault();
    await api(`/api/admin/categories/${categoryRow.dataset.categoryForm}`, {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(new FormData(categoryRow).entries()))
    });
    await loadAdminStore();
    notify("Категорію оновлено.");
  }
});

window.addEventListener("popstate", renderRoute);

async function loadAdminStore() {
  state.store = normalizeStore(await api("/api/admin/store"));
  state.adminLoaded = true;
  renderRoute();
}

async function init() {
  state.store = normalizeStore(await api("/api/store"));
  if (location.pathname === "/") {
    history.replaceState({}, "", "/catalog");
  }
  if (state.adminToken) {
    try {
      await loadAdminStore();
    } catch {
      state.adminToken = "";
      sessionStorage.removeItem("adminToken");
    }
  }
  renderRoute();
}

init().catch((error) => {
  app.innerHTML = `<section class="empty-state">${error.message}</section>`;
});

function setupImageEditors() {
  document.querySelectorAll("[data-image-editor]").forEach((editor) => {
    if (editorImages.has(editor)) return;
    const form = editor.closest("form");
    const imagePath = form?.elements.image?.value || "/assets/naruto-front.svg";
    const image = new Image();
    image.onload = () => {
      editorImages.set(editor, image);
      updateImageEditor(editor);
    };
    image.src = imagePath;
  });
}

function loadPhotoFile(input) {
  const file = input.files?.[0];
  const editor = input.closest("[data-image-editor]");
  if (!file || !editor) return;

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      editorImages.set(editor, image);
      updateImageEditor(editor);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function updateImageEditor(editor) {
  if (!editor) return;
  const image = editorImages.get(editor);
  const canvas = editor.querySelector("[data-image-canvas]");
  if (!image || !canvas) return;

  const ctx = canvas.getContext("2d");
  const zoom = Number(editor.querySelector("[name='photoZoom']")?.value || 1);
  const offsetX = Number(editor.querySelector("[name='photoX']")?.value || 0);
  const offsetY = Number(editor.querySelector("[name='photoY']")?.value || 0);
  const cover = Math.max(canvas.width / image.width, canvas.height / image.height) * zoom;
  const width = image.width * cover;
  const height = image.height * cover;
  const x = (canvas.width - width) / 2 + (offsetX / 100) * canvas.width * 0.35;
  const y = (canvas.height - height) / 2 + (offsetY / 100) * canvas.height * 0.35;

  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, x, y, width, height);
}

async function getProductFormData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.active = true;
  data.categoryId = data.categoryId || state.store.categories[0]?.id || "anime";
  data.oldPrice = Number(data.oldPrice || 0);
  data.stock = Number(data.stock || 999);
  delete data.photoFile;
  delete data.photoZoom;
  delete data.photoX;
  delete data.photoY;

  const canvas = form.querySelector("[data-image-canvas]");
  const hasUploadedFile = Boolean(form.elements.photoFile?.files?.length);
  if (canvas && hasUploadedFile) {
    data.imageData = canvas.toDataURL("image/png");
  } else {
    delete data.imageData;
  }

  return data;
}
