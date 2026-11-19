import assert from 'node:assert/strict';
import test from 'node:test';

import {formatPanel, formatUsd, quotaFraction, summarizeBalance} from '../lib/balance.js';

const RESET_SOON = '2026-12-01T00:00:00Z';
const RESET_LATER = '2026-12-08T00:00:00Z';

test('bentuk credit: persen dari saldo dibagi allowance tanpa pembulatan', () => {
  const summary = summarizeBalance({
    included: {
      balance_usd: 72.5,
      allowance_usd: 100,
      period: {from: '2026-11-01T00:00:00Z', until: RESET_SOON},
    },
    purchased: {balance_usd: 27.5},
  });

  assert.deepEqual(summary, {
    percent: 72.5,
    remainingUsd: 72.5,
    allowanceUsd: 100,
    purchasedUsd: 27.5,
    resetsAt: RESET_SOON,
    mode: 'credit',
  });
});

test('bentuk credit: allowance 0 menghasilkan percent null', () => {
  const summary = summarizeBalance({
    included: {balance_usd: 5, allowance_usd: 0},
    purchased: {balance_usd: 5},
  });

  assert.equal(summary.mode, 'credit');
  assert.equal(summary.percent, null);
  assert.equal(summary.remainingUsd, 5);
  assert.equal(summary.purchasedUsd, 5);
  assert.equal(summary.resetsAt, null);
});

test('persen di-clamp ke 0..100', () => {
  const high = summarizeBalance({included: {balance_usd: 150, allowance_usd: 100}});
  assert.equal(high.percent, 100);

  const low = summarizeBalance({included: {balance_usd: -20, allowance_usd: 100}});
  assert.equal(low.percent, 0);
});

test('bentuk legacy: ambil persen terkecil dan reset terdekat', () => {
  const summary = summarizeBalance({
    included: {
      session: {remaining_percent: 80, resets_at: RESET_SOON},
      weekly: {remaining_percent: 65, resets_at: RESET_LATER},
    },
  });

  assert.equal(summary.mode, 'legacy');
  assert.equal(summary.percent, 65);
  assert.equal(summary.remainingUsd, null);
  assert.equal(summary.allowanceUsd, null);
  assert.equal(summary.purchasedUsd, 0);
  assert.equal(summary.resetsAt, RESET_SOON);
});

test('bentuk legacy: reset terdekat dipilih dari dua tanggal', () => {
  const summary = summarizeBalance({
    included: {
      session: {remaining_percent: 90, resets_at: RESET_LATER},
      weekly: {remaining_percent: 40, resets_at: RESET_SOON},
    },
  });

  assert.equal(summary.percent, 40);
  assert.equal(summary.resetsAt, RESET_SOON);
});

test('bentuk legacy: persen hilang menjadi null', () => {
  const summary = summarizeBalance({included: {session: {resets_at: RESET_SOON}}});

  assert.equal(summary.mode, 'legacy');
  assert.equal(summary.percent, null);
  assert.equal(summary.resetsAt, RESET_SOON);
});

test('formatPanel memakai persen dibulatkan bila tersedia', () => {
  assert.equal(formatPanel({percent: 72.4, remainingUsd: 72.4}), '72%');
  assert.equal(formatPanel({percent: 72.6, remainingUsd: 72.6}), '73%');
  assert.equal(formatPanel({percent: 0, remainingUsd: 0}), '0%');
  assert.equal(formatPanel({percent: 100, remainingUsd: 0}), '100%');
});

test('formatPanel jatuh ke USD lalu em dash', () => {
  assert.equal(formatPanel({percent: null, remainingUsd: 72.5}), '$72.50');
  assert.equal(formatPanel({percent: null, remainingUsd: 0}), '$0.00');
  assert.equal(formatPanel({percent: null, remainingUsd: null}), '—');
  assert.equal(formatPanel(null), '—');
});

test('formatUsd membulatkan dua desimal dan menolak nilai tidak valid', () => {
  assert.equal(formatUsd(72.456), '$72.46');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(100), '$100.00');
  assert.equal(formatUsd(-5.5), '-$5.50');
  assert.equal(formatUsd(null), '—');
  assert.equal(formatUsd(undefined), '—');
  assert.equal(formatUsd('abc'), '—');
});

test('quotaFraction memetakan persen ke 0..1 dan menolak nilai kosong', () => {
  assert.equal(quotaFraction(72.5), 0.725);
  assert.equal(quotaFraction(0), 0);
  assert.equal(quotaFraction(100), 1);
  assert.equal(quotaFraction(150), 1);
  assert.equal(quotaFraction(-20), 0);
  assert.equal(quotaFraction(null), null);
  assert.equal(quotaFraction(undefined), null);
  assert.equal(quotaFraction('72'), null);
});
