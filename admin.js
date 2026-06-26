const state = {
  clients: [],
  payments: [],
  selectedId: null,
  authenticated: false
};

const planPrices = {
  'Fibra 7 Mbps': 95,
  'Fibra 10 Mbps': 95,
  'Fibra 20 Mbps': 120,
  'Fibra 25 Mbps': 120,
  'Fibra 40 Mbps': 150,
  'Fibra 50 Mbps': 150,
  'Fibra 50 Mbps + TV': 160,
  'Fibra 100 Mbps': 200,
  'Fibra 200 Mbps': 300
};

const els = {
  tbody: document.getElementById('clientsTbody'),
  detail: document.getElementById('clientDetail'),
  search: document.getElementById('searchInput'),
  sector: document.getElementById('sectorFilter'),
  status: document.getElementById('statusFilter'),
  stats: {
    total: document.getElementById('statTotal'),
    active: document.getElementById('statActive'),
    expired: document.getElementById('statExpired'),
    cut: document.getElementById('statCut'),
    revenue: document.getElementById('statRevenue')
  },
  dialog: document.getElementById('clientDialog'),
  form: document.getElementById('clientForm'),
  scheduleDialog: document.getElementById('scheduleDialog'),
  scheduleForm: document.getElementById('scheduleForm')
};

const authEls = {
  loginForm: document.getElementById('loginForm'),
  loginUser: document.getElementById('loginUser'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  logoutBtn: document.getElementById('logoutBtn')
};

const bridgeState = document.getElementById('bridgeState');
const incomeGrid = document.getElementById('incomeGrid');
const toolsMenu = document.querySelector('.tools-menu');
const toolsMenuBtn = document.getElementById('toolsMenuBtn');
const incomeYearFilter = document.getElementById('incomeYearFilter');
const incomeMonthFilter = document.getElementById('incomeMonthFilter');
const incomeViewBtn = document.getElementById('incomeViewBtn');
let incomeViewMode = 'cards';

function setLoggedIn(loggedIn) {
  state.authenticated = loggedIn;
  document.body.classList.toggle('admin-locked', !loggedIn);
  authEls.loginError.classList.remove('show');
}

function setBridgeState(text, mode = 'warning') {
  bridgeState.classList.toggle('online', mode === 'online');
  bridgeState.classList.toggle('warning', mode !== 'online');
  bridgeState.innerHTML = `<i class="fas fa-circle"></i> ${text}`;
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
      client.sector
    ].join(' ').toLowerCase();

    return (!q || text.includes(q))
      && (els.sector.value === 'todos' || client.sector === els.sector.value)
      && (els.status.value === 'todos' || status === els.status.value);
  });
}

function renderStats() {
  const statuses = state.clients.map(getEffectiveStatus);
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const revenue = state.payments
    .filter(payment => payment.status === 'confirmado' && String(payment.paid_at || '').startsWith(currentMonth))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  els.stats.total.textContent = state.clients.length;
  els.stats.active.textContent = statuses.filter(status => status === 'activo').length;
  els.stats.expired.textContent = statuses.filter(status => status === 'vencido').length;
  els.stats.cut.textContent = statuses.filter(status => status === 'cortado').length;
  els.stats.revenue.textContent = formatMoney(revenue);
}

function renderIncome() {
  const year = incomeYearFilter.value;
  const month = incomeMonthFilter.value;
  const confirmed = state.payments.filter(payment => {
    if (payment.status !== 'confirmado') return false;
    const date = String(payment.paid_at || '');
    return (year === 'todos' || date.startsWith(year))
      && (month === 'todos' || date.slice(5, 7) === month);
  });
  const total = confirmed.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const average = confirmed.length ? total / confirmed.length : 0;

  if (incomeViewMode === 'chart') {
    const byMonth = new Map();
    for (const payment of confirmed) {
      const key = String(payment.paid_at || '').slice(0, 7) || 'Sin fecha';
      byMonth.set(key, (byMonth.get(key) || 0) + Number(payment.amount || 0));
    }
    const max = Math.max(...byMonth.values(), 1);
    incomeGrid.innerHTML = Array.from(byMonth.entries()).map(([label, amount]) => `
      <div class="income-card chart-row">
        <span>${label}</span>
        <div class="bar"><i style="width:${Math.max(8, (amount / max) * 100)}%"></i></div>
        <strong>${formatMoney(amount)}</strong>
      </div>
    `).join('') || '<div class="income-card"><strong>Sin pagos</strong><span>No hay datos en este periodo.</span></div>';
    return;
  }

  incomeGrid.innerHTML = `
    <div class="income-card"><span>Total</span><strong>${formatMoney(total)}</strong><small>${confirmed.length} pagos</small></div>
    <div class="income-card"><span>Promedio</span><strong>${formatMoney(average)}</strong><small>por recarga</small></div>
    <div class="income-card"><span>Periodo</span><strong>${year === 'todos' ? 'Todos' : year}</strong><small>${month === 'todos' ? 'todos los meses' : month}</small></div>
  `;
}

