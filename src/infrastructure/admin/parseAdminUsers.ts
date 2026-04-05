/**
 * Telegram user IDs allowed to use the Admin Panel (from ADMIN_USERS env, JSON array).
 */
export function parseAdminUsers(): number[] {
  const raw = process.env.ADMIN_USERS;
  if (!raw || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(id => (typeof id === 'number' ? id : parseInt(String(id), 10)))
      .filter(id => !Number.isNaN(id));
  } catch {
    return [];
  }
}

export function isAdminUser(userId: number): boolean {
  return parseAdminUsers().includes(userId);
}
