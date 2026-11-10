import { summarize } from './balances.mjs';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const encoder = new TextEncoder();

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function atStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    console.error('weekly-cash-report:', stage, error instanceof Error ? error.name : 'UnknownError');
    throw error;
  }
}

async function getJson(stage, url, init) {
  return atStage(stage, async () => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.error('weekly-cash-report:', stage, 'HTTP', response.status);
      throw new Error('Google request failed');
    }
    return response.json();
  });
}

async function accessToken(config) {
  const { client_email, private_key } = await atStage('service-account-json', () => {
    const account = JSON.parse(config);
    if (typeof account?.client_email !== 'string' || !account.client_email ||
        typeof account.private_key !== 'string' || !account.private_key) {
      throw new Error('Invalid service account');
    }
    return account;
  });

  const key = await atStage('service-account-key', () => {
    const pem = private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    return crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), {
      name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256',
    }, false, ['sign']);
  });
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: tokenUrl,
    iat: issuedAt,
    exp: issuedAt + 300,
  };
  const jwt = [{ alg: 'RS256', typ: 'JWT' }, claims]
    .map(value => base64url(encoder.encode(JSON.stringify(value)))).join('.');
  const signature = await atStage('service-account-signature', () =>
    crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(jwt)),
  );
  const result = await getJson('oauth-token', tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt + '.' + base64url(new Uint8Array(signature)),
    }),
  });
  if (typeof result.access_token !== 'string') throw new Error('Missing Google token');
  return result.access_token;
}

export async function getWeek(config, requestedWeek, spreadsheetId) {
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId ?? '')) throw new Error('Invalid spreadsheet ID');
  const sheetsUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  const token = await accessToken(config);
  const init = { headers: { Authorization: 'Bearer ' + token } };
  const metadata = await getJson('sheet-metadata', sheetsUrl + '?fields=sheets(properties(index,title,sheetType,hidden))', init);
  const weeks = (metadata.sheets ?? []).map(sheet => sheet.properties)
    .filter(sheet => sheet.sheetType === 'GRID' && !sheet.hidden)
    .sort((a, b) => a.index - b.index)
    .map(sheet => sheet.title);
  if (!weeks.length) throw new Error('Missing weekly tabs');
  const week = requestedWeek ?? weeks[0];
  if (!weeks.includes(week)) return null;
  const range = "'" + week.replaceAll("'", "''") + "'!C:O";
  const result = await getJson('sheet-values', sheetsUrl + '/values/' + encodeURIComponent(range) +
    '?valueRenderOption=UNFORMATTED_VALUE', init);
  const summary = await atStage('balance-aggregation', () => summarize(week, result.values ?? []));
  return { ...summary, weeks };
}
