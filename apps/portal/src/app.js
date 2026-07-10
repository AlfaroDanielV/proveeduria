const USERS = [
  ['20000000-0000-4000-8000-000000000002', 'Proveeduria'],
  ['20000000-0000-4000-8000-000000000004', 'Ingeniero'],
  ['20000000-0000-4000-8000-000000000001', 'Gerencia'],
  ['20000000-0000-4000-8000-000000000005', 'Bodeguero'],
];

const DEFAULT_API = localStorage.getItem('provee.apiBase') || 'http://localhost:8080';
const DEFAULT_USER = localStorage.getItem('provee.userId') || USERS[0][0];

const state = {
  apiBase: DEFAULT_API,
  userId: DEFAULT_USER,
  selectedPedidoId: null,
  pedidos: [],
};

const $ = (id) => document.getElementById(id);

const els = {
  apiBase: $('api-base'),
  userId: $('user-id'),
  form: $('connection-form'),
  estado: $('estado-filter'),
  projectId: $('project-filter'),
  reload: $('reload'),
  session: $('session'),
  pedidos: $('pedidos'),
  pedidoCount: $('pedido-count'),
  empty: $('empty-state'),
  detail: $('pedido-detail'),
  detailProject: $('detail-project'),
  detailTitle: $('detail-title'),
  detailStatus: $('detail-status'),
  metricItems: $('metric-items'),
  metricRfqs: $('metric-rfqs'),
  metricRfqsOk: $('metric-rfqs-ok'),
  metricReview: $('metric-review'),
  items: $('items'),
  quotes: $('quotes'),
  proveedores: $('proveedores'),
  comparativo: $('comparativo'),
  comparativoCount: $('comparativo-count'),
  toast: $('toast'),
};

function initControls() {
  els.apiBase.value = state.apiBase;
  for (const [id, label] of USERS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    els.userId.append(option);
  }
  els.userId.value = state.userId;
}

function endpoint(path) {
  return `${state.apiBase.replace(/\/$/, '')}${path}`;
}

async function fetchJson(path) {
  const res = await fetch(endpoint(path), {
    headers: { 'x-user-id': state.userId },
  });
  let body = null;
  const text = await res.text();
  if (text.trim() !== '') body = JSON.parse(text);
  if (!res.ok) {
    const message = body?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

function money(value) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'CRC',
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('es-CR', { maximumFractionDigits: 3 }).format(value);
}

function statusText(value) {
  return value.replaceAll('_', ' ');
}

function statusClass(value) {
  if (value === 'en_revision') return 'en_revision';
  if (value === 'cotizando') return 'cotizando';
  if (value === 'cancelado') return 'cancelado';
  return 'default';
}

function setToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 5000);
}

function setSession(user) {
  const roles = user.roles.join(', ');
  els.session.textContent = `${user.nombre} · ${roles}`;
}

function renderPedidos() {
  els.pedidoCount.textContent = String(state.pedidos.length);
  els.pedidos.replaceChildren();

  for (const pedido of state.pedidos) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `pedido-row${pedido.id === state.selectedPedidoId ? ' active' : ''}`;
    row.innerHTML = `
      <strong>${pedido.numero}</strong>
      <span class="status ${statusClass(pedido.estado)}">${statusText(pedido.estado)}</span>
      <span class="row-meta">
        <span>${pedido.proyecto.codigo}</span>
        <span>${pedido.itemsCount} items</span>
        <span>${pedido.rfqsRespondidas}/${pedido.rfqsTotal} RFQ</span>
      </span>
    `;
    row.addEventListener('click', () => selectPedido(pedido.id));
    els.pedidos.append(row);
  }
}

