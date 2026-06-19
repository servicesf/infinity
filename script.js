const menuBtn = document.getElementById('menuBtn');
const navShell = document.getElementById('navShell');
const pageLinks = document.querySelectorAll('[data-page-link]');
const pages = document.querySelectorAll('.app-page');
const WHATSAPP_NUMBER = '59167236144';

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
let carouselIndex = 0;
let carouselTimer = null;

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

showCarouselSlide(0);
startCarousel();

const metodoInfo = document.getElementById('metodoInfo');
const metodoRadios = document.querySelectorAll('input[name="metodo"]');
const diaSelect = document.getElementById('pDia');

if (diaSelect && diaSelect.options.length <= 1) {
  for (let i = 1; i <= 31; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = String(i);
    diaSelect.appendChild(option);
  }
}

function getMetodoDetalle(metodo) {
  switch (metodo) {
    case 'Tigo Money':
      return {
        resumen: 'Numero Tigo Money: 67236144',
        extra: '<p><strong>Tigo Money:</strong> 67236144</p>'
      };
    case 'QR Bancario':
      return {
        resumen: 'QR Bancario',
        extra: '<p><strong>QR Bancario:</strong> escanea el codigo para pagar.</p><img src="imagenes/WhatsApp Image 2026-02-21 at 22.44.17.jpeg" alt="QR Bancario" class="method-qr"/>'
      };
    case 'Transferencia bancaria':
      return {
        resumen: 'Cuenta bancaria: 10000027518105',
        extra: '<p><strong>Transferencia bancaria:</strong> 10000027518105</p>'
      };
    case 'Efectivo':
      return {
        resumen: 'Pago en efectivo',
        extra: '<p><strong>Efectivo:</strong> pago directo en persona.</p>'
      };
    default:
      return {
        resumen: '',
        extra: '<p>Selecciona un metodo para ver los datos de pago.</p>'
      };
  }
}

function actualizarMetodoInfo() {
  if (!metodoInfo) return;
  const seleccionado = document.querySelector('input[name="metodo"]:checked');
  const detalle = getMetodoDetalle(seleccionado?.value || '');
  metodoInfo.innerHTML = detalle.extra;
  metodoInfo.classList.toggle('show', Boolean(seleccionado));
}

metodoRadios.forEach(radio => radio.addEventListener('change', actualizarMetodoInfo));
actualizarMetodoInfo();

function enviarPago(event) {
  event.preventDefault();

  const nombre = document.getElementById('pNombre')?.value.trim();
  const carnet = document.getElementById('pCarnet')?.value.trim();
  const servicio = document.getElementById('pServicio')?.value;
  const dia = document.getElementById('pDia')?.value;
  const mes = document.getElementById('pMes')?.value;
  const metodo = document.querySelector('input[name="metodo"]:checked');
  const nota = document.getElementById('pNota')?.value.trim();

  if (!metodo) {
    alert('Por favor selecciona un metodo de pago.');
    return;
  }

  const detalleMetodo = getMetodoDetalle(metodo.value);
  const mensaje = [
    '*PAGO DE SERVICIO - INFINIT FLORES*',
    '',
    `Nombre: ${nombre}`,
    `Carnet de identidad: ${carnet}`,
    `Servicio: ${servicio}`,
    `Fecha de pago: Dia ${dia} - ${mes}`,
    `Metodo de pago: ${metodo.value}`,
    detalleMetodo.resumen ? `Dato de pago: ${detalleMetodo.resumen}` : '',
    nota ? `Comprobante/Nota: ${nota}` : '',
    '',
    'Por favor confirmar recepcion del pago. Gracias.'
  ].filter(Boolean).join('\n');

  const formOk = document.getElementById('formOk');
  formOk?.classList.add('show');

  setTimeout(() => {
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`, '_blank');
    document.getElementById('pagoForm')?.reset();
    actualizarMetodoInfo();
    setTimeout(() => formOk?.classList.remove('show'), 2500);
  }, 500);
}

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
    precio: 150,
    estado: 'activo',
    pagadoHasta: '2026-07-18T18:00:00',
    ultimosPagos: [
      { fecha: '2026-06-18', monto: 150, metodo: 'QR Bancario' },
      { fecha: '2026-05-18', monto: 150, metodo: 'Efectivo' }
    ]
  }
];

function remainingServiceTime(dateValue) {
  const end = new Date(dateValue);
  const diff = end - new Date();
  if (Number.isNaN(end.getTime())) return 'Sin fecha';
  if (diff <= 0) return 'Vencido';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return `${days} dias ${hours} horas`;
}

function renderCustomer(customer) {
  const target = document.getElementById('customerResult');
  if (!target) return;

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
  target.innerHTML = `
    <div class="receipt-card">
      <div class="receipt-head">
        <div>
          <span>Recibo de servicio</span>
          <h2>${customer.nombre}</h2>
        </div>
        <strong class="status-chip ${customer.estado}">${customer.estado}</strong>
      </div>
      <div class="receipt-grid">
        <div><span>Plan</span><strong>${customer.plan}</strong></div>
        <div><span>Mensualidad</span><strong>Bs. ${customer.precio}</strong></div>
        <div><span>Restante</span><strong>${remainingServiceTime(customer.pagadoHasta)}</strong></div>
        <div><span>Corte</span><strong>${new Date(customer.pagadoHasta).toLocaleString('es-BO')}</strong></div>
      </div>
      <h3>Ultimos pagos</h3>
      <div class="mini-history">
        ${payments.length ? payments.map(payment => `
          <div><span>${payment.fecha} · ${payment.metodo}</span><strong>Bs. ${payment.monto}</strong></div>
        `).join('') : '<span class="muted">Sin pagos registrados.</span>'}
      </div>
      <a class="btn primary full" href="#pagos" data-page-link="pagos"><i class="fas fa-qrcode"></i> Pagar servicio</a>
    </div>
  `;
}

document.getElementById('clientLookupForm')?.addEventListener('submit', event => {
  event.preventDefault();
  const ci = document.getElementById('lookupCi')?.value.trim();
  const customer = demoCustomers.find(item => item.ci === ci);
  renderCustomer(customer);
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

window.enviarPago = enviarPago;
