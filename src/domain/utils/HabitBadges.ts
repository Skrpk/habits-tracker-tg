import { Badge, BadgeType } from '../entities/Habit';

/**
 * Badge milestones
 */
export const BADGE_MILESTONES: BadgeType[] = [5, 10, 30, 90];

/**
 * Badge emoji mapping
 */
export const BADGE_EMOJIS: Record<BadgeType, string> = {
  5: '🔥',
  10: '⭐',
  30: '🏆',
  90: '💎',
};

/**
 * Badge names
 */
export const BADGE_NAMES: Record<BadgeType, string> = {
  5: '5 Days',
  10: '10 Days',
  30: '30 Days',
  90: '90 Days',
};

/**
 * Check if badges should be awarded for a given streak
 * Returns array of badge types that should be awarded (can be multiple if streak jumped past milestones)
 */
export function checkForNewBadges(currentStreak: number, existingBadges: Badge[] = []): BadgeType[] {
  // Get badges that haven't been earned yet
  const earnedBadgeTypes = new Set(existingBadges.map(b => b.type));
  
  // Check each milestone and collect all badges that should be awarded
  const badgesToAward: BadgeType[] = [];
  for (const milestone of BADGE_MILESTONES) {
    // Award badge if streak reaches milestone and badge hasn't been earned yet
    if (currentStreak >= milestone && !earnedBadgeTypes.has(milestone)) {
      badgesToAward.push(milestone);
    }
  }
  
  return badgesToAward;
}

/**
 * Award a badge and return updated badges array
 */
export function awardBadge(badgeType: BadgeType, existingBadges: Badge[] = []): Badge[] {
  // Check if badge already exists
  const alreadyEarned = existingBadges.some(b => b.type === badgeType);
  if (alreadyEarned) {
    return existingBadges;
  }
  
  // Add new badge
  const newBadge: Badge = {
    type: badgeType,
    earnedAt: new Date().toISOString(),
  };
  
  return [...existingBadges, newBadge].sort((a, b) => a.type - b.type);
}

/**
 * Award multiple badges at once
 */
export function awardBadges(badgeTypes: BadgeType[], existingBadges: Badge[] = []): Badge[] {
  let updatedBadges = existingBadges;
  for (const badgeType of badgeTypes) {
    updatedBadges = awardBadge(badgeType, updatedBadges);
  }
  return updatedBadges;
}

/**
 * Get badge display info
 */
export function getBadgeInfo(badgeType: BadgeType): { emoji: string; name: string } {
  return {
    emoji: BADGE_EMOJIS[badgeType],
    name: BADGE_NAMES[badgeType],
  };
}

/**
 * Get all earned badges for a habit
 */
export function getEarnedBadges(badges: Badge[] = []): Badge[] {
  return badges.sort((a, b) => a.type - b.type);
}
