const menuBtn = document.getElementById('menuBtn');
const navShell = document.getElementById('navShell');
const pageLinks = document.querySelectorAll('[data-page-link]');
const pages = document.querySelectorAll('.app-page');
const WHATSAPP_NUMBER = '59167236144';

function localApiUrl(path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ? `https://infinity-black-rho.vercel.app${cleanPath}`
    : cleanPath;
}

function showPage(pageName) {
  const target = document.querySelector(`[data-page="${pageName}"]`) ? pageName : 'inicio';

  pages.forEach(page => {
    page.classList.toggle('active', page.dataset.page === target);
  });

  pageLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.pageLink === target);
  });

  if (navShell) navShell.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

pageLinks.forEach(link => {
  link.addEventListener('click', event => {
    const target = link.dataset.pageLink;
    if (!target) return;
    event.preventDefault();
    history.pushState(null, '', `#${target}`);
    showPage(target);
  });
});

document.addEventListener('click', event => {
  const link = event.target.closest('[data-page-link]');
  if (!link || [...pageLinks].includes(link)) return;
  const target = link.dataset.pageLink;
  if (!target) return;
  event.preventDefault();
  history.pushState(null, '', `#${target}`);
  showPage(target);
});

window.addEventListener('popstate', () => {
  showPage(location.hash.replace('#', '') || 'inicio');
});

if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    navShell?.classList.toggle('open');
  });
}

showPage(location.hash.replace('#', '') || 'inicio');

const carouselSlides = document.querySelectorAll('.carousel-slide');
const carouselDots = document.querySelectorAll('#homeCarouselDots button');
const carouselTrack = document.getElementById('homeCarouselTrack');
const carouselPrev = document.getElementById('homeCarouselPrev');
const carouselNext = document.getElementById('homeCarouselNext');
let carouselIndex = 0;
let carouselTimer = null;
let carouselTouchStart = 0;

function showCarouselSlide(index) {
  if (!carouselSlides.length) return;
  carouselIndex = (index + carouselSlides.length) % carouselSlides.length;
  carouselSlides.forEach((slide, slideIndex) => {
    slide.classList.toggle('active', slideIndex === carouselIndex);
  });
  carouselDots.forEach((dot, dotIndex) => {
    dot.classList.toggle('active', dotIndex === carouselIndex);
  });
}

function startCarousel() {
  if (!carouselSlides.length) return;
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => {
    showCarouselSlide(carouselIndex + 1);
  }, 4200);
}

carouselDots.forEach((dot, index) => {
  dot.addEventListener('click', () => {
    showCarouselSlide(index);
    startCarousel();
  });
});

carouselPrev?.addEventListener('click', () => {
  showCarouselSlide(carouselIndex - 1);
  startCarousel();
});

carouselNext?.addEventListener('click', () => {
  showCarouselSlide(carouselIndex + 1);
  startCarousel();
});

carouselTrack?.addEventListener('touchstart', event => {
  carouselTouchStart = event.touches[0]?.clientX || 0;
}, { passive: true });

carouselTrack?.addEventListener('touchend', event => {
  const touchEnd = event.changedTouches[0]?.clientX || 0;
  const distance = carouselTouchStart - touchEnd;
  if (Math.abs(distance) < 45) return;
  showCarouselSlide(carouselIndex + (distance > 0 ? 1 : -1));
  startCarousel();
}, { passive: true });

showCarouselSlide(0);
startCarousel();

const quickTabs = [...document.querySelectorAll('[data-quick-tab]')];
const quickPanels = [...document.querySelectorAll('[data-quick-panel]')];

