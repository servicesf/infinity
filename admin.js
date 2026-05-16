const STORAGE_KEY = 'infinit_wisp_clients_v1';
const ACTIONS_KEY = 'infinit_wisp_actions_v1';
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const INITIAL_SERVICE_VERSION = 2;
const DEMO_IDS = new Set(['cli-001', 'cli-002', 'cli-003']);
const DEMO_USERS = new Set(['juan.perez', 'maria.flores', 'carlos.mamani']);

const state = {
  clients: [],
  selectedId: null
};

const planPrices = {
  '7 Mbps': 95,
  '10 Mbps': 120,
  '20 Mbps': 150,
  '20 Mbps + Canales': 160,
  '40 Mbps + Canales': 200,
  '150 Mbps': 0
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
  form: document.getElementById('clientForm')
};
const bridgeState = document.getElementById('bridgeState');
const incomeGrid = document.getElementById('incomeGrid');
const toolsMenu = document.querySelector('.tools-menu');
const toolsMenuBtn = document.getElementById('toolsMenuBtn');
const incomeYearFilter = document.getElementById('incomeYearFilter');
const incomeMonthFilter = document.getElementById('incomeMonthFilter');
const incomeViewBtn = document.getElementById('incomeViewBtn');
let incomeViewMode = 'cards';

const authEls = {
  loginForm: document.getElementById('loginForm'),
  loginUser: document.getElementById('loginUser'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  logoutBtn: document.getElementById('logoutBtn')
};

function setLoggedIn(loggedIn) {
  document.body.classList.toggle('admin-locked', !loggedIn);
  if (loggedIn) authEls.loginError.classList.remove('show');
}

function setBridgeState(text, mode = 'warning') {
  bridgeState.classList.toggle('online', mode === 'online');
  bridgeState.classList.toggle('warning', mode !== 'online');
  bridgeState.innerHTML = `<i class="fas fa-circle"></i> ${text}`;
}

async function checkAuth() {
  try {
    const response = await fetch('/api/admin-status', { credentials: 'same-origin' });
    const data = await readJsonResponse(response);
    setLoggedIn(Boolean(data.ok && data.authenticated));
    if (data.ok) setBridgeState(data.authenticated ? 'Bridge conectado' : 'Login requerido', data.authenticated ? 'online' : 'warning');
  } catch {
    setLoggedIn(false);
    setBridgeState('Bridge no conectado');
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Servidor no actualizado o ruta no encontrada (${response.status}). Reinicia el bridge.`);
  }
}

authEls.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  authEls.loginError.classList.remove('show');

  try {
    const response = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: authEls.loginUser.value.trim(),
        password: authEls.loginPassword.value
      })
    });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Usuario o contraseña incorrectos');
    }

    authEls.loginPassword.value = '';
    setLoggedIn(true);
    setBridgeState('Bridge conectado', 'online');
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

function formatDate(dateValue) {
  if (!dateValue) return 'Sin fecha';
  const cleanDate = String(dateValue).slice(0, 10);
  const [year, month, day] = cleanDate.split('-');
  return `${day}/${month}/${year}`;
}

function formatDateTime(dateValue) {
  if (!dateValue) return 'Sin programar';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Sin programar';
  return date.toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toLocalDateTimeInput(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeInput(dateValue) {
  return dateValue ? new Date(dateValue).toISOString() : '';
}

function endOfLocalDayIso(dateValue) {
  return dateValue ? new Date(`${dateValue}T23:59:59`).toISOString() : '';
}

function addDays(dateValue, days = 30, extraHours = 0) {
  const base = dateValue ? new Date(dateValue) : new Date();
  base.setDate(base.getDate() + days);
  base.setHours(base.getHours() + extraHours);
  return base.toISOString();
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const due = new Date(dateValue);
  const start = new Date();
  return Math.ceil((due - start) / 86400000);
}

function dueText(client) {
  const days = daysUntil(client.dueAt || `${client.pagadoHasta}T23:59:59`);
  if (days === null) return 'sin vencimiento';
  if (days < 0) return `vencio hace ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'vence hoy';
  return `vence en ${days} dia${days === 1 ? '' : 's'}`;
}

function countdownParts(client) {
  const due = new Date(client.dueAt || `${client.pagadoHasta}T23:59:59`);
  if (Number.isNaN(due.getTime())) return { label: 'Sin fecha', detail: 'sin programar', tone: '' };

  const diff = due - new Date();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const label = `${days}d ${hours}h`;
  const detail = diff < 0 ? `vencido hace ${label}` : `${label} restantes`;
  const tone = diff < 0 ? 'danger' : days <= 3 ? 'warning' : '';
  return { label: diff < 0 ? 'Vencido' : label, detail, tone };
}

function getEffectiveStatus(client) {
  if (client.estado === 'cortado') return 'cortado';
  const paidUntil = new Date(client.dueAt || `${client.pagadoHasta}T23:59:59`);
  return paidUntil < today ? 'vencido' : 'activo';
}

function normalizeClient(client) {
  if (client.serviceVersion === INITIAL_SERVICE_VERSION) return client;
  const dueAt = addDays(new Date().toISOString(), 30, 12);
  return {
    ...client,
    pagadoHasta: dueAt.slice(0, 10),
    dueAt,
    autoCutEnabled: true,
    serviceVersion: INITIAL_SERVICE_VERSION,
    historial: Array.isArray(client.historial) ? client.historial : []
  };
}

function saveClients() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clients));
  fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ clients: state.clients })
  }).catch(() => {});
}

