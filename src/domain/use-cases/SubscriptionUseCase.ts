import { IHabitRepository } from '../repositories/IHabitRepository';
import type { UserPreferences } from '../entities/UserPreferences';
import { Logger } from '../../infrastructure/logger/Logger';

const MONTHLY_PERIOD_DAYS = 31;
const ANNUAL_PERIOD_DAYS = 365;

function isExpiredPremium(premiumDate: string, premiumType?: 'monthly' | 'annual'): boolean {
  const periodDays = premiumType === 'annual' ? ANNUAL_PERIOD_DAYS : MONTHLY_PERIOD_DAYS;
  const expiry = new Date(premiumDate);
  expiry.setDate(expiry.getDate() + periodDays);
  return expiry < new Date();
}

/** Lifetime or active paid subscription (not expired). */
export function userHasPremiumAccess(prefs: UserPreferences | null): boolean {
  if (!prefs) return false;
  if (prefs.isLifetimePremium === true) return true;
  if (!prefs.premium || !prefs.premiumDate) return false;
  return !isExpiredPremium(prefs.premiumDate, prefs.premiumType);
}

export class SubscriptionUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async isSubscribed(userId: number): Promise<boolean> {
    const prefs = await this.habitRepository.getUserPreferences(userId);
    return userHasPremiumAccess(prefs);
  }

  async activateSubscription(userId: number, premiumType: 'monthly' | 'annual' = 'monthly'): Promise<void> {
    const now = new Date().toISOString();
    await this.habitRepository.saveUserPreferences({
      userId,
      premium: true,
      premiumDate: now,
      premiumType,
    });
    Logger.info('Subscription activated', { userId, premiumDate: now, premiumType });
  }

  async extendSubscription(userId: number): Promise<void> {
    const prefs = await this.habitRepository.getUserPreferences(userId);
    const now = new Date().toISOString();
    await this.habitRepository.saveUserPreferences({
      userId,
      premium: true,
      premiumDate: now,
      premiumType: prefs?.premiumType ?? 'monthly',
    });
    Logger.info('Subscription extended', { userId, premiumDate: now });
  }

  async revokeSubscription(userId: number): Promise<string[]> {
    await this.habitRepository.saveUserPreferences({
      userId,
      premium: false,
    });

    const maxFree = parseInt(process.env.MAX_FREE_HABITS || '3', 10);
    const userHabits = await this.habitRepository.getUserHabits(userId);
    if (!userHabits) return [];

    const sorted = [...userHabits.habits].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const disabledNames: string[] = [];
    let changed = false;

    for (let i = 0; i < sorted.length; i++) {
      if (i >= maxFree && !sorted[i].disabled) {
        sorted[i].disabled = true;
        disabledNames.push(sorted[i].name);
        changed = true;
      }
    }

    if (changed) {
      userHabits.habits = sorted;
      await this.habitRepository.saveUserHabits(userHabits);
    }

    Logger.info('Subscription revoked', { userId, disabledCount: disabledNames.length });
    return disabledNames;
  }

  async checkAndRevokeExpired(allUserIds: number[]): Promise<Array<{ userId: number; disabledHabits: string[]; premiumType?: 'monthly' | 'annual' }>> {
    const results: Array<{ userId: number; disabledHabits: string[]; premiumType?: 'monthly' | 'annual' }> = [];

    for (const userId of allUserIds) {
      const prefs = await this.habitRepository.getUserPreferences(userId);
      if (prefs?.isLifetimePremium === true) continue;
      if (!prefs?.premium || !prefs.premiumDate) continue;

      if (isExpiredPremium(prefs.premiumDate, prefs.premiumType)) {
        const premiumType = prefs.premiumType;
        const disabledHabits = await this.revokeSubscription(userId);
        results.push({ userId, disabledHabits, premiumType });
        Logger.info('Expired subscription revoked', { userId, disabledCount: disabledHabits.length, premiumType });
      }
    }

    return results;
  }
}