function showQuickPanel(panelName) {
  quickTabs.forEach(tab => {
    const isActive = tab.dataset.quickTab === panelName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  quickPanels.forEach(panel => {
    const isActive = panel.dataset.quickPanel === panelName;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
}

quickTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showQuickPanel(tab.dataset.quickTab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = quickTabs[(index + direction + quickTabs.length) % quickTabs.length];
    showQuickPanel(nextTab.dataset.quickTab);
    nextTab.focus();
  });
});

if (quickTabs.length) showQuickPanel('ftth');

const productModal = document.getElementById('productModal');
const productModalLabel = document.getElementById('productModalLabel');
const productModalTitle = document.getElementById('productModalTitle');
const productModalDescription = document.getElementById('productModalDescription');
const productModalOptions = document.getElementById('productModalOptions');
let lastProductTrigger = null;

const rechargeProducts = {
  iptv: {
    label: 'IPTV Smarters Pro',
    title: 'Elige tu plan de IPTV',
    description: 'Canales, peliculas y series para tus dispositivos.',
    options: [
      { title: '1 mes', detail: '1 dispositivo', price: 20 },
      { title: '1 mes', detail: '3 dispositivos', price: 30 },
      { title: '7 meses', detail: '1 dispositivo', price: 100 }
    ]
  },
  netflix: {
    label: 'Netflix',
    title: 'Elige tu acceso a Netflix',
    description: 'Disfruta series, peliculas y documentales durante un mes.',
    options: [
      { title: '1 mes', detail: '1 dispositivo', price: 35 },
      { title: '1 mes', detail: 'Cuenta completa', price: 135 }
    ]
  },
  chatgpt: {
    label: 'ChatGPT Plus',
    title: 'Elige tu acceso a ChatGPT Plus',
    description: 'Cuenta compartida. Por favor, no elimines conversaciones de otros usuarios.',
    options: [
      { title: '1 mes', detail: '1 dispositivo · cuenta compartida', price: 30 },
      { title: '1 mes', detail: '2 dispositivos · cuenta compartida', price: 50 }
    ]
  }
};

function openProductModal(productName, trigger) {
  const product = rechargeProducts[productName];
  if (!productModal || !product || !productModalOptions) return;
  lastProductTrigger = trigger;
  productModalLabel.textContent = product.label;
  productModalTitle.textContent = product.title;
  productModalDescription.textContent = product.description;
  productModalOptions.innerHTML = product.options.map(option => {
    const message = `Hola, quiero comprar ${product.label}: ${option.title}, ${option.detail}, a Bs. ${option.price}.`;
    return `
      <article class="recharge-option">
        <div>
          <h3>${option.title}</h3>
          <p>${option.detail}</p>
        </div>
        <strong>Bs. ${option.price}</strong>
        <a class="btn primary" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">Comprar</a>
      </article>
    `;
  }).join('');
  productModal.classList.add('open');
  productModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  productModal.querySelector('.product-modal-close')?.focus();
}

function closeProductModal() {
  if (!productModal) return;
  productModal.classList.remove('open');
  productModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  lastProductTrigger?.focus();
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-product-details]');
  if (trigger) openProductModal(trigger.dataset.productDetails, trigger);
  if (event.target.closest('[data-close-product-modal]')) closeProductModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && productModal?.classList.contains('open')) closeProductModal();
});

const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const chatSend = document.getElementById('chatSend');
const aiFloatBtn = document.getElementById('aiFloatBtn');
const chatWidget = document.getElementById('chatWidget');
const chatClose = document.getElementById('chatClose');

function renderChatMessage(texto, rol, extraClass = '') {
  if (!chatMessages) return null;
  const msg = document.createElement('div');
  msg.className = `chat-msg ${rol}${extraClass ? ` ${extraClass}` : ''}`;
  msg.textContent = texto;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msg;
}

