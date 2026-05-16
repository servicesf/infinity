const menuBtn = document.getElementById('menuBtn');
const navShell = document.getElementById('navShell');
const pageLinks = document.querySelectorAll('[data-page-link]');
const pages = document.querySelectorAll('.app-page');

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
    window.open(`https://wa.me/59167236144?text=${encodeURIComponent(mensaje)}`, '_blank');
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
