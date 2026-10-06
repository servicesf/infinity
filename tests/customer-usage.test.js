import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCustomer } from '../api/customer.js';

const customer = {
  id: 'customer-1',
  full_name: 'Cliente Prueba',
  ci: '12345',
  phone: '',
  sector: 'Centro',
  plan_name: 'Fibra 50 Mbps',
  monthly_price: 149,
  status: 'activo',
  paid_until: '2026-11-05T12:00:00Z',
  auto_cut_enabled: true,
  pppoe_user: 'clienteprueba'
};

function payment(overrides) {
  return {
    id: 'payment',
    status: 'confirmado',
    amount: 149,
    method: 'manual',
    reference: '',
    created_at: '2026-09-01T12:00:00Z',
    paid_at: '2026-09-01T12:00:00Z',
    qr_payload: null,
    ...overrides
  };
}

test('muestra el consumo del pago confirmado mas reciente como ciclo actual', () => {
  const result = normalizeCustomer(customer, [
    payment({
      id: 'old',
      paid_at: '2026-09-01T12:00:00Z',
      qr_payload: { usage: { downloadBytes: 40, uploadBytes: 10 } }
    }),
    payment({ id: 'rejected', status: 'rechazado', paid_at: '2026-10-05T12:00:00Z' }),
    payment({
      id: 'current',
      paid_at: '2026-10-01T12:00:00Z',
      qr_payload: {
        usage: {
          downloadBytes: 120,
          uploadBytes: 30,
          cycleStartedAt: '2026-10-01T12:00:00Z',
          lastSeenAt: '2026-10-06T12:00:00Z'
        }
      }
    })
  ]);

  assert.equal(result.consumo.totalBytes, 150);
  assert.equal(result.consumo.descargaBytes, 120);
  assert.equal(result.ultimosPagos[0].id, 'current');
  assert.equal(result.ultimosPagos[0].consumoBytes, 150);
  assert.equal(result.ultimosPagos[1].consumoBytes, 50);
  assert.equal(result.ultimosPagos.length, 2);
});

test('mantiene el portal disponible aunque aun no exista una lectura', () => {
  const result = normalizeCustomer(customer, [payment({ id: 'without-usage' })]);
  assert.equal(result.consumo, null);
  assert.equal(result.consumoPendiente, true);
  assert.equal(result.ultimosPagos[0].consumoBytes, null);
});
