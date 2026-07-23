export const SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:manage:polls',
  'channel:read:polls',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'channel:manage:redemptions',
];

const AUTH = 'https://id.twitch.tv/oauth2';

export function authorizeUrl(clientId: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
  });
  return `${AUTH}/authorize?${p.toString()}`;
}

async function tokenRequest(body: URLSearchParams, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token request failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { accessToken: j.access_token as string, refreshToken: j.refresh_token as string };
}

export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri,
  }), fetchImpl);
}

export function refresh(clientId: string, clientSecret: string, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }), fetchImpl);
}

export async function validate(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ login: string; userId: string }> {
  const res = await fetchImpl(`${AUTH}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (!res.ok) throw new Error(`Validate failed ${res.status}`);
  const j = await res.json();
  return { login: j.login, userId: j.user_id };
}