function removeDemoClients(clients) {
  return clients.filter(client => !DEMO_IDS.has(client.id) && !DEMO_USERS.has(client.pppoe));
}

function prepareClients(clients) {
  return removeDemoClients(clients).map(normalizeClient);
}

function saveAction(action) {
  const actions = JSON.parse(localStorage.getItem(ACTIONS_KEY) || '[]');
  actions.unshift({
    ...action,
    fecha: new Date().toISOString()
  });
  localStorage.setItem(ACTIONS_KEY, JSON.stringify(actions.slice(0, 200)));
}

async function loadClients() {
  try {
    const serverResponse = await fetch('/api/clients', { credentials: 'same-origin' });
    if (serverResponse.ok) {
      const data = await readJsonResponse(serverResponse);
      if (Array.isArray(data.clients) && data.clients.length) {
        state.clients = prepareClients(data.clients);
        saveClients();
        return;
      }
    }
  } catch {
    // Si el bridge no esta disponible, seguimos con localStorage.
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    state.clients = prepareClients(JSON.parse(stored));
    saveClients();
    return;
  }

  const response = await fetch('data/clientes.json');
  state.clients = prepareClients(await response.json());
  saveClients();
}

function filteredClients() {
  const term = els.search.value.trim().toLowerCase();
  const sector = els.sector.value;
  const status = els.status.value;

  return state.clients.filter(client => {
    const effectiveStatus = getEffectiveStatus(client);
    const matchesSector = sector === 'todos' || client.sector === sector;
    const matchesStatus = status === 'todos' || effectiveStatus === status;
    const haystack = [
      client.nombre,
      client.ci,
      client.telefono,
      client.sector,
      client.plan,
      client.pppoe,
      client.queue,
      client.ip
    ].join(' ').toLowerCase();

    return matchesSector && matchesStatus && haystack.includes(term);
  });
}

function renderStats() {
  const monthKey = new Date().toISOString().slice(0, 7);
  const totals = state.clients.reduce((acc, client) => {
    const status = getEffectiveStatus(client);
    acc.total += 1;
    acc[status] += 1;
    (client.historial || []).forEach(item => {
      if (item.tipo === 'pago' && String(item.fecha || '').startsWith(monthKey)) {
        acc.revenue += Number(item.monto || 0);
      }
    });
    return acc;
  }, { total: 0, activo: 0, vencido: 0, cortado: 0, revenue: 0 });

  els.stats.total.textContent = totals.total;
  els.stats.active.textContent = totals.activo;
  els.stats.expired.textContent = totals.vencido;
  els.stats.cut.textContent = totals.cortado;
  els.stats.revenue.textContent = `Bs. ${totals.revenue}`;
}