async function enviarMensajeChat(event) {
  event.preventDefault();
  if (!chatInput || !chatSend) return;

  const mensaje = chatInput.value.trim();
  if (!mensaje) return;

  renderChatMessage(mensaje, 'user');
  chatInput.value = '';
  chatInput.disabled = true;
  chatSend.disabled = true;
  const typing = renderChatMessage('Escribiendo...', 'bot', 'typing');

  try {
    const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
      ? 'https://infinity-black-rho.vercel.app/api/chat'
      : '/api/chat';

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: mensaje })
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Respuesta invalida del servidor (${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(data?.error || 'Error al llamar /api/chat');
    }

    typing?.remove();
    renderChatMessage(data?.reply || 'No se pudo generar respuesta.', 'bot');
  } catch (error) {
    typing?.remove();
    renderChatMessage(`Error: ${error.message}`, 'bot');
  } finally {
    chatInput.disabled = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

if (chatForm) {
  chatForm.addEventListener('submit', enviarMensajeChat);
}

const demoCustomers = [
  {
    ci: '12345678',
    nombre: 'Cliente demo',
    plan: 'Fibra 20 Mbps',
    precio: 149,
    estado: 'activo',
    pagadoHasta: '2026-07-18T18:00:00',
    ultimosPagos: [
      { fecha: '2026-06-18', monto: 149, metodo: 'QR Bancario' },
      { fecha: '2026-05-18', monto: 149, metodo: 'Efectivo' }
    ]
  }
];

const CASH_PAYMENT_ADDRESS = 'Final avenida Vernal, una cuadra antes de llegar a FATECIPOL.';
const STATIC_PAYMENT_QR = 'imagenes/QROFICIAL.jpeg';

function manualPaymentDetail(method, amount = 0) {
  const paymentAmount = Number(amount || 0);
  const qrMatchesAmount = paymentAmount === 149;
  const details = {
    'Tigo Money': {
      icon: 'fa-mobile-screen',
      title: 'Tigo Money',
      text: 'Envia el monto al numero 67236144 y guarda la captura o numero de transaccion.'
    },
    'Transferencia bancaria': {
      icon: 'fa-building-columns',
      title: 'Transferencia bancaria',
      text: 'Transfiere a la cuenta 10000027518105 y guarda el comprobante.'
    },
    'QR bancario estatico': {
      icon: 'fa-qrcode',
      title: qrMatchesAmount ? 'QR Banco Union · Bs. 149' : 'QR bancario de Bs. 149',
      text: qrMatchesAmount
        ? 'Valido para pagar tu plan de Internet fibra o inalambrico. Guarda el comprobante.'
        : `Este QR cobra Bs. 149 y tu mensualidad es Bs. ${paymentAmount || 0}. Elige otro metodo o consulta por WhatsApp.`,
      image: qrMatchesAmount ? STATIC_PAYMENT_QR : ''
    },
    'Pago en efectivo': {
      icon: 'fa-money-bill-wave',
      title: 'Pago en efectivo',
      text: CASH_PAYMENT_ADDRESS
    }
  };
  return details[method] || details['Tigo Money'];
}

function renderManualPaymentDetail(method, amount = 0) {
  const detail = manualPaymentDetail(method, amount);
  return `
    <div class="manual-payment-detail">
      <div class="manual-payment-detail-head">
        <i class="fas ${detail.icon}" aria-hidden="true"></i>
        <div><strong>${detail.title}</strong><span>${detail.text}</span></div>
      </div>
      ${detail.image ? `
        <figure class="qr-payment-visual">
          <a href="${detail.image}" target="_blank" rel="noopener" aria-label="Abrir QR bancario en tamano completo">
            <img src="${detail.image}" alt="QR Banco Union de Bs. 149 para pagar el servicio Infinit" loading="lazy" decoding="async"/>
          </a>
          <figcaption>Monto fijo: Bs. 149 · Fibra e inalambrico</figcaption>
          <a class="btn light qr-download" href="${detail.image}" download="QR-Infinit-Bs149.jpeg"><i class="fas fa-download"></i> Guardar QR</a>
        </figure>
      ` : ''}
    </div>
  `;
}

function remainingServiceTime(dateValue) {
  const end = new Date(dateValue);
  const diff = end - new Date();
  if (Number.isNaN(end.getTime())) return 'Sin fecha';
  if (diff <= 0) return 'Vencido';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${days} dias ${hours} horas`;
}

function formatDateTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function customerMessage(customer) {
  const remaining = remainingServiceTime(customer.pagadoHasta);
  if (remaining === 'Vencido') {
    return 'Tu servicio esta vencido. Puedes pagar con QR para reactivar tu conexion.';
  }
  if (customer.estado === 'cortado') {
    return 'Tu servicio esta cortado. Realiza tu pago y la activacion quedara en proceso.';
  }
  return `Tu servicio esta activo. Te quedan ${remaining}. Gracias por estar conectado con Infinit.`;
}

function setCustomerPortalLoaded(loaded) {
  document.getElementById('page-cliente')?.classList.toggle('customer-loaded', loaded);
}

function renderCustomer(customer) {
  const target = document.getElementById('customerResult');
  if (!target) return;

  setCustomerPortalLoaded(Boolean(customer));

  if (!customer) {
    target.innerHTML = `
      <div class="empty-state danger">
        <i class="fas fa-circle-exclamation"></i>
        <strong>No encontramos ese carnet</strong>
        <span>Verifica el dato o consulta por WhatsApp.</span>
      </div>
    `;
    return;
  }

  const payments = customer.ultimosPagos || [];
  const estado = escapeHtml(customer.estado || '');
  const qrEligible = Number(customer.precio || 0) === 149;
  const defaultPaymentMethod = qrEligible ? 'QR bancario estatico' : 'Tigo Money';
  const serviceLabel = customer.sector === 'inalambrico'
    ? 'Mi servicio de Internet inalambrico'
    : 'Mi servicio de fibra';
  target.innerHTML = `
    <div class="receipt-card">
      <div class="receipt-head">
        <div>
          <span>${serviceLabel}</span>
          <h2>${escapeHtml(customer.nombre)}</h2>
        </div>
        <strong class="status-chip ${estado}">${estado}</strong>
      </div>
      <div class="service-message">
        <i class="fas fa-wifi"></i>
        <span>${escapeHtml(customerMessage(customer))}</span>
      </div>
      <div class="receipt-grid">
        <div><span>Plan</span><strong>${escapeHtml(customer.plan)}</strong></div>
        <div><span>Mensualidad</span><strong>Bs. ${escapeHtml(customer.precio)}</strong></div>
        <div><span>Restante</span><strong>${remainingServiceTime(customer.pagadoHasta)}</strong></div>
        <div><span>Corte</span><strong>${formatDateTime(customer.pagadoHasta)}</strong></div>
      </div>
      <h3>Ultimos pagos</h3>
      <div class="mini-history">
        ${payments.length ? payments.map(payment => `
          <div><span>${formatDateTime(payment.fecha)} · ${escapeHtml(payment.metodo)}</span><strong>Bs. ${escapeHtml(payment.monto)}</strong></div>
        `).join('') : '<span class="muted">Sin pagos registrados.</span>'}
      </div>
      <section class="manual-payment" aria-labelledby="manualPaymentTitle">
        <div class="manual-payment-heading">
          <div>
            <span>Pago manual</span>
            <h3 id="manualPaymentTitle">Elige como quieres pagar</h3>
          </div>
          <span class="review-chip"><i class="fas fa-user-check"></i> Revision manual</span>
        </div>
        <p class="manual-payment-intro">Despues de pagar, envia los datos por WhatsApp y adjunta tu comprobante. La recarga se realiza solo despues de verificar el pago.</p>
        <form class="customer-payment-form" data-customer-payment-form>
          <input type="hidden" name="customerName" value="${escapeHtml(customer.nombre)}"/>
          <input type="hidden" name="customerCi" value="${escapeHtml(customer.ci)}"/>
          <input type="hidden" name="customerPlan" value="${escapeHtml(customer.plan)}"/>
          <input type="hidden" name="customerAmount" value="${escapeHtml(customer.precio)}"/>
          <fieldset class="customer-payment-methods">
            <legend>Metodo de pago</legend>
            <label><input type="radio" name="manualMethod" value="Tigo Money" ${qrEligible ? '' : 'checked'}/><span><i class="fas fa-mobile-screen"></i>Tigo Money</span></label>
            <label><input type="radio" name="manualMethod" value="Transferencia bancaria"/><span><i class="fas fa-building-columns"></i>Transferencia</span></label>
            <label><input type="radio" name="manualMethod" value="QR bancario estatico" ${qrEligible ? 'checked' : ''}/><span><i class="fas fa-qrcode"></i>QR bancario</span></label>
            <label><input type="radio" name="manualMethod" value="Pago en efectivo"/><span><i class="fas fa-money-bill-wave"></i>Efectivo</span></label>
          </fieldset>
          <div data-manual-payment-detail>${renderManualPaymentDetail(defaultPaymentMethod, customer.precio)}</div>
          <label class="customer-reference">
            <span>Referencia o numero de transaccion</span>
            <input name="paymentReference" type="text" maxlength="100" placeholder="Ejemplo: 458721 o Pago en efectivo" required/>
            <small>No escribas datos bancarios sensibles. Solo la referencia del pago.</small>
          </label>
          <button class="btn whatsapp full" type="submit"><i class="fab fa-whatsapp"></i> Enviar comprobante por WhatsApp</button>
          <p class="payment-warning"><i class="fas fa-circle-info"></i> WhatsApp se abrira con tus datos. Adjunta alli la foto o captura del comprobante.</p>
        </form>
      </section>
    </div>
  `;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

document.getElementById('clientLookupForm')?.addEventListener('submit', event => {
  event.preventDefault();
  const ci = document.getElementById('lookupCi')?.value.trim();
  lookupCustomer(ci);
});

async function lookupCustomer(ci) {
  const target = document.getElementById('customerResult');
  if (!target) return;

  setCustomerPortalLoaded(false);
  target.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-spinner fa-spin"></i>
      <strong>Consultando servicio</strong>
      <span>Estamos revisando tus datos.</span>
    </div>
  `;

  try {
    const response = await fetch(localApiUrl(`/api/customer?ci=${encodeURIComponent(ci)}`));
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const fallback = demoCustomers.find(item => item.ci === ci);
      if (fallback) return renderCustomer(fallback);
      throw new Error(data?.error || 'No se pudo consultar el servicio.');
    }

    renderCustomer(data.customer);
  } catch (error) {
    setCustomerPortalLoaded(false);
    target.innerHTML = `
      <div class="empty-state danger">
        <i class="fas fa-circle-exclamation"></i>
        <strong>No pudimos consultar ahora</strong>
        <span>${error.message}</span>
      </div>
    `;
  }
}

