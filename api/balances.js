import { getWeek } from '../src/google.mjs';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DASHBOARD_REQUEST_HEADER = 'AROPET-Dashboard';
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function validateDashboardRequest(request, searchParams) {
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  const keys = [...searchParams.keys()];
  if (contentLength > 0 || keys.length > 1 ||
      (keys.length === 1 && (keys[0] !== 'week' || !searchParams.get('week') || searchParams.get('week').length > 256))) {
    return 400;
  }

  // These browser request headers are not an authentication mechanism.
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  if (!accept.includes('application/json') ||
      request.headers.get('x-requested-with') !== DASHBOARD_REQUEST_HEADER ||
      request.headers.get('sec-fetch-site')?.toLowerCase() !== 'same-origin') {
    return 403;
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const invalidStatus = validateDashboardRequest(request, searchParams);
  if (invalidStatus) return Response.json({
    error: invalidStatus === 400 ? '잘못된 요청입니다.' : '대시보드에서 다시 조회해 주세요.',
  }, { status: invalidStatus, headers });

  const { GOOGLE_API, GOOGLE_SHEET_ID } = process.env;
  if (!GOOGLE_API || !GOOGLE_SHEET_ID) {
    return Response.json({ error: '구글시트 연결 설정을 확인해 주세요.' }, { status: 503, headers });
  }

  try {
    const report = await getWeek(GOOGLE_API, searchParams.get('week'), GOOGLE_SHEET_ID);
    if (!report) return Response.json({ error: '선택한 주차를 찾을 수 없습니다.' }, { status: 404, headers });
    const payload = JSON.stringify({ ...report, mode: 'live' });
    if (Buffer.byteLength(payload, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Dashboard response exceeds safe size');
    return new Response(payload, { headers: {
      ...headers,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'inline; filename="dashboard.json"',
      'Vary': 'Accept, Accept-Encoding, Sec-Fetch-Site, X-Requested-With',
    } });
  } catch {
    return Response.json({ error: '잔액을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, {
      status: 502, headers,
    });
  }
}
