const get = id => document.getElementById(id);
const format = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const exact = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const weekSelect = get('weekSelect');
const dateLabel = date => date.replaceAll('-', '. ') + '.';
let displayedWeek = '';
let balanceChart;

function renderBalance(id, balance, note) {
  const card = get(id);
  const amount = card.querySelector('[data-amount]');
  const unit = card.querySelector('.unit');
  amount.textContent = balance ? format.format(balance.amount / 100000000) : '—';
  unit.hidden = !balance;
  card.querySelector('[data-note]').textContent = note;
  if (balance) amount.parentElement.title = exact.format(balance.amount) + '원';
  else amount.parentElement.removeAttribute('title');
}

function renderTrend(trend = []) {
  const canvas = get('balanceChart');
  const status = get('trendStatus');
  balanceChart?.destroy();
  balanceChart = undefined;
  canvas.hidden = true;
  status.hidden = false;
  if (!trend.some(point => point.amount !== null)) {
    status.textContent = '일자별 합산 잔액이 없습니다.';
    return;
  }
  const { Chart, ChartDataLabels } = window;
  if (!Chart || !ChartDataLabels) {
    status.textContent = '그래프를 불러오지 못했습니다.';
    return;
  }

  const label = '합산 잔액';
  const labels = trend.map(({ date }) => date.slice(5).replace('-', '/'));
  const amounts = trend.map(({ amount }) => amount === null ? null : Math.round(amount / 1e7) / 10);
  canvas.setAttribute('aria-label', '일자별 합산 잔액 (억원). ' + labels.map((date, index) =>
    date + ' ' + (amounts[index] === null ? '집계 없음' : format.format(amounts[index])),
  ).join(', '));
  canvas.hidden = false;
  status.hidden = true;
  balanceChart = new Chart(canvas, {
    type: 'line',
    plugins: [ChartDataLabels],
    data: {
      labels,
      datasets: [{
        label,
        data: amounts,
        borderColor: '#A83D56',
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        pointBackgroundColor: '#A83D56',
        pointBorderColor: '#A83D56',
        pointBorderWidth: 0,
        pointRadius: 4,
        pointHoverRadius: 6,
        datalabels: {
          display: ctx => amounts[ctx.dataIndex] !== null,
          color: '#A83D56',
          font: { size: 11, weight: 'bold' },
          anchor: 'end',
          align: 'top',
          formatter: value => format.format(value),
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
          position: 'top',
          align: 'end',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: '#4B5768', font: { size: 12 } },
        },
        tooltip: {
          backgroundColor: '#321D28',
          cornerRadius: 8,
          padding: 10,
          titleFont: { size: 12 },
          bodyFont: { size: 12.5 },
          callbacks: { label: ctx => label + ': ' + format.format(ctx.parsed.y) + '억원' },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#7C8898', font: { size: 11.5 } } },
        y: { grace: '12%', grid: { color: '#EEF1F5' }, ticks: { color: '#7C8898', font: { size: 11.5 }, callback: value => value + '억' } },
      },
    },
  });
}

function renderMovements(movements) {
  const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  const amount = value => Number.isFinite(value) ? number.format(value) : '—';
  const rows = movements.map(({ date, increase, decrease, net, closing }) => {
    const row = document.createElement('tr');
    const formattedNet = (net > 0 ? '+' : '') + amount(net);
    const values = [dateLabel(date), amount(increase), amount(decrease), formattedNet, amount(closing)];
    const classes = ['', 'movement-up', 'movement-down', net > 0 ? 'movement-up' : net < 0 ? 'movement-down' : '', ''];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      cell.className = classes[index];
      row.append(cell);
    });
    return row;
  });
  get('movementRows').replaceChildren(...rows);
}

async function loadBalances(requestedWeek) {
  weekSelect.disabled = true;
  get('kpis').setAttribute('aria-busy', 'true');
  get('status').textContent = '';
  try {
    const query = requestedWeek ? '?' + new URLSearchParams({ week: requestedWeek }) : '';
    const response = await fetch('/api/balances' + query, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'AROPET-Dashboard' },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '잔액 조회에 실패했습니다.');
    const preview = data.mode === 'preview';
    weekSelect.replaceChildren(...data.weeks.map(week => new Option(week, week)));
    weekSelect.value = data.week;
    for (const [id, balance] of Object.entries(data.balances)) {
      const date = balance ? dateLabel(balance.date) + ' 기준' : '잔액 미등록';
      renderBalance(id, balance, balance && id === 'fx' ? date + ' · 원화 환산' : date);
    }
    const total = data.total;
    renderBalance('total', total, total
      ? (total.date ? dateLabel(total.date) + ' 기준' : '항목별 최신 잔액 합산')
      : '집계 대기');
    get('footer').textContent = preview
      ? '구글 스프레드시트에서 확인한 잔액으로 만든 미리보기 · 경영지원실'
      : '본 보고서는 구글 스프레드시트 데이터와 실시간 연동됩니다. · 경영지원실';
    renderMovements(data.movements ?? []);
    displayedWeek = data.week;
    try {
      renderTrend(data.trend);
    } catch {
      get('balanceChart').hidden = true;
      get('trendStatus').hidden = false;
      get('trendStatus').textContent = '그래프를 표시하지 못했습니다.';
    }
  } catch (error) {
    get('status').textContent = displayedWeek
      ? '잔액 조회에 실패해 마지막으로 조회한 주차를 표시합니다.'
      : error.message;
    weekSelect.value = displayedWeek;
    if (!displayedWeek) {
      weekSelect.options[0].textContent = '주차 조회 실패';
      get('trendStatus').textContent = '잔액 추이를 조회하지 못했습니다.';
      for (const id of ['krw', 'deposit', 'fx', 'total']) renderBalance(id, null, '조회 대기');
    }
  } finally {
    weekSelect.disabled = !displayedWeek;
    get('kpis').setAttribute('aria-busy', 'false');
  }
}

window.lucide?.createIcons();
weekSelect.addEventListener('change', () => loadBalances(weekSelect.value));
loadBalances();