function renderIncomeFilters() {
  const years = Array.from(new Set(state.payments.map(payment => String(payment.paid_at || '').slice(0, 4)).filter(Boolean))).sort().reverse();
  incomeYearFilter.innerHTML = '<option value="todos">Todos los anos</option>' + years.map(year => `<option value="${year}">${year}</option>`).join('');
}

function renderClients() {
  const clients = filteredClients();
  els.tbody.innerHTML = clients.map(client => {
    const selected = client.id === state.selectedId ? 'selected' : '';
    const status = getEffectiveStatus(client);
    const countdown = countdownParts(client);
    const accessLabel = client.pppoe
      ? `PPPoE ${client.pppoe}`
      : `Queue ${client.queue || '-'}${client.ip ? ` · IP ${client.ip}` : ''}`;
    return `
      <tr class="${selected}" data-id="${client.id}">
        <td data-label="Cliente">
          <strong>${client.nombre}</strong>
          <span>CI ${client.ci || '-'} · ${client.telefono || 'sin telefono'}</span>
        </td>
        <td data-label="Servicio">
          <strong>${client.plan}</strong>
          <span>${client.sector} · ${accessLabel}</span>
        </td>
        <td data-label="Vence">
          <strong class="${countdown.tone}">${countdown.label}</strong>
          <span>${countdown.dateLabel}</span>
        </td>
        <td data-label="Estado"><span class="state-pill ${status}">${status}</span></td>
      </tr>
    `;
  }).join('');
}

function renderDetail() {
  const client = state.clients.find(item => item.id === state.selectedId);
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
  const accessTitle = client.pppoe ? 'PPPoE' : 'Queue/IP';
  const accessValue = client.pppoe || `${client.queue || '-'}${client.ip ? ` · ${client.ip}` : ''}`;
  const dueTitle = status === 'cortado' ? 'Servicio' : 'Vence';
  els.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${client.nombre}</h3>
        <p>CI ${client.ci || '-'} · ${client.telefono || 'sin telefono'}</p>
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
      <div class="detail-item"><span>Plan</span><strong>${client.plan}</strong></div>
      <div class="detail-item"><span>${accessTitle}</span><strong>${accessValue}</strong></div>
      <div class="detail-item"><span>Router</span><strong>${client.router?.name || '-'}</strong></div>
      <div class="detail-item"><span>Corte auto</span><strong>${client.autoCutEnabled ? 'Activado' : 'No'}</strong></div>
    </div>

    <div class="detail-actions">
      <button class="btn primary" type="button" data-detail-action="recharge"><i class="fas fa-money-bill-wave"></i> Recargar 30d</button>
      <button class="btn ghost" type="button" data-detail-action="schedule-cut"><i class="fas fa-calendar-check"></i> Programar corte</button>
      <button class="btn ghost" type="button" data-detail-action="edit"><i class="fas fa-pen"></i> Editar</button>
      ${status === 'cortado'
        ? '<button class="btn primary" type="button" data-detail-action="enable"><i class="fas fa-wifi"></i> Activar</button>'
        : '<button class="btn ghost" type="button" data-detail-action="cut"><i class="fas fa-ban"></i> Cortar</button>'}
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
  renderClients();
  renderDetail();
}

async function loadData() {
  const data = await api('/api/admin-data');
  state.clients = data.clients || [];
  state.payments = data.payments || [];
  if (!state.selectedId && state.clients.length) state.selectedId = state.clients[0].id;
  if (state.selectedId && !state.clients.some(client => client.id === state.selectedId)) {
    state.selectedId = state.clients[0]?.id || null;
  }
  renderIncomeFilters();
  renderAll();
}

async function checkAuth() {
  try {
    const data = await api('/api/admin-status');
    setLoggedIn(Boolean(data.authenticated));
    setBridgeState(data.authenticated ? 'Panel conectado' : data.configured ? 'Login requerido' : 'Configurar admin', data.authenticated ? 'online' : 'warning');
    if (data.authenticated) await loadData();
  } catch (error) {
    setLoggedIn(false);
    setBridgeState('Configurar admin');
    authEls.loginError.textContent = error.message;
    authEls.loginError.classList.add('show');
  }
}

async function performAction(action, options = {}) {
  const client = state.clients.find(item => item.id === state.selectedId);
  if (!client) return;

  const labels = {
    recharge: `Recargar 30 dias + 3 horas a ${client.nombre}?`,
    'schedule-cut': `Programar corte para ${client.nombre}?`,
    cut: `Marcar corte y mandar accion pendiente para ${client.nombre}?`,
    enable: `Activar y mandar accion pendiente para ${client.nombre}?`
  };
  if (!confirm(labels[action] || 'Confirmar accion?')) return;

  await api('/api/admin-action', {
    method: 'POST',
    body: JSON.stringify({
      customerId: client.id,
      action,
      ...options
    })
  });
  await loadData();
  alert('Accion guardada. La VPS ejecutara el comando MikroTik.');
}