document.addEventListener('change', event => {
  const method = event.target.closest('input[name="manualMethod"]');
  if (!method) return;
  const form = method.closest('[data-customer-payment-form]');
  const target = form?.querySelector('[data-manual-payment-detail]');
  const amount = form?.querySelector('input[name="customerAmount"]')?.value || 0;
  if (target) target.innerHTML = renderManualPaymentDetail(method.value, amount);
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-customer-payment-form]');
  if (!form) return;
  event.preventDefault();

  const formData = new FormData(form);
  const method = String(formData.get('manualMethod') || '');
  const reference = String(formData.get('paymentReference') || '').trim();
  const message = [
    '*COMPROBANTE DE PAGO - INFINIT*',
    '',
    `Nombre: ${formData.get('customerName') || ''}`,
    `Carnet: ${formData.get('customerCi') || ''}`,
    `Plan: ${formData.get('customerPlan') || ''}`,
    `Monto: Bs. ${formData.get('customerAmount') || '0'}`,
    `Metodo: ${method}`,
    `Referencia: ${reference}`,
    '',
    'Adjuntare el comprobante en este chat.',
    'Solicito la revision manual de mi pago y la recarga del servicio.'
  ].join('\n');

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
});

const cart = {
  items: [],
  coupon: null
};
let products = [];
let activeShopFilter = 'todos';

