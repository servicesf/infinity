import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { evaluateReceipt, parseAiJson, parseReceiptDataUrl } from '../api/_receipt.js';

const recipient = 'Lorenzo Martir Flores Alaya';

test('acepta para revision cuando coinciden monto, destinatario y fecha', () => {
  const evaluation = evaluateReceipt({
    recipient: 'LORENZO MARTIR FLORES ALAYA',
    amount: 149,
    transactionDate: new Date().toISOString(),
    successful: false,
    confidence: 0.4
  }, 149, recipient);
  assert.equal(evaluation.eligible, true);
  assert.equal(evaluation.requiresAdminConfirmation, true);
});

test('no aprueba automaticamente destinatario incorrecto ni fecha antigua', () => {
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const evaluation = evaluateReceipt({
    isReceipt: true,
    recipient: 'Otra Persona',
    amount: 149,
    transactionDate: oldDate,
    successful: true,
    confidence: 0.95
  }, 149, recipient);
  assert.equal(evaluation.eligible, false);
  assert.equal(evaluation.checks.recipient, false);
  assert.equal(evaluation.checks.recentDate, false);
});

test('mantiene solamente los tres controles esenciales', () => {
  const evaluation = evaluateReceipt({
    recipient: 'Lorenzo Martir Flores Alaya',
    amount: 149,
    transactionDate: new Date().toISOString()
  }, 149, recipient);
  assert.deepEqual(Object.keys(evaluation.checks), ['amount', 'recipient', 'recentDate']);
});

test('acepta el nombre en otro orden y la variante Ayala', () => {
  const evaluation = evaluateReceipt({
    recipient: 'FLORES MARTIR LORENZO AYALA',
    amount: 149,
    transactionDate: new Date().toISOString()
  }, 149, recipient);
  assert.equal(evaluation.checks.recipient, true);
  assert.equal(evaluation.eligible, true);
});

test('extrae JSON aunque el modelo agregue un bloque markdown', () => {
  assert.deepEqual(parseAiJson('```json\n{"isReceipt":true}\n```'), { isReceipt: true });
});

test('valida una imagen JPEG real antes de subirla', () => {
  const image = fs.readFileSync(new URL('../imagenes/QROFICIAL.jpeg', import.meta.url));
  const parsed = parseReceiptDataUrl(`data:image/jpeg;base64,${image.toString('base64')}`);
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.buffer.length, image.length);
});
