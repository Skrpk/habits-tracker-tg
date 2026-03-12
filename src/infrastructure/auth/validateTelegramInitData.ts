import crypto from 'crypto';

/**
 * Validates Telegram Web App initData by verifying the HMAC-SHA256 signature.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  return expectedHash === hash;
}

/**
 * Parses user info and auth_date from Telegram initData string.
 * Call only after validation succeeds.
 */
export function parseTelegramInitData(initData: string): {
  user: { id: number; first_name?: string; last_name?: string; username?: string } | null;
  authDate: number;
} {
  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const user = userStr ? JSON.parse(userStr) : null;
  return { user, authDate };
}

const MAX_AUTH_AGE_SECONDS = 86400; // 24 hours

/**
 * Returns true if the auth_date is within the allowed age window.
 */
export function isAuthDateValid(authDate: number): boolean {
  const age = Math.floor(Date.now() / 1000) - authDate;
  return age >= 0 && age <= MAX_AUTH_AGE_SECONDS;
}