function renderDetail(detalle, comparativo) {
  els.empty.hidden = true;
  els.detail.hidden = false;

  const { pedido } = detalle;
  els.detailProject.textContent = `${pedido.proyecto.codigo} · ${pedido.proyecto.nombre}`;
  els.detailTitle.textContent = pedido.numero;
  els.detailStatus.className = `status ${statusClass(pedido.estado)}`;
  els.detailStatus.textContent = statusText(pedido.estado);
  els.metricItems.textContent = String(pedido.itemsCount);
  els.metricRfqs.textContent = String(pedido.rfqsTotal);
  els.metricRfqsOk.textContent = String(pedido.rfqsRespondidas);
  els.metricReview.textContent = String(pedido.revisionesPendientes);

  els.items.replaceChildren();
  for (const item of detalle.items) {
    const node = document.createElement('div');
    node.className = 'compact-item';
    node.innerHTML = `<strong>${item.descripcion}</strong><span>${number(item.cantidad)} ${item.unidad}</span>`;
    els.items.append(node);
  }

  els.quotes.replaceChildren();
  for (const quote of detalle.quoteRequests) {
    const node = document.createElement('div');
    node.className = 'compact-item';
    const response = quote.ultimaRespuesta
      ? `${quote.ultimaRespuesta.fuente ?? 'respuesta'} · ${quote.ultimaRespuesta.confianzaExtraccion ?? '-'}`
      : 'sin respuesta';
    node.innerHTML = `<strong>${quote.proveedor}</strong><span>${statusText(quote.estado)} · ${response}</span>`;
    els.quotes.append(node);
  }

  els.proveedores.replaceChildren();
  for (const proveedor of comparativo.resumenProveedores) {
    const node = document.createElement('div');
    node.className = 'supplier';
    node.innerHTML = `
      <strong>${proveedor.nombre}</strong>
      <span>${money(proveedor.total)} · ${proveedor.itemsCotizados} cotizados · ${proveedor.itemsFaltantes} faltantes</span>
    `;
    els.proveedores.append(node);
  }

  els.comparativo.replaceChildren();
  els.comparativoCount.textContent = String(comparativo.filas.length);
  for (const fila of comparativo.filas) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fila.descripcion}</td>
      <td>${fila.proveedor}</td>
      <td class="numeric">${money(fila.precioUnitario)}</td>
      <td class="numeric">${number(fila.cantidadCotizada)} / ${number(fila.cantidadSolicitada)}</td>
      <td class="numeric">${money(fila.subtotal)}</td>
      <td><span class="chip ${fila.faltante ? 'missing' : 'ok'}">${fila.faltante ? 'faltante' : 'completo'}</span></td>
    `;
    els.comparativo.append(tr);
  }
}

async function loadMe() {
  const data = await fetchJson('/api/portal/me');
  setSession(data.user);
}

async function loadPedidos() {
  const params = new URLSearchParams();
  if (els.estado.value) params.set('estado', els.estado.value);
  if (els.projectId.value.trim()) params.set('projectId', els.projectId.value.trim());
  params.set('limit', '50');
  const data = await fetchJson(`/api/portal/pedidos?${params.toString()}`);
  state.pedidos = data.items;
  if (state.pedidos.length > 0 && !state.pedidos.some((p) => p.id === state.selectedPedidoId)) {
    state.selectedPedidoId = state.pedidos[0].id;
  }
  renderPedidos();
  if (state.selectedPedidoId !== null) await selectPedido(state.selectedPedidoId, false);
}

async function selectPedido(pedidoId, rerenderList = true) {
  state.selectedPedidoId = pedidoId;
  if (rerenderList) renderPedidos();
  const [detalle, comparativo] = await Promise.all([
    fetchJson(`/api/portal/pedidos/${pedidoId}`),
    fetchJson(`/api/portal/pedidos/${pedidoId}/comparativo`),
  ]);
  renderDetail(detalle, comparativo);
}

async function refresh() {
  try {
    await loadMe();
    await loadPedidos();
  } catch (error) {
    setToast(error instanceof Error ? error.message : String(error));
  }
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  state.apiBase = els.apiBase.value.trim() || DEFAULT_API;
  state.userId = els.userId.value;
  localStorage.setItem('provee.apiBase', state.apiBase);
  localStorage.setItem('provee.userId', state.userId);
  refresh();
});

els.reload.addEventListener('click', refresh);
els.estado.addEventListener('change', refresh);

initControls();
refresh();
