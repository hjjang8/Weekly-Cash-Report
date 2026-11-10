const headers = {
  kind: '계좌구분',
  currency: '통화',
  date: '시재일',
  raw: '잔액',
  converted: '잔액(환산)',
};

function balanceDate(value) {
  const input = String(value ?? '').trim();
  let date = input.replace(/[-.\/\s]/g, '');
  if (typeof value === 'number' && value >= 36526 && value < 73051) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString().slice(0, 10).replaceAll('-', '');
  }
  if (!/^\d{8}$/.test(date)) throw new Error('Invalid balance date');
  const iso = date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const parsed = new Date(iso);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error('Invalid balance date');
  }
  return iso;
}

function category(kind, currency) {
  if (kind === '수시입출' && currency === 'KRW') return 'krw';
  if (kind === '정기예적금') return 'deposit';
  if (kind === '외화수시입출' && currency && currency !== 'KRW') return 'fx';
  return null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function won(value) {
  if (!Number.isFinite(value)) {
    throw new Error('Invalid balance amount');
  }
  return value;
}

export function summarize(week, rows) {
  const [header = [], ...data] = rows;
  const columns = Object.fromEntries(Object.entries(headers).map(
    ([key, label]) => [key, header.findIndex(value => String(value).trim() === label)],
  ));
  if (Object.values(columns).includes(-1)) throw new Error('Missing balance headers');

  const latest = { krw: null, deposit: null, fx: null };
  const daily = new Map();
  for (const row of data) {
    const currency = String(row[columns.currency] ?? '').trim().toUpperCase();
    const key = category(String(row[columns.kind] ?? '').trim(), currency);
    if (!key || row[columns.date] === '' || row[columns.date] == null) continue;
    const date = balanceDate(row[columns.date]);
    if (!daily.has(date)) daily.set(date, {});
    const groups = daily.get(date);
    groups[key] ??= [];
    groups[key].push(row[currency === 'KRW' ? columns.raw : columns.converted]);
    if (!latest[key] || latest[key].date < date) latest[key] = { date, amounts: groups[key] };
  }

  const balances = Object.fromEntries(Object.entries(latest).map(([key, item]) => [
    key, item && { date: item.date, amount: sum(item.amounts.map(won)) },
  ]));
  const keys = Object.keys(balances);
  const trend = [...daily.keys()].sort().map(date => {
    const groups = daily.get(date);
    const complete = keys.every(key => groups[key]?.every(Number.isFinite));
    return {
      date,
      amount: complete ? sum(keys.map(key => sum(groups[key]))) : null,
    };
  });
  const available = Object.values(balances).filter(Boolean);
  const dates = [...new Set(available.map(item => item.date))].sort();
  return {
    week,
    asOf: dates.at(-1) ?? null,
    balances,
    trend,
    total: available.length === keys.length
      ? { date: dates.length === 1 ? dates[0] : null, amount: sum(available.map(item => item.amount)) }
      : null,
  };
}
