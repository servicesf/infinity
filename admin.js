const state = {
  clients: [],
  payments: [],
  selectedId: null,
  authenticated: false,
  statusFilter: 'todos',
  routerFilter: 'todos',
  currentReceiptId: null,
  installPrompt: null
};

const planPrices = {
  'Fibra 7 Mbps': 95,
  'Fibra 10 Mbps': 95,
  'Fibra 20 Mbps': 120,
  'Fibra 25 Mbps': 120,
  'Fibra 40 Mbps': 150,
  'Fibra 50 Mbps': 149,
  'Fibra 50 Mbps + TV': 160,
  'Fibra 100 Mbps': 200,
  'Fibra 200 Mbps': 300,
  'Inalambrico 50 Mbps': 149
};

const els = {
  tbody: document.getElementById('clientsTbody'),
  detail: document.getElementById('clientDetail'),
  search: document.getElementById('searchInput'),
  stats: {
    total: document.getElementById('statTotal'),
    active: document.getElementById('statActive'),
    expired: document.getElementById('statExpired'),
    rb4011: document.getElementById('statRb4011'),
    rb750: document.getElementById('statRb750'),
    e50ug: document.getElementById('statE50ug')
  },
  dialog: document.getElementById('clientDialog'),
  form: document.getElementById('clientForm'),
  ciDialog: document.getElementById('ciDialog'),
  ciForm: document.getElementById('ciForm'),
  scheduleDialog: document.getElementById('scheduleDialog'),
  scheduleForm: document.getElementById('scheduleForm'),
  receiptInbox: document.getElementById('receiptInbox'),
  receiptInboxList: document.getElementById('receiptInboxList'),
  receiptDialog: document.getElementById('receiptDialog'),
  receiptReviewBody: document.getElementById('receiptReviewBody'),
  receiptReviewActions: document.getElementById('receiptReviewActions'),
  receiptHistoryDialog: document.getElementById('receiptHistoryDialog'),
  receiptHistoryList: document.getElementById('receiptHistoryList')
};

const authEls = {
  loginForm: document.getElementById('loginForm'),
  loginUser: document.getElementById('loginUser'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError')
};

const incomeGrid = document.getElementById('incomeGrid');
const toolsMenu = document.querySelector('.tools-menu');
const toolsMenuBtn = document.getElementById('toolsMenuBtn');
const chartDialog = document.getElementById('chartDialog');
const incomeMonth = document.getElementById('incomeMonth');
const sectorToggleBtn = document.getElementById('sectorToggleBtn');
const sectorPicker = document.getElementById('sectorPicker');

function monthValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function paymentMonth(payment) {
  const date = new Date(payment.paid_at || payment.created_at || '');
  return Number.isNaN(date.getTime()) ? '' : monthValue(date);
}

function formatMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return 'Este mes';
  const date = new Date(`${value}-01T12:00:00`);
  const label = date.toLocaleDateString('es-BO', { month: 'long', year: 'numeric' });
  return `${label.charAt(0).toLocaleUpperCase('es')}${label.slice(1)}`;
}

incomeMonth.value = monthValue();

function setLoggedIn(loggedIn) {
  state.authenticated = loggedIn;
  document.body.classList.toggle('admin-locked', !loggedIn);
  authEls.loginError.classList.remove('show');
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Servidor no actualizado (${response.status}).`);
  }

  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  return readJsonResponse(response);
}

function formatMoney(value) {
  return `Bs. ${Number(value || 0).toFixed(0)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function isPlaceholderCi(value) {
  const ci = String(value || '').trim();
  return ci.toUpperCase().startsWith('SIN-CI-')
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ci);
}

function formatCi(value) {
  const ci = String(value || '').trim();
  return !ci || isPlaceholderCi(ci) ? 'sin CI' : `CI ${ci}`;
}

function formatPersonName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return 'Sin nombre';
  return name.split(' ').map(word => word.split('-').map(part => {
    if (!part) return '';
    return `${part.charAt(0).toLocaleUpperCase('es')}${part.slice(1).toLocaleLowerCase('es')}`;
  }).join('-')).join(' ');
}