function revenueRows() {
  const months = new Map();
  state.clients.forEach(client => {
    (client.historial || []).forEach(item => {
      if (item.tipo !== 'pago') return;
      const month = String(item.fecha || '').slice(0, 7);
      if (!month) return;
      const current = months.get(month) || { month, total: 0, count: 0 };
      current.total += Number(item.monto || 0);
      current.count += 1;
      months.set(month, current);
    });
  });

  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

function updateIncomeYearOptions(rows) {
  const years = [...new Set(rows.map(row => row.month.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const selected = incomeYearFilter.value || 'todos';
  incomeYearFilter.innerHTML = '<option value="todos">Todos los anos</option>' + years.map(year => (
    `<option value="${year}">${year}</option>`
  )).join('');
  incomeYearFilter.value = years.includes(selected) ? selected : 'todos';
}

function filteredRevenueRows(rows) {
  const year = incomeYearFilter.value;
  const month = incomeMonthFilter.value;
  return rows.filter(row => {
    const [rowYear, rowMonth] = row.month.split('-');
    const matchesYear = year === 'todos' || rowYear === year;
    const matchesMonth = month === 'todos' || rowMonth === month;
    return matchesYear && matchesMonth;
  });
}

function renderIncome() {
  const allRows = revenueRows();
  updateIncomeYearOptions(allRows);
  const rows = filteredRevenueRows(allRows);
  if (!rows.length) {
    incomeGrid.innerHTML = '<div class="muted">Todavia no hay recargas registradas este mes.</div>';
    return;
  }

  if (incomeViewMode === 'chart') {
    const max = Math.max(...rows.map(row => row.total), 1);
    incomeGrid.innerHTML = `
      <div class="income-chart">
        ${rows.map(row => `
          <div class="chart-row">
            <strong>${row.month}</strong>
            <div class="chart-track"><div class="chart-bar" style="width:${Math.max((row.total / max) * 100, 4)}%"></div></div>
            <span>Bs. ${row.total}</span>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  incomeGrid.innerHTML = rows.slice(0, 6).map(row => `
    <article class="income-card">
      <span>${row.month} · ${row.count} recarga${row.count === 1 ? '' : 's'}</span>
      <strong>Bs. ${row.total}</strong>
    </article>
  `).join('');
}

function statusPill(status) {
  const icons = {
    activo: 'fa-check',
    vencido: 'fa-clock',
    cortado: 'fa-ban'
  };
  return `<span class="pill ${status}"><i class="fas ${icons[status]}"></i> ${status}</span>`;
}

function renderClients() {
  const clients = filteredClients();

  els.tbody.innerHTML = clients.map(client => {
    const status = getEffectiveStatus(client);
    const countdown = countdownParts(client);
    return `
      <tr class="client-row ${client.id === state.selectedId ? 'selected' : ''}" data-id="${client.id}">
        <td data-label="Cliente">
          <div class="client-name">
            <strong>${client.nombre}</strong>
            <span>CI ${client.ci} · ${client.telefono || 'sin telefono'}</span>
          </div>
        </td>
        <td data-label="Servicio">
          <strong>${client.plan}</strong>
          <div class="muted">${client.sector} · PPPoE ${client.pppoe || '-'}</div>
        </td>
        <td data-label="Vencimiento">
          <div class="countdown-box ${countdown.tone}">
            <strong>${countdown.label}</strong>
            <span class="muted">${formatDateTime(client.dueAt)}</span>
          </div>
        </td>
        <td data-label="Estado">
          ${statusPill(status)}
        </td>
      </tr>
    `;
  }).join('');

  if (!clients.length) {
    els.tbody.innerHTML = '<tr><td colspan="4" class="muted">No hay clientes con esos filtros.</td></tr>';
  }
}

function commandPreview(client, action) {
  const user = client.pppoe || client.queue || client.nombre;
  if (action === 'cut') {
    return [
      `/ppp secret disable [find name="${user}"]`,
      `/ppp active remove [find name="${user}"]`,
      `/queue simple disable [find name="${client.queue || user}"]`
    ].join('\n');
  }

  if (action === 'enable') {
    return [
      `/ppp secret enable [find name="${user}"]`,
      `/queue simple enable [find name="${client.queue || user}"]`
    ].join('\n');
  }

  return [
    `Pago registrado: Bs. ${client.precio}`,
    `Nuevo vencimiento: ${formatDate(client.pagadoHasta)}`
  ].join('\n');
}

function renderDetail() {
  const client = state.clients.find(item => item.id === state.selectedId);
  if (!client) return;

  const status = getEffectiveStatus(client);
  const history = [...(client.historial || [])].reverse();
  const lastPayments = history.filter(item => item.tipo === 'pago').slice(0, 3);
  const countdown = countdownParts(client);

  els.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${client.nombre}</h3>
        <span class="muted">CI ${client.ci} · ${client.telefono || 'sin telefono'}</span>
      </div>
      ${statusPill(status)}
    </div>

    <div class="work-summary ${countdown.tone}">
      <div>
        <span>Mensualidad</span>
        <strong>Bs. ${client.precio}</strong>
      </div>
      <div>
        <span>Vence</span>
        <strong>${countdown.label}</strong>
        <small>${formatDateTime(client.dueAt)}</small>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn soft" type="button" data-detail-action="pay"><i class="fas fa-money-bill-wave"></i> Recargar 30d</button>
      <button class="btn ghost" type="button" data-detail-action="days"><i class="fas fa-calendar-plus"></i> Agregar dias</button>
      <button class="btn ghost" type="button" data-detail-action="edit"><i class="fas fa-pen"></i> Editar</button>
      <button class="btn primary" type="button" data-detail-action="enable"><i class="fas fa-wifi"></i> Activar</button>
      <button class="btn ghost" type="button" data-detail-action="cut"><i class="fas fa-ban"></i> Cortar</button>
    </div>

    <h4>Historial de pagos</h4>
    <div class="history">
      ${lastPayments.length ? lastPayments.map(item => `
        <div class="history-item">
          <strong>${formatDate(item.fecha)} · Bs. ${item.monto || 0}</strong>
          <span>${item.metodo || 'Pago manual'}</span>
          <span>${item.nota || ''}</span>
        </div>
      `).join('') : '<span class="muted">Sin pagos registrados todavia.</span>'}
    </div>
  `;
}

function renderAll(options = {}) {
  const persist = options.persist !== false;
  state.clients = state.clients.map(client => ({
    ...client,
    estado: getEffectiveStatus(client)
  }));
  if (persist) saveClients();
  renderStats();
  renderIncome();
  renderClients();
  renderDetail();
}

function normalizeRouterPlan(profileName = '') {
  const profile = profileName.toUpperCase();
  if (profile.includes('150')) return '150 Mbps';
  if (profile.includes('40')) return '40 Mbps + Canales';
  if (profile.includes('20')) return '20 Mbps';
  if (profile.includes('10')) return '10 Mbps';
  if (profile.includes('7')) return '7 Mbps';
  return profileName || 'Sin plan';
}

async function sendMikrotikAction(client, action) {
  const payload = {
    action,
    clientId: client.id,
    nombre: client.nombre,
    pppoe: client.pppoe,
    queue: client.queue,
    ip: client.ip,
    sector: client.sector
  };

  saveAction(payload);

  try {
    await fetch('/api/mikrotik-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
  } catch {
    // En modo archivo/local no hay API. La accion queda registrada en localStorage.
  }
}

async function syncMikrotikClients() {
  if (!confirm('Importar/sincronizar clientes PPPoE reales desde MikroTik?')) return;

  try {
    const response = await fetch('/api/mikrotik-clients', { credentials: 'same-origin' });
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'No se pudo sincronizar MikroTik');
    }

    const existingByPppoe = new Map(state.clients.map(client => [client.pppoe, client]));

    data.clients.forEach(routerClient => {
      const plan = normalizeRouterPlan(routerClient.profile);
      const existing = existingByPppoe.get(routerClient.name);
      const initialDueAt = addDays(new Date().toISOString(), 30, 12);
      const synced = {
        id: existing?.id || `mt-${routerClient.name}`,
        nombre: existing?.nombre || routerClient.name,
        ci: existing?.ci || '',
        telefono: existing?.telefono || '',
        sector: existing?.sector || 'fibra',
        plan,
        precio: existing?.precio ?? planPrices[plan] ?? 0,
        pppoe: routerClient.name,
        queue: existing?.queue || routerClient.name,
        ip: existing?.ip || '',
        pagadoHasta: existing?.pagadoHasta || initialDueAt.slice(0, 10),
        dueAt: existing?.dueAt || initialDueAt,
        estado: routerClient.disabled ? 'cortado' : existing?.estado || 'activo',
        historial: existing?.historial || [],
        autoCutEnabled: existing?.autoCutEnabled ?? true,
        serviceVersion: INITIAL_SERVICE_VERSION
      };

      if (existing) {
        Object.assign(existing, synced);
      } else {
        state.clients.push(synced);
      }
    });

    saveClients();
    state.selectedId = state.clients[0]?.id || null;
    renderAll();
    alert(`Sincronizacion lista: ${data.clients.length} PPPoE encontrados.`);
  } catch (error) {
    alert(`Error sincronizando MikroTik: ${error.message}`);
  }
}

async function cutClient(id) {
  const client = state.clients.find(item => item.id === id);
  if (!client) return;

  if (!confirm(`Cortar servicio a ${client.nombre}?`)) return;

  client.estado = 'cortado';
  client.historial = client.historial || [];
  client.historial.push({
    fecha: new Date().toISOString().slice(0, 10),
    tipo: 'corte',
    monto: 0,
    metodo: 'MikroTik',
    nota: 'Corte manual desde panel'
  });

  await sendMikrotikAction(client, 'cut');
  saveClients();
  renderAll();
}

async function enableClient(id) {
  const client = state.clients.find(item => item.id === id);
  if (!client) return;

  client.estado = 'activo';
  client.historial = client.historial || [];
  client.historial.push({
    fecha: new Date().toISOString().slice(0, 10),
    tipo: 'activacion',
    monto: 0,
    metodo: 'MikroTik',
    nota: 'Activacion manual desde panel'
  });

  await sendMikrotikAction(client, 'enable');
  saveClients();
  renderAll();
}

async function payClient(id) {
  const client = state.clients.find(item => item.id === id);
  if (!client) return;

  if (!confirm(`Recargar 30 dias + 12 horas a ${client.nombre} por Bs. ${client.precio}?`)) return;

  const amount = Number(client.precio || 0);
  const serviceDays = 30;
  const metodo = 'Panel';
  const paymentDateTime = new Date().toISOString();
  const dueAt = addDays(paymentDateTime, serviceDays, 12);
  client.pagadoHasta = dueAt.slice(0, 10);
  client.dueAt = dueAt;
  client.estado = 'activo';
  client.autoCutEnabled = true;
  client.serviceVersion = INITIAL_SERVICE_VERSION;
  client.historial = client.historial || [];
  client.historial.push({
    fecha: paymentDateTime,
    tipo: 'pago',
    monto: amount,
    metodo,
    dias: serviceDays,
    nota: `Recarga directa 30 dias + 12 horas. Corte ${formatDateTime(client.dueAt)}`
  });

  await sendMikrotikAction(client, 'payment');
  await sendMikrotikAction(client, 'enable');
  saveClients();
  renderAll();
}

async function addCustomDaysToClient(id) {
  const client = state.clients.find(item => item.id === id);
  if (!client) return;

  const serviceDays = Number(prompt('Cuantos dias quieres agregar?', '30'));
  if (!serviceDays || serviceDays < 1) return;

  const currentDue = new Date(client.dueAt || `${client.pagadoHasta}T23:59:59`);
  const base = currentDue > new Date() ? currentDue.toISOString() : new Date().toISOString();
  const dueAt = addDays(base, serviceDays, 12);

  client.pagadoHasta = dueAt.slice(0, 10);
  client.dueAt = dueAt;
  client.estado = 'activo';
  client.autoCutEnabled = true;
  client.serviceVersion = INITIAL_SERVICE_VERSION;
  client.historial = client.historial || [];
  client.historial.push({
    fecha: new Date().toISOString(),
    tipo: 'ajuste',
    monto: 0,
    metodo: 'Panel',
    dias: serviceDays,
    nota: `Se agregaron ${serviceDays} dias + 12 horas. Corte ${formatDateTime(dueAt)}`
  });

  saveClients();
  renderAll();
}

function setThirtyDaysForAllClients() {
  if (!state.clients.length) return;
  if (!confirm('Poner 30 dias + 12 horas solo a clientes habilitados? Los cortados no se tocan.')) return;

  const dueAt = addDays(new Date().toISOString(), 30, 12);
  let updated = 0;
  state.clients = state.clients.map(client => {
    if (getEffectiveStatus(client) === 'cortado') return client;
    updated += 1;
    return {
      ...client,
      pagadoHasta: dueAt.slice(0, 10),
      dueAt,
      autoCutEnabled: true,
      serviceVersion: INITIAL_SERVICE_VERSION,
      estado: 'activo',
      historial: [
        ...(Array.isArray(client.historial) ? client.historial : []),
        {
          fecha: new Date().toISOString(),
          tipo: 'ajuste',
          monto: 0,
          metodo: 'Panel',
          dias: 30,
          nota: `Inicio de control: 30 dias + 12 horas. Corte ${formatDateTime(dueAt)}`
        }
      ]
    };
  });

  saveClients();
  renderAll();
  alert(`Listo: se actualizaron ${updated} clientes habilitados. Los cortados quedaron igual.`);
}

function openClientDialog(client = null) {
  document.getElementById('dialogTitle').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientId').value = client?.id || '';
  document.getElementById('clientName').value = client?.nombre || '';
  document.getElementById('clientCi').value = client?.ci || '';
  document.getElementById('clientPhone').value = client?.telefono || '';
  document.getElementById('clientSector').value = client?.sector || 'fibra';
  document.getElementById('clientPlan').value = client?.plan || '20 Mbps';
  document.getElementById('clientPrice').value = client?.precio || planPrices['20 Mbps'];
  document.getElementById('clientPppoe').value = client?.pppoe || '';
  document.getElementById('clientQueue').value = client?.queue || '';
  document.getElementById('clientIp').value = client?.ip || '';
  document.getElementById('clientPaidUntil').value = client?.pagadoHasta || todayIso;
  document.getElementById('clientDueAt').value = toLocalDateTimeInput(client?.dueAt || `${client?.pagadoHasta || todayIso}T23:59:59`);
  document.getElementById('clientAutoCut').checked = Boolean(client?.autoCutEnabled);
  els.dialog.showModal();
}

function handleClientSubmit(event) {
  event.preventDefault();

  const id = document.getElementById('clientId').value || `cli-${Date.now()}`;
  const current = state.clients.find(client => client.id === id);
  const data = {
    id,
    nombre: document.getElementById('clientName').value.trim(),
    ci: document.getElementById('clientCi').value.trim(),
    telefono: document.getElementById('clientPhone').value.trim(),
    sector: document.getElementById('clientSector').value,
    plan: document.getElementById('clientPlan').value,
    precio: Number(document.getElementById('clientPrice').value),
    pppoe: document.getElementById('clientPppoe').value.trim(),
    queue: document.getElementById('clientQueue').value.trim(),
    ip: document.getElementById('clientIp').value.trim(),
    pagadoHasta: document.getElementById('clientPaidUntil').value,
    dueAt: fromLocalDateTimeInput(document.getElementById('clientDueAt').value) || endOfLocalDayIso(document.getElementById('clientPaidUntil').value),
    estado: current?.estado || 'activo',
    historial: current?.historial || [],
    autoCutEnabled: document.getElementById('clientAutoCut').checked,
    serviceVersion: INITIAL_SERVICE_VERSION
  };

  if (current) {
    Object.assign(current, data);
  } else {
    state.clients.unshift(data);
  }

  state.selectedId = id;
  saveClients();
  els.dialog.close();
  renderAll();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.clients, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `clientes-wisp-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById('newClientBtn').addEventListener('click', () => openClientDialog());
document.getElementById('syncMikrotikBtn').addEventListener('click', syncMikrotikClients);
document.getElementById('setThirtyDaysBtn').addEventListener('click', setThirtyDaysForAllClients);
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('clearPanelBtn').addEventListener('click', async () => {
  if (!confirm('Limpiar los datos guardados del panel? Luego puedes volver a sincronizar MikroTik.')) return;
  localStorage.removeItem(STORAGE_KEY);
  await fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ clients: [] })
  }).catch(() => {});
  location.reload();
});
document.getElementById('closeDialogBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('cancelClientBtn').addEventListener('click', () => els.dialog.close());
document.getElementById('clientPlan').addEventListener('change', event => {
  document.getElementById('clientPrice').value = planPrices[event.target.value] || 0;
});
els.form.addEventListener('submit', handleClientSubmit);

toolsMenuBtn.addEventListener('click', event => {
  event.stopPropagation();
  toolsMenu.classList.toggle('open');
});

toolsMenu.addEventListener('click', event => {
  if (event.target.closest('.tool-item')) toolsMenu.classList.remove('open');
});

document.addEventListener('click', event => {
  if (!toolsMenu.contains(event.target)) toolsMenu.classList.remove('open');
});

[incomeYearFilter, incomeMonthFilter].forEach(filter => {
  filter.addEventListener('change', () => renderIncome());
});

incomeViewBtn.addEventListener('click', () => {
  incomeViewMode = incomeViewMode === 'cards' ? 'chart' : 'cards';
  incomeViewBtn.innerHTML = incomeViewMode === 'cards'
    ? '<i class="fas fa-chart-column"></i> Ver grafico'
    : '<i class="fas fa-table-cells-large"></i> Ver tarjetas';
  renderIncome();
});

[els.search, els.sector, els.status].forEach(input => {
  input.addEventListener('input', () => renderAll({ persist: false }));
  input.addEventListener('change', () => renderAll({ persist: false }));
});

els.tbody.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-action]');
  const row = event.target.closest('.client-row');

  if (actionButton) {
    const { action, id } = actionButton.dataset;
    if (action === 'pay') payClient(id);
    if (action === 'days') addCustomDaysToClient(id);
    if (action === 'edit') {
      const client = state.clients.find(item => item.id === id);
      state.selectedId = id;
      renderAll({ persist: false });
      openClientDialog(client);
    }
    if (action === 'cut') cutClient(id);
    if (action === 'enable') enableClient(id);
    return;
  }

  if (row) {
    state.selectedId = row.dataset.id;
    renderAll();
  }
});

els.detail.addEventListener('click', event => {
  const button = event.target.closest('[data-detail-action]');
  if (!button || !state.selectedId) return;
  const client = state.clients.find(item => item.id === state.selectedId);

  if (button.dataset.detailAction === 'pay') payClient(state.selectedId);
  if (button.dataset.detailAction === 'days') addCustomDaysToClient(state.selectedId);
  if (button.dataset.detailAction === 'cut') cutClient(state.selectedId);
  if (button.dataset.detailAction === 'enable') enableClient(state.selectedId);
  if (button.dataset.detailAction === 'edit') openClientDialog(client);
});

checkAuth();
loadClients().then(() => {
  state.selectedId = state.clients[0]?.id || null;
  renderAll();
});