const coupons = {
  INFINIT10: { type: 'percent', value: 10 },
  HGW20: { type: 'percent', value: 20, category: 'hgw' }
};

function money(value) {
  return `Bs. ${Number(value || 0).toFixed(0)}`;
}

function filteredProducts() {
  return activeShopFilter === 'todos'
    ? products
    : products.filter(product => product.categoria === activeShopFilter);
}

function renderProducts() {
  const grid = document.getElementById('storeGrid');
  if (!grid) return;

  grid.innerHTML = filteredProducts().map(product => `
    <article class="store-card">
      <img src="${product.imagen}" alt="${product.nombre}"/>
      <span>${product.marca}</span>
      <h3>${product.nombre}</h3>
      <p>${product.descripcion}</p>
      <strong>${money(product.precio)}</strong>
      <button class="btn primary full" type="button" data-add-product="${product.id}">
        <i class="fas fa-cart-plus"></i> Agregar
      </button>
    </article>
  `).join('');
}

function cartSubtotal() {
  return cart.items.reduce((total, item) => total + item.precio * item.qty, 0);
}

function cartDiscount() {
  if (!cart.coupon) return 0;
  const coupon = coupons[cart.coupon];
  if (!coupon) return 0;
  const base = cart.items.reduce((total, item) => {
    if (coupon.category && item.categoria !== coupon.category) return total;
    return total + item.precio * item.qty;
  }, 0);
  return coupon.type === 'percent' ? Math.round(base * coupon.value / 100) : coupon.value;
}