function formatDateTime(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toLocalDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function countdownParts(client) {
  if (client.estado === 'cortado') {
    return { label: 'Cortado', detail: 'sin vencimiento', tone: 'danger', dateLabel: 'Sin fecha' };
  }
  const due = new Date(client.dueAt || client.pagadoHasta || '');
  if (Number.isNaN(due.getTime())) return { label: 'Sin fecha', detail: 'sin vencimiento', tone: '', dateLabel: 'Sin fecha' };
  const diff = due - new Date();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const label = `${days}d ${hours}h`;
  return {
    label: diff < 0 ? 'Vencido' : label,
    detail: diff < 0 ? `vencido hace ${label}` : `${label} restantes`,
    tone: diff < 0 ? 'danger' : days <= 3 ? 'warning' : '',
    dateLabel: formatDateTime(client.dueAt)
  };
}

function getEffectiveStatus(client) {
  if (client.estado === 'cortado') return 'cortado';
  const due = new Date(client.dueAt || '');
  if (!Number.isNaN(due.getTime()) && due < new Date()) return 'vencido';
  return client.estado || 'activo';
}

function routerKey(client) {
  return client.router?.code || client.routerId || 'sin-router';
}

function routerName(client) {
  return client.router?.name || 'Router sin asignar';
}

function filteredClients() {
  const q = els.search.value.trim().toLowerCase();
  return state.clients.filter(client => {
    const status = getEffectiveStatus(client);
    const text = [
      client.nombre,
      client.ci,
      client.telefono,
      client.pppoe,
      client.ip,
      client.plan,
      client.sector,
      client.router?.name,
      client.router?.code
    ].join(' ').toLowerCase();

    const matchesStatus = state.statusFilter === 'todos'
      || status === state.statusFilter
      || (state.statusFilter === 'vencido' && status === 'cortado');
    return (!q || text.includes(q))
      && matchesStatus
      && (state.routerFilter === 'todos' || routerGroup(client) === state.routerFilter);
  });
}

function routerGroup(client) {
  const text = `${client.router?.code || ''} ${client.router?.name || ''}`.toLowerCase();
  if (text.includes('rb4011')) return 'rb4011';
  if (text.includes('rb750')) return 'rb750';
  if (text.includes('e50ug')) return 'e50ug';
  return 'otro';
}

function shortRouterName(client) {
  const group = routerGroup(client);
  if (group === 'rb4011') return 'RB4011';
  if (group === 'rb750') return 'RB750';
  if (group === 'e50ug') return 'E50UG';
  return client.router?.code || client.router?.name || 'Sin router';
}

function renderStats() {
  const statuses = state.clients.map(getEffectiveStatus);
  const routerCounts = { rb4011: 0, rb750: 0, e50ug: 0 };
  state.clients.forEach(client => {
    const group = routerGroup(client);
    if (group in routerCounts) routerCounts[group] += 1;
  });

  els.stats.total.textContent = state.clients.length;
  els.stats.active.textContent = statuses.filter(status => status === 'activo').length;
  els.stats.expired.textContent = statuses.filter(status => status === 'vencido' || status === 'cortado').length;
  els.stats.rb4011.textContent = routerCounts.rb4011;
  els.stats.rb750.textContent = routerCounts.rb750;
  els.stats.e50ug.textContent = routerCounts.e50ug;
}

function syncStatFilterState() {
  document.querySelectorAll('[data-stat-filter]').forEach(card => {
    const selected = card.dataset.statFilter === state.statusFilter;
    card.classList.toggle('active', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-router-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.routerFilter === state.routerFilter);
  });
  sectorToggleBtn.classList.toggle('active', state.routerFilter !== 'todos');
  document.getElementById('sectorSelectionLabel').textContent = state.routerFilter === 'todos'
    ? 'Seleccionar equipo'
    : state.routerFilter.toUpperCase();
}

function renderIncome() {
  const selectedMonth = incomeMonth.value || monthValue();
  if (!incomeMonth.value) incomeMonth.value = selectedMonth;
  const confirmed = state.payments
    .filter(payment => payment.status === 'confirmado' && paymentMonth(payment) === selectedMonth)
    .sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at));
  const total = confirmed.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const monthLabel = formatMonth(selectedMonth);
  document.getElementById('incomeTotal').textContent = formatMoney(total);
  document.getElementById('incomePaymentCount').textContent = confirmed.length === 1
    ? '1 pago confirmado'
    : `${confirmed.length} pagos confirmados`;
  document.getElementById('incomePeriodLabel').textContent = `Ganancias de ${monthLabel}`;
  document.getElementById('incomeHistoryTitle').textContent = `Pagos de ${monthLabel}`;
  incomeGrid.innerHTML = confirmed.map(payment => {
    const customer = receiptCustomer(payment);
    return `
      <article class="income-history-item">
        <div class="income-history-person">
          <strong>${escapeHtml(formatPersonName(customer?.nombre || 'Cliente eliminado'))}</strong>
          <span>${escapeHtml(formatCi(customer?.ci))}</span>
        </div>
        <div class="income-history-payment">
          <strong>${formatMoney(payment.amount)}</strong>
          <span>${formatDateTime(payment.paid_at || payment.created_at)}</span>
          <small>${escapeHtml(payment.method || 'manual')}</small>
        </div>
      </article>`;
  }).join('') || '<div class="income-empty"><strong>Sin pagos</strong><span>No hay pagos confirmados en este mes.</span></div>';
}

