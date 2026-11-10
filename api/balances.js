import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getWeek } from '../src/google.mjs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Authorization',
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
const digest = value => createHash('sha256').update(value).digest();

function authorized(request, password) {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return false;
  return timingSafeEqual(digest(Buffer.from(match[1], 'base64')), digest('report:' + password));
}

export async function GET(request) {
  const password = process.env.REPORT_PASSWORD;
  if (!password) return new Response('보고서 비밀번호를 설정해 주세요.', { status: 503, headers });
  if (!authorized(request, password)) {
    return new Response('로그인이 필요합니다.', {
      status: 401,
      headers: { ...headers, 'WWW-Authenticate': 'Basic realm="AROPET Weekly Cash Report", charset="UTF-8"' },
    });
  }

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
