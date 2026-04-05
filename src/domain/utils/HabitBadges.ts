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
 * Badge type to celebration image number mapping.
 * First check image (1) is handled separately.
 */
export const BADGE_IMAGE_MAP: Record<BadgeType, number> = {
  5: 2,
  10: 3,
  30: 4,
  90: 5,
};

/**
 * Tree growth messages per badge milestone
 */
export const BADGE_TREE_MESSAGES: Record<BadgeType, string> = {
  5: 'Your sprout is growing strong!',
  10: 'Your habit is becoming a sapling!',
  30: 'A real tree now — standing tall!',
  90: 'Deep roots. This habit is part of who you are.',
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
 * Get the next badge milestone after the current streak.
 * Returns null if all badges have been earned or streak is past 90.
 */
export function getNextMilestone(currentStreak: number, earnedBadges: Badge[] = []): { daysLeft: number; milestone: BadgeType; emoji: string } | null {
  const earnedTypes = new Set(earnedBadges.map(b => b.type));
  for (const milestone of BADGE_MILESTONES) {
    if (currentStreak < milestone && !earnedTypes.has(milestone)) {
      return {
        daysLeft: milestone - currentStreak,
        milestone,
        emoji: BADGE_EMOJIS[milestone],
      };
    }
  }
  return null;
}

/**
 * Get all earned badges for a habit
 */
export function getEarnedBadges(badges: Badge[] = []): Badge[] {
  return badges.sort((a, b) => a.type - b.type);
}
