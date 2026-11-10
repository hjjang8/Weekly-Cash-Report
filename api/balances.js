import { readFileSync } from 'node:fs';
import { getWeek } from '../src/google.mjs';

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, noarchive',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const pageHeaders = {
  ...headers,
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
export async function GET(request) {
  const { pathname, searchParams } = new URL(request.url);
  const asset = searchParams.get('_report_asset');
  if (pathname === '/' || asset === 'page') {
    return new Response(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), { headers: pageHeaders });
  }
  if (pathname === '/app.js' || asset === 'script') {
    return new Response(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), {
      headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
    });
  }
  const { GOOGLE_API, GOOGLE_SHEET_ID } = process.env;
  if (!GOOGLE_API || !GOOGLE_SHEET_ID) {
    return Response.json({ error: '구글시트 연결 설정을 확인해 주세요.' }, { status: 503, headers });
  }

  try {
    const report = await getWeek(GOOGLE_API, searchParams.get('week'), GOOGLE_SHEET_ID);
    if (!report) return Response.json({ error: '선택한 주차를 찾을 수 없습니다.' }, { status: 404, headers });
    return Response.json({ ...report, mode: 'live' }, { headers });
  } catch {
    return Response.json({ error: '잔액을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, {
      status: 502, headers,
    });
  }
}