function receiptCustomer(payment) {
  return state.clients.find(client => client.id === payment.customer_id) || null;
}

function renderReceiptInbox() {
  const pending = state.payments
    .filter(payment => payment.status === 'pendiente' && payment.qr_payload?.source === 'customer-receipt')
    .sort((a, b) => new Date(b.created_at || b.paid_at) - new Date(a.created_at || a.paid_at));
  document.getElementById('pendingReceiptCount').textContent = pending.length;
  els.receiptInbox.classList.toggle('is-empty', pending.length === 0);
  if (!pending.length) {
    els.receiptInboxList.innerHTML = `
      <div class="receipt-inbox-empty">
        <i class="fas fa-circle-check"></i>
        <span>No hay comprobantes pendientes.</span>
      </div>`;
    return;
  }

  els.receiptInboxList.innerHTML = pending.map(payment => {
    const customer = receiptCustomer(payment);
    return `
      <article class="receipt-inbox-card" data-receipt-id="${escapeHtml(payment.id)}">
        <div class="receipt-inbox-card-head">
          <div>
            <strong>${escapeHtml(formatPersonName(customer?.nombre || 'Cliente'))}</strong>
            <span>${escapeHtml(formatCi(customer?.ci))}</span>
            <time datetime="${escapeHtml(payment.created_at || payment.paid_at || '')}">${formatDateTime(payment.created_at || payment.paid_at)}</time>
          </div>
        </div>
        <button class="btn primary full" type="button" data-receipt-action="view"><i class="fas fa-receipt"></i> Revisar comprobante</button>
      </article>`;
  }).join('');
}

function receiptStatus(payment) {
  if (payment.status === 'confirmado') return { label: 'Confirmado', className: 'confirmed' };
  if (payment.status === 'rechazado') return { label: 'Rechazado', className: 'rejected' };
  return { label: 'Pendiente', className: 'pending' };
}

function renderReceiptHistory() {
  const receipts = state.payments
    .filter(payment => payment.qr_payload?.source === 'customer-receipt')
    .sort((a, b) => new Date(b.created_at || b.paid_at) - new Date(a.created_at || a.paid_at));

  if (!receipts.length) {
    els.receiptHistoryList.innerHTML = `
      <div class="receipt-history-empty">
        <i class="fas fa-receipt"></i>
        <strong>Sin comprobantes todavía</strong>
        <span>Cuando un cliente envíe uno, aparecerá aquí.</span>
      </div>`;
    return;
  }

  els.receiptHistoryList.innerHTML = receipts.map(payment => {
    const customer = receiptCustomer(payment);
    const status = receiptStatus(payment);
    return `
      <article class="receipt-history-item" data-history-receipt-id="${escapeHtml(payment.id)}">
        <div class="receipt-history-main">
          <strong>${escapeHtml(formatPersonName(customer?.nombre || 'Cliente'))}</strong>
          <span>${escapeHtml(formatCi(customer?.ci))} · ${formatDateTime(payment.created_at || payment.paid_at)}</span>
        </div>
        <div class="receipt-history-meta">
          <strong>${formatMoney(payment.amount)}</strong>
          <span class="receipt-status ${status.className}">${status.label}</span>
        </div>
        <button class="mini-btn" type="button" data-history-receipt-action="view">
          <i class="fas fa-eye"></i> Ver comprobante
        </button>
      </article>`;
  }).join('');
}

