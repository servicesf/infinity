'use strict';

const USAGE_VERSION = 2;

function byteCount(value) {
  const parsed = Number(String(value ?? '').replace(/\s+/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function parseCounterPair(value) {
  const parts = String(value ?? '').trim().split(/[\/,]/);
  return [byteCount(parts[0]), byteCount(parts[1])];
}

function counterDelta(current, previous, sameCounter) {
  if (!sameCounter) return current;
  return current >= previous ? current - previous : current;
}

function buildUsageSnapshot({ previous, current, source, counterKey, cycleStartedAt, observedAt }) {
  const downloadCounter = byteCount(current?.downloadBytes);
  const uploadCounter = byteCount(current?.uploadBytes);
  const previousCycle = String(previous?.cycleStartedAt || '');
  const currentCycle = String(cycleStartedAt || '');
  const sameCycle = Boolean(
    previous
    && Number(previous.version || 0) === USAGE_VERSION
    && previousCycle === currentCycle
  );

  if (!sameCycle) {
    return {
      version: USAGE_VERSION,
      source,
      counterKey,
      cycleStartedAt: currentCycle,
      downloadBytes: 0,
      uploadBytes: 0,
      lastDownloadCounter: downloadCounter,
      lastUploadCounter: uploadCounter,
      lastSeenAt: observedAt
    };
  }

  const sameCounter = String(previous.counterKey || '') === String(counterKey || '');
  const downloadDelta = counterDelta(
    downloadCounter,
    byteCount(previous.lastDownloadCounter),
    sameCounter
  );
  const uploadDelta = counterDelta(
    uploadCounter,
    byteCount(previous.lastUploadCounter),
    sameCounter
  );

  return {
    version: USAGE_VERSION,
    source,
    counterKey,
    cycleStartedAt: currentCycle,
    downloadBytes: byteCount(previous.downloadBytes) + downloadDelta,
    uploadBytes: byteCount(previous.uploadBytes) + uploadDelta,
    lastDownloadCounter: downloadCounter,
    lastUploadCounter: uploadCounter,
    lastSeenAt: observedAt
  };
}

module.exports = {
  buildUsageSnapshot,
  byteCount,
  parseCounterPair
};
