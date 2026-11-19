const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isRecord = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const toIsoString = value => (typeof value === 'string' && value.length > 0 ? value : null);

function nearestReset(...dates) {
  let best = null;
  let bestTime = Number.POSITIVE_INFINITY;

  for (const iso of dates) {
    if (iso === null)
      continue;

    const time = Date.parse(iso);
    if (Number.isNaN(time) || time >= bestTime)
      continue;

    bestTime = time;
    best = iso;
  }

  return best;
}

function summarizeCredit(included, purchasedUsd) {
  const remainingUsd = toNumber(included.balance_usd);
  const allowanceUsd = toNumber(included.allowance_usd);
  const period = isRecord(included.period) ? included.period : {};

  const percent = remainingUsd !== null && allowanceUsd !== null && allowanceUsd > 0
    ? clamp((remainingUsd / allowanceUsd) * 100, 0, 100)
    : null;

  return {
    percent,
    remainingUsd,
    allowanceUsd,
    purchasedUsd,
    resetsAt: toIsoString(period.until),
    mode: 'credit',
  };
}

function summarizeLegacy(included, purchasedUsd) {
  const session = isRecord(included.session) ? included.session : {};
  const weekly = isRecord(included.weekly) ? included.weekly : {};

  const candidates = [toNumber(session.remaining_percent), toNumber(weekly.remaining_percent)]
    .filter(value => value !== null);

  const percent = candidates.length > 0 ? clamp(Math.min(...candidates), 0, 100) : null;

  return {
    percent,
    remainingUsd: null,
    allowanceUsd: null,
    purchasedUsd,
    resetsAt: nearestReset(toIsoString(session.resets_at), toIsoString(weekly.resets_at)),
    mode: 'legacy',
  };
}

/**
 * Normalisasi respons GET /api/balance menjadi ringkasan kuota.
 *
 * Bentuk baru memakai saldo kredit (`balance_usd` / `allowance_usd`);
 * bentuk lama memakai persen sesi dan mingguan. Persen tidak dibulatkan
 * di sini dan selalu di-clamp ke 0..100.
 *
 * @param {unknown} json Respons mentah API.
 * @returns {{percent: number|null, remainingUsd: number|null, allowanceUsd: number|null, purchasedUsd: number, resetsAt: string|null, mode: 'credit'|'legacy'}}
 */
export function summarizeBalance(json) {
  const root = isRecord(json) ? json : {};
  const included = isRecord(root.included) ? root.included : {};
  const purchased = isRecord(root.purchased) ? root.purchased : {};
  const purchasedUsd = toNumber(purchased.balance_usd) ?? 0;

  if (toNumber(included.balance_usd) !== null)
    return summarizeCredit(included, purchasedUsd);

  if (isRecord(included.session) || isRecord(included.weekly))
    return summarizeLegacy(included, purchasedUsd);

  return {
    percent: null,
    remainingUsd: null,
    allowanceUsd: null,
    purchasedUsd,
    resetsAt: null,
    mode: 'credit',
  };
}

/**
 * Format nominal USD dua desimal. Nilai tidak valid menghasilkan em dash.
 *
 * @param {unknown} value Nominal.
 * @returns {string} Contoh: "$72.50", "-$5.50", "—".
 */
export function formatUsd(value) {
  if (value === null || value === undefined || value === '')
    return '—';

  const amount = Number(value);
  if (!Number.isFinite(amount))
    return '—';

  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/**
 * Teks indikator panel: persen bila tersedia, lalu saldo USD, lalu em dash.
 *
 * @param {{percent?: number|null, remainingUsd?: number|null}|null} summary Ringkasan kuota.
 * @returns {string} Contoh: "72%", "$72.50", "—".
 */
export function formatPanel(summary) {
  if (!summary)
    return '—';

  if (Number.isFinite(summary.percent))
    return `${Math.round(summary.percent)}%`;

  if (Number.isFinite(summary.remainingUsd))
    return formatUsd(summary.remainingUsd);

  return '—';
}