function openClientDialog(client = null) {
  document.getElementById('dialogTitle').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientId').value = client?.id || '';
  document.getElementById('clientName').value = client?.nombre || '';
  document.getElementById('clientCi').value = client?.ci || '';
  document.getElementById('clientPhone').value = client?.telefono || '';
  document.getElementById('clientSector').value = client?.sector || 'fibra';
  document.getElementById('clientPlan').value = client?.plan || 'Fibra 50 Mbps';
  document.getElementById('clientPrice').value = client?.precio || planPrices['Fibra 50 Mbps'] || 150;
  document.getElementById('clientPppoe').value = client?.pppoe || '';
  document.getElementById('clientQueue').value = client?.queue || client?.pppoe || '';
  document.getElementById('clientIp').value = client?.ip || '';
  document.getElementById('clientPaidUntil').value = client?.pagadoHasta || '';
  document.getElementById('clientDueAt').value = toLocalDateTimeInput(client?.dueAt || '');
  document.getElementById('clientAutoCut').checked = client?.autoCutEnabled !== false;
  els.dialog.showModal();
}

function openScheduleDialog(client) {
  document.getElementById('scheduleClientId').value = client.id;
  document.getElementById('scheduleClientName').textContent = `${client.nombre} · ${client.pppoe || client.queue || '-'}`;
  document.getElementById('scheduleDueAt').value = toLocalDateTimeInput(client.dueAt || '');
  document.getElementById('scheduleAutoCut').checked = client.autoCutEnabled !== false;
  els.scheduleDialog.showModal();
}

async function handleClientSubmit(event) {
  event.preventDefault();
  const id = document.getElementById('clientId').value;
  const dueInput = document.getElementById('clientDueAt').value;
  const paidInput = document.getElementById('clientPaidUntil').value;
  const dueAt = dueInput
    ? fromLocalDateTimeInput(dueInput)
    : paidInput ? new Date(`${paidInput}T23:59:00`).toISOString() : null;
  const payload = {
    id,
    nombre: document.getElementById('clientName').value.trim(),
    ci: document.getElementById('clientCi').value.trim(),
    telefono: document.getElementById('clientPhone').value.trim(),
    sector: document.getElementById('clientSector').value,
    plan: document.getElementById('clientPlan').value,
    precio: Number(document.getElementById('clientPrice').value || 0),
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
    setBridgeState('Panel conectado', 'online');
    await loadData();
  } catch (error) {
    authEls.loginError.textContent = error.message;
    authEls.loginError.classList.add('show');
  }
});

authEls.logoutBtn.addEventListener('click', async () => {
  await fetch('/api/admin-logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  setLoggedIn(false);
  setBridgeState('Login requerido');
});

document.getElementById('newClientBtn').addEventListener('click', () => openClientDialog());
document.getElementById('syncMikrotikBtn').addEventListener('click', () => loadData());
document.getElementById('setThirtyDaysBtn').addEventListener('click', () => alert('Lo haremos desde una accion masiva segura, solo para activos, despues de probar cortes con la VPS.'));
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('clearPanelBtn').addEventListener('click', () => alert('Por seguridad no se permite limpiar clientes importados desde este panel.'));
document.getElementById('closeDialogBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('cancelClientBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('closeScheduleBtn').addEventListener('click', () => els.scheduleDialog.close());
document.getElementById('cancelScheduleBtn').addEventListener('click', () => els.scheduleDialog.close());

document.getElementById('clientPlan').addEventListener('input', event => {
  const price = planPrices[event.target.value];
  if (price) document.getElementById('clientPrice').value = price;
});

els.form.addEventListener('submit', event => {
  handleClientSubmit(event).catch(error => alert(error.message));
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
});

[els.search, els.sector, els.status].forEach(input => {
  input.addEventListener('input', renderAll);
  input.addEventListener('change', renderAll);
});

[incomeYearFilter, incomeMonthFilter].forEach(input => input.addEventListener('change', renderIncome));
incomeViewBtn.addEventListener('click', () => {
  incomeViewMode = incomeViewMode === 'cards' ? 'chart' : 'cards';
  incomeViewBtn.innerHTML = incomeViewMode === 'cards'
    ? '<i class="fas fa-chart-column"></i> Ver grafico'
    : '<i class="fas fa-table-cells-large"></i> Ver tarjetas';
  renderIncome();
});

els.tbody.addEventListener('click', event => {
  const row = event.target.closest('tr[data-id]');
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

  if (action === 'edit') return openClientDialog(client);
  if (action === 'schedule-cut') return openScheduleDialog(client);
  return performAction(action).catch(error => alert(error.message));
});

checkAuth();
