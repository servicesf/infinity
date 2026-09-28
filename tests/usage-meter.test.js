import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildUsageSnapshot, parseCounterPair } = require('../tools/usage-meter.cjs');

test('interpreta contadores dobles de RouterOS', () => {
  assert.deepEqual(parseCounterPair('1200/3400'), [1200, 3400]);
  assert.deepEqual(parseCounterPair('1 200/3 400'), [1200, 3400]);
});

test('inicia cada recarga en cero usando el contador actual como base', () => {
  const snapshot = buildUsageSnapshot({
    previous: null,
    current: { downloadBytes: 9000, uploadBytes: 2000 },
    source: 'pppoe',
    counterKey: 'session-1',
    cycleStartedAt: '2026-09-28T10:00:00.000Z',
    observedAt: '2026-09-28T10:01:00.000Z'
  });

  assert.equal(snapshot.downloadBytes, 0);
  assert.equal(snapshot.uploadBytes, 0);
  assert.equal(snapshot.lastDownloadCounter, 9000);
});

test('suma solo la diferencia mientras sigue el mismo contador', () => {
  const snapshot = buildUsageSnapshot({
    previous: {
      version: 2,
      cycleStartedAt: '2026-09-28T10:00:00.000Z',
      counterKey: 'queue-1',
      downloadBytes: 500,
      uploadBytes: 200,
      lastDownloadCounter: 10000,
      lastUploadCounter: 4000
    },
    current: { downloadBytes: 12500, uploadBytes: 4750 },
    source: 'simple-queue',
    counterKey: 'queue-1',
    cycleStartedAt: '2026-09-28T10:00:00.000Z',
    observedAt: '2026-09-28T10:05:00.000Z'
  });

  assert.equal(snapshot.downloadBytes, 3000);
  assert.equal(snapshot.uploadBytes, 950);
});

test('continua sumando si la sesion cambia o el contador se reinicia', () => {
  const changedSession = buildUsageSnapshot({
    previous: {
      version: 2,
      cycleStartedAt: '2026-09-28T10:00:00.000Z',
      counterKey: 'session-1',
      downloadBytes: 5000,
      uploadBytes: 1000,
      lastDownloadCounter: 20000,
      lastUploadCounter: 8000
    },
    current: { downloadBytes: 1200, uploadBytes: 300 },
    source: 'pppoe',
    counterKey: 'session-2',
    cycleStartedAt: '2026-09-28T10:00:00.000Z',
    observedAt: '2026-09-28T11:00:00.000Z'
  });

  assert.equal(changedSession.downloadBytes, 6200);
  assert.equal(changedSession.uploadBytes, 1300);
});