function renderClients() {
  const clients = filteredClients();
  els.tbody.innerHTML = clients.map(client => {
    const selected = client.id === state.selectedId ? 'selected' : '';
    const status = getEffectiveStatus(client);
    const countdown = countdownParts(client);
    return `
      <article class="client-card ${selected}" data-id="${client.id}">
        <div class="client-card-head">
          <div>
          <strong>${formatPersonName(client.nombre)}</strong>
          </div>
          <span class="state-pill ${status}">${status}</span>
        </div>
        <div class="client-service-line">
          <small class="router-chip"><i class="fas fa-server"></i>${shortRouterName(client)}</small>
          <strong>${client.plan}</strong>
        </div>
        <div class="client-card-foot">
          <span class="client-card-ci"><i class="fas fa-id-card"></i>${formatCi(client.ci)}</span>
          <div class="client-due">
          <strong class="${countdown.tone}">${countdown.label}</strong>
          <small>${countdown.dateLabel}</small>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderDetail() {
  const client = state.clients.find(item => item.id === state.selectedId);
  els.detail.classList.toggle('is-empty', !client);
  if (!client) {
    els.detail.innerHTML = `
      <div class="empty-detail">
        <i class="fas fa-user-check"></i>
        <strong>Selecciona un cliente</strong>
        <span>Veras recargas, cortes, historial y datos del servicio.</span>
      </div>
    `;
    return;
  }

  const status = getEffectiveStatus(client);
  const countdown = countdownParts(client);
  const payments = client.historial || [];
  const dueTitle = status === 'cortado' ? 'Servicio' : 'Vence';
  els.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${formatPersonName(client.nombre)}</h3>
        <p>${shortRouterName(client)} · ${client.plan} · <strong>${formatCi(client.ci)}</strong></p>
      </div>
      <span class="state-pill ${status}">${status}</span>
    </div>

    <div class="detail-grid compact">
      <div class="detail-summary ${countdown.tone}">
        <span>${dueTitle}</span>
        <strong>${countdown.label}</strong>
        <small>${countdown.dateLabel}</small>
      </div>
      <div class="detail-item"><span>Mensualidad</span><strong>${formatMoney(client.precio)}</strong></div>
      <div class="detail-item"><span>Corte auto</span><strong>${client.autoCutEnabled ? 'Activado' : 'No'}</strong></div>
    </div>

    <div class="detail-actions">
      <button class="btn primary" type="button" data-detail-action="recharge"><i class="fas fa-money-bill-wave"></i> Recargar 30d</button>
      <button class="btn ghost" type="button" data-detail-action="schedule-cut"><i class="fas fa-calendar-check"></i> Programar corte</button>
      <button class="btn ghost" type="button" data-detail-action="update-ci"><i class="fas fa-id-card"></i> Nombre y carnet</button>
      <button class="btn danger" type="button" data-detail-action="delete"><i class="fas fa-trash"></i> Eliminar</button>
    </div>

    <div class="payment-history">
      <h4>Ultimos pagos</h4>
      ${payments.length ? payments.map(payment => `
        <div class="payment-line">
          <span>${formatDateTime(payment.fecha)}</span>
          <strong>${formatMoney(payment.monto)}</strong>
          <small>${payment.metodo || payment.tipo || 'manual'} · ${payment.estado || ''}</small>
        </div>
      `).join('') : '<p>Sin pagos registrados todavia.</p>'}
    </div>
  `;
}

function renderAll() {
  renderStats();
  renderIncome();
  renderReceiptInbox();
  renderReceiptHistory();
  renderClients();
  renderDetail();
}

async function openReceiptDialog(id) {
  els.receiptReviewBody.innerHTML = '<div class="receipt-loading"><i class="fas fa-spinner fa-spin"></i> Cargando comprobante...</div>';
  els.receiptReviewActions.hidden = true;
  state.currentReceiptId = id;
  els.receiptDialog.showModal();
  try {
    const data = await api(`/api/qr-create?mode=receipt-review&id=${encodeURIComponent(id)}`);
    const payment = data.payment;
    const customer = data.customer || receiptCustomer(payment);
    const analysis = payment.qr_payload?.analysis || {};
    const isPending = payment.status === 'pendiente';
    const status = receiptStatus(payment);
    document.getElementById('receiptDialogSubtitle').textContent = `${formatPersonName(customer?.full_name || customer?.nombre || 'Cliente')} · ${customer?.ci ? `CI ${customer.ci}` : 'sin CI'}`;
    els.receiptReviewActions.hidden = !isPending;
    els.receiptReviewBody.innerHTML = `
      <img class="receipt-review-image" src="${escapeHtml(data.imageUrl)}" alt="Comprobante enviado por el cliente"/>
      <div class="receipt-review-data">
        <div><span>Revisión</span><strong class="receipt-status ${status.className}">${status.label}</strong></div>
        <div><span>Fecha del pago</span><strong>${formatDateTime(analysis.transactionDate || payment.created_at || payment.paid_at)}</strong></div>
      </div>`;
  } catch (error) {
    els.receiptReviewBody.innerHTML = `<div class="receipt-loading error"><i class="fas fa-circle-exclamation"></i>${escapeHtml(error.message)}</div>`;
  }
}

async function reviewReceipt(decision) {
  const id = state.currentReceiptId;
  if (!id) return;
  const payment = state.payments.find(item => item.id === id);
  const customer = receiptCustomer(payment || {});
  const verb = decision === 'confirm'
    ? `Confirmar este pago y recargar 30 días + 3 horas a ${formatPersonName(customer?.nombre || 'este cliente')}?`
    : `Rechazar el comprobante de ${formatPersonName(customer?.nombre || 'este cliente')}? No se recargará el servicio.`;
  if (!confirm(verb)) return;
  const buttons = [document.getElementById('confirmReceiptBtn'), document.getElementById('rejectReceiptBtn')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await api('/api/qr-create?mode=receipt-review', {
      method: 'POST',
      body: JSON.stringify({ id, decision, note: '' })
    });
    els.receiptDialog.close();
    state.currentReceiptId = null;
    await loadData();
    alert(decision === 'confirm'
      ? 'Pago confirmado. Se agregaron 30 días + 3 horas y la acción quedó enviada al worker.'
      : 'Comprobante rechazado y decisión registrada.');
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

async function registerPanelApp() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/service-worker.js');
}

async function enablePushNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) throw new Error('Este navegador no admite notificaciones push.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No se otorgó permiso para notificaciones.');
  const registration = await registerPanelApp();
  const config = await api('/api/qr-create?mode=push-subscribe');
  if (!config.enabled || !config.publicKey) throw new Error('Las notificaciones todavía no tienen claves VAPID configuradas en Vercel.');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
  }
  await api('/api/qr-create?mode=push-subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  return true;
}

function renderFilteredClients() {
  const visibleClients = filteredClients();
  if (!visibleClients.some(client => client.id === state.selectedId)) {
    state.selectedId = null;
  }
  renderClients();
  renderDetail();
  syncStatFilterState();
}

async function loadData() {
  const data = await api('/api/admin-data');
  state.clients = data.clients || [];
  state.payments = data.payments || [];
  if (state.selectedId && !state.clients.some(client => client.id === state.selectedId)) {
    state.selectedId = null;
  }
  renderAll();
}

async function checkAuth() {
  try {
    const data = await api('/api/admin-status');
    setLoggedIn(Boolean(data.authenticated));
    if (data.authenticated) await loadData();
  } catch (error) {
    setLoggedIn(false);
    authEls.loginError.textContent = error.message;
    authEls.loginError.classList.add('show');
  }
}

async function performAction(action, options = {}) {
  const client = state.clients.find(item => item.id === state.selectedId);
  if (!client) return false;

  const labels = {
    recharge: `Aviso: vas a recargar 30 días + 3 horas a ${formatPersonName(client.nombre)}. ¿Confirmar?`,
    'schedule-cut': `Programar corte para ${formatPersonName(client.nombre)}?`,
    cut: `Aviso: vas a cortar el servicio de ${formatPersonName(client.nombre)} ahora. ¿Confirmar?`,
    enable: `Activar y mandar accion pendiente para ${formatPersonName(client.nombre)}?`
  };
  if (!confirm(labels[action] || 'Confirmar accion?')) return false;

  await api('/api/admin-action', {
    method: 'POST',
    body: JSON.stringify({
      customerId: client.id,
      action,
      ...options
    })
  });
  await loadData();
  return true;
}

async function deleteSelectedClient(client) {
  const routerName = client.router?.name || 'sin router';
  const access = client.pppoe || client.queue || client.ip || 'sin acceso configurado';
  const confirmation = `Eliminar definitivamente a ${formatPersonName(client.nombre)}?\n\nRouter: ${routerName}\nAcceso: ${access}\n\nTambien se eliminaran sus pagos y acciones guardadas. Esta accion no se puede deshacer.`;
  if (!confirm(confirmation)) return;

  await api('/api/admin-client', {
    method: 'DELETE',
    body: JSON.stringify({ id: client.id })
  });
  state.selectedId = null;
  await loadData();
}

function openClientDialog(client = null) {
  const ciInput = document.getElementById('clientCi');
  document.getElementById('dialogTitle').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientId').value = client?.id || '';
  document.getElementById('clientName').value = client?.nombre || '';
  ciInput.value = isPlaceholderCi(client?.ci) ? '' : (client?.ci || '');
  ciInput.required = !client || !isPlaceholderCi(client?.ci);
  ciInput.placeholder = isPlaceholderCi(client?.ci) ? 'Sin CI registrado' : '';
  document.getElementById('clientPhone').value = client?.telefono || '';
  document.getElementById('clientSector').value = client?.sector || 'fibra';
  document.getElementById('clientPlan').value = client?.plan || 'Fibra 50 Mbps';
  document.getElementById('clientPrice').value = client?.precio || planPrices['Fibra 50 Mbps'] || 150;
  const routerSelect = document.getElementById('clientRouter');
  const routers = new Map();
  state.clients.forEach(item => {
    if (item.routerId && item.router?.name) routers.set(item.routerId, item.router.name);
  });
  routerSelect.innerHTML = Array.from(routers.entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join('');
  routerSelect.value = client?.routerId || routerSelect.options[0]?.value || '';
  document.getElementById('clientPppoe').value = client?.pppoe || '';
  document.getElementById('clientQueue').value = client?.queue || '';
  document.getElementById('clientIp').value = client?.ip || '';
  document.getElementById('clientPaidUntil').value = client?.pagadoHasta || '';
  document.getElementById('clientDueAt').value = toLocalDateTimeInput(client?.dueAt || '');
  document.getElementById('clientAutoCut').checked = client?.autoCutEnabled !== false;
  els.dialog.showModal();
}

function openCiDialog(client) {
  document.getElementById('ciClientId').value = client.id;
  document.getElementById('ciClientName').textContent = formatPersonName(client.nombre);
  document.getElementById('ciNameValue').value = formatPersonName(client.nombre);
  document.getElementById('ciValue').value = isPlaceholderCi(client.ci) ? '' : (client.ci || '');
  els.ciDialog.showModal();
  document.getElementById('ciNameValue').focus();
}

function openScheduleDialog(client) {
  document.getElementById('scheduleClientId').value = client.id;
  document.getElementById('scheduleClientName').textContent = `${formatPersonName(client.nombre)} · ${client.pppoe || client.queue || '-'}`;
  document.getElementById('scheduleDueAt').value = toLocalDateTimeInput(client.dueAt || '');
  document.getElementById('scheduleAutoCut').checked = client.autoCutEnabled !== false;
  els.scheduleDialog.showModal();
}

async function handleClientSubmit(event) {
  event.preventDefault();
  const id = document.getElementById('clientId').value;
  const existingClient = state.clients.find(client => client.id === id);
  const enteredCi = document.getElementById('clientCi').value.trim();
  const dueInput = document.getElementById('clientDueAt').value;
  const paidInput = document.getElementById('clientPaidUntil').value;
  const dueAt = dueInput
    ? fromLocalDateTimeInput(dueInput)
    : paidInput ? new Date(`${paidInput}T23:59:00`).toISOString() : null;
  const payload = {
    id,
    nombre: document.getElementById('clientName').value.trim(),
    ci: enteredCi || (id && isPlaceholderCi(existingClient?.ci) ? existingClient.ci : ''),
    telefono: document.getElementById('clientPhone').value.trim(),
    sector: document.getElementById('clientSector').value,
    plan: document.getElementById('clientPlan').value,
    precio: Number(document.getElementById('clientPrice').value || 0),
    routerId: document.getElementById('clientRouter').value,
    pppoe: document.getElementById('clientPppoe').value.trim(),
    queue: document.getElementById('clientQueue').value.trim(),
    ip: document.getElementById('clientIp').value.trim(),
    dueAt,
    autoCutEnabled: document.getElementById('clientAutoCut').checked
  };

  const data = await api('/api/admin-client', {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload)
  });
  els.dialog.close();
  if (data.customer?.id) state.selectedId = data.customer.id;
  await loadData();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.clients, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `clientes-infinit-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

authEls.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  authEls.loginError.classList.remove('show');
  try {
    await api('/api/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: authEls.loginUser.value.trim(),
        password: authEls.loginPassword.value
      })
    });
    authEls.loginPassword.value = '';
    setLoggedIn(true);
    await loadData();
  } catch (error) {
    authEls.loginError.textContent = error.message;
    authEls.loginError.classList.add('show');
  }
});

document.getElementById('newClientBtn').addEventListener('click', () => {
  toolsMenu.classList.remove('open');
  openClientDialog();
});
document.getElementById('chartBtn').addEventListener('click', () => {
  toolsMenu.classList.remove('open');
  renderIncome();
  chartDialog.showModal();
});
document.getElementById('receiptHistoryBtn').addEventListener('click', () => {
  toolsMenu.classList.remove('open');
  renderReceiptHistory();
  els.receiptHistoryDialog.showModal();
});
document.getElementById('exportBtn').addEventListener('click', () => {
  toolsMenu.classList.remove('open');
  exportData();
});
document.getElementById('enableNotificationsBtn').addEventListener('click', async () => {
  toolsMenu.classList.remove('open');
  try {
    await enablePushNotifications();
    alert('Notificaciones activadas en este dispositivo.');
  } catch (error) {
    alert(error.message);
  }
});
document.getElementById('installAppBtn').addEventListener('click', async () => {
  toolsMenu.classList.remove('open');
  if (!state.installPrompt) {
    alert('En Android abre el menú del navegador y elige “Instalar aplicación”. En iPhone usa Compartir → Agregar a inicio.');
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
});
document.getElementById('closeDialogBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('cancelClientBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('closeCiBtn').addEventListener('click', () => els.ciDialog.close());
document.getElementById('cancelCiBtn').addEventListener('click', () => els.ciDialog.close());
document.getElementById('closeScheduleBtn').addEventListener('click', () => els.scheduleDialog.close());
document.getElementById('cancelScheduleBtn').addEventListener('click', () => els.scheduleDialog.close());
document.getElementById('cutNowBtn').addEventListener('click', async () => {
  try {
    const completed = await performAction('cut');
    if (completed) els.scheduleDialog.close();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('clientPlan').addEventListener('input', event => {
  const price = planPrices[event.target.value];
  if (price) document.getElementById('clientPrice').value = price;
});

els.form.addEventListener('submit', event => {
  handleClientSubmit(event).catch(error => alert(error.message));
});

els.ciForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/admin-client', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'update-ci',
        id: document.getElementById('ciClientId').value,
        nombre: document.getElementById('ciNameValue').value.trim(),
        ci: document.getElementById('ciValue').value.trim()
      })
    });
    els.ciDialog.close();
    await loadData();
  } catch (error) {
    alert(error.message);
  }
});

els.scheduleForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const dueAt = fromLocalDateTimeInput(document.getElementById('scheduleDueAt').value);
    await api('/api/admin-action', {
      method: 'POST',
      body: JSON.stringify({
        customerId: document.getElementById('scheduleClientId').value,
        action: 'schedule-cut',
        dueAt,
        autoCutEnabled: document.getElementById('scheduleAutoCut').checked
      })
    });
    els.scheduleDialog.close();
    await loadData();
  } catch (error) {
    alert(error.message);
  }
});

toolsMenuBtn.addEventListener('click', event => {
  event.stopPropagation();
  toolsMenu.classList.toggle('open');
});
document.addEventListener('click', event => {
  if (!toolsMenu.contains(event.target)) toolsMenu.classList.remove('open');
  if (!sectorPicker.contains(event.target) && !sectorToggleBtn.contains(event.target)) {
    sectorPicker.classList.remove('open');
    sectorToggleBtn.setAttribute('aria-expanded', 'false');
  }
});

els.search.addEventListener('input', renderFilteredClients);

document.querySelector('.admin-stats').addEventListener('click', event => {
  const card = event.target.closest('[data-stat-filter]');
  if (!card) return;
  state.statusFilter = card.dataset.statFilter;
  if (state.statusFilter === 'todos') state.routerFilter = 'todos';
  renderFilteredClients();
  document.querySelector('.admin-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

sectorToggleBtn.addEventListener('click', event => {
  event.stopPropagation();
  const open = sectorPicker.classList.toggle('open');
  sectorToggleBtn.setAttribute('aria-expanded', String(open));
});

sectorPicker.addEventListener('click', event => {
  const button = event.target.closest('[data-router-filter]');
  if (!button) return;
  state.routerFilter = state.routerFilter === button.dataset.routerFilter
    ? 'todos'
    : button.dataset.routerFilter;
  sectorPicker.classList.remove('open');
  sectorToggleBtn.setAttribute('aria-expanded', 'false');
  renderFilteredClients();
  document.querySelector('.admin-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

incomeMonth.addEventListener('change', renderIncome);
document.getElementById('incomeCurrentMonthBtn').addEventListener('click', () => {
  incomeMonth.value = monthValue();
  renderIncome();
});
document.getElementById('closeChartBtn').addEventListener('click', () => chartDialog.close());
document.getElementById('closeReceiptBtn').addEventListener('click', () => els.receiptDialog.close());
document.getElementById('closeReceiptHistoryBtn').addEventListener('click', () => els.receiptHistoryDialog.close());
document.getElementById('confirmReceiptBtn').addEventListener('click', () => reviewReceipt('confirm').catch(error => alert(error.message)));
document.getElementById('rejectReceiptBtn').addEventListener('click', () => reviewReceipt('reject').catch(error => alert(error.message)));

els.receiptInboxList.addEventListener('click', event => {
  const button = event.target.closest('[data-receipt-action="view"]');
  const card = event.target.closest('[data-receipt-id]');
  if (button && card) openReceiptDialog(card.dataset.receiptId);
});

els.receiptHistoryList.addEventListener('click', event => {
  const button = event.target.closest('[data-history-receipt-action="view"]');
  const card = event.target.closest('[data-history-receipt-id]');
  if (!button || !card) return;
  els.receiptHistoryDialog.close();
  openReceiptDialog(card.dataset.historyReceiptId);
});

els.tbody.addEventListener('click', event => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  state.selectedId = row.dataset.id;
  renderClients();
  renderDetail();
});

els.detail.addEventListener('click', event => {
  const button = event.target.closest('[data-detail-action]');
  if (!button) return;
  const action = button.dataset.detailAction;
  const client = state.clients.find(item => item.id === state.selectedId);
  if (!client) return;

  if (action === 'update-ci') return openCiDialog(client);
  if (action === 'schedule-cut') return openScheduleDialog(client);
  if (action === 'delete') return deleteSelectedClient(client).catch(error => alert(error.message));
  return performAction(action).catch(error => alert(error.message));
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
});

registerPanelApp().catch(() => {});
checkAuth();