function renderCart() {
  const itemsBox = document.getElementById('cartItems');
  const count = document.getElementById('cartCount');
  const subtotalEl = document.getElementById('cartSubtotal');
  const discountEl = document.getElementById('cartDiscount');
  const totalEl = document.getElementById('cartTotal');
  if (!itemsBox) return;

  const subtotal = cartSubtotal();
  const discount = cartDiscount();
  const total = Math.max(subtotal - discount, 0);
  const totalItems = cart.items.reduce((sum, item) => sum + item.qty, 0);

  count.textContent = `${totalItems} item${totalItems === 1 ? '' : 's'}`;
  subtotalEl.textContent = money(subtotal);
  discountEl.textContent = money(discount);
  totalEl.textContent = money(total);

  itemsBox.innerHTML = cart.items.length ? cart.items.map(item => `
    <div class="cart-item">
      <div>
        <strong>${item.nombre}</strong>
        <span>${item.qty} x ${money(item.precio)}</span>
      </div>
      <div class="qty-actions">
        <button type="button" data-cart-minus="${item.id}">-</button>
        <button type="button" data-cart-plus="${item.id}">+</button>
      </div>
    </div>
  `).join('') : '<span class="muted">Tu carrito esta vacio.</span>';
}

function addToCart(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  const current = cart.items.find(item => item.id === productId);
  if (current) {
    current.qty += 1;
  } else {
    cart.items.push({ ...product, qty: 1 });
  }
  renderCart();
}

function changeCartQty(productId, delta) {
  const item = cart.items.find(product => product.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart.items = cart.items.filter(product => product.id !== productId);
  renderCart();
}

async function loadProducts() {
  try {
    const response = await fetch('data/productos.json');
    products = await response.json();
  } catch {
    products = [];
  }
  renderProducts();
  renderCart();
}

document.getElementById('shopFilters')?.addEventListener('click', event => {
  const button = event.target.closest('[data-shop-filter]');
  if (!button) return;
  activeShopFilter = button.dataset.shopFilter;
  document.querySelectorAll('[data-shop-filter]').forEach(item => {
    item.classList.toggle('active', item === button);
  });
  renderProducts();
});

document.getElementById('storeGrid')?.addEventListener('click', event => {
  const button = event.target.closest('[data-add-product]');
  if (button) addToCart(button.dataset.addProduct);
});

document.getElementById('cartItems')?.addEventListener('click', event => {
  const plus = event.target.closest('[data-cart-plus]');
  const minus = event.target.closest('[data-cart-minus]');
  if (plus) changeCartQty(plus.dataset.cartPlus, 1);
  if (minus) changeCartQty(minus.dataset.cartMinus, -1);
});

document.getElementById('applyCouponBtn')?.addEventListener('click', () => {
  const code = document.getElementById('couponInput')?.value.trim().toUpperCase();
  if (!code || !coupons[code]) {
    alert('Cupon no valido.');
    return;
  }
  cart.coupon = code;
  renderCart();
});

document.getElementById('sendCartBtn')?.addEventListener('click', () => {
  if (!cart.items.length) {
    alert('Agrega productos al carrito.');
    return;
  }
  const subtotal = cartSubtotal();
  const discount = cartDiscount();
  const total = Math.max(subtotal - discount, 0);
  const lines = cart.items.map(item => `- ${item.nombre} x${item.qty}: ${money(item.precio * item.qty)}`);
  const message = [
    '*PEDIDO TIENDA INFINIT*',
    '',
    ...lines,
    '',
    `Subtotal: ${money(subtotal)}`,
    cart.coupon ? `Cupon: ${cart.coupon}` : '',
    `Descuento: ${money(discount)}`,
    `Total: ${money(total)}`,
    '',
    'Quiero confirmar disponibilidad y forma de pago.'
  ].filter(Boolean).join('\n');
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
});

loadProducts();

function toggleChatWidget(forceOpen = null) {
  if (!chatWidget) return;
  const open = forceOpen === null ? !chatWidget.classList.contains('open') : forceOpen;
  chatWidget.classList.toggle('open', open);
  chatWidget.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) chatInput?.focus();
}

aiFloatBtn?.addEventListener('click', () => toggleChatWidget());
chatClose?.addEventListener('click', () => toggleChatWidget(false));
