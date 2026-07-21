import { describe, it, expect } from 'vitest';
import {
  computePostponeTarget,
  isSameLocalDay,
  isPostponeDue,
  localDay,
  POSTPONE_STEP_MS,
} from '../../../src/domain/utils/postpone';

describe('postpone utils', () => {
  describe('localDay', () => {
    it('formats the local calendar day in the given timezone', () => {
      // 23:30Z is already next day in Bangkok (UTC+7)
      expect(localDay(new Date('2026-07-15T23:30:00Z'), 'Asia/Bangkok')).toBe('2026-07-16');
      expect(localDay(new Date('2026-07-15T23:30:00Z'), 'UTC')).toBe('2026-07-15');
    });
  });

  describe('isSameLocalDay', () => {
    it('is true within the same local day and false across midnight', () => {
      const a = new Date('2026-07-15T15:00:00Z'); // Bangkok 22:00
      const b = new Date('2026-07-15T15:59:00Z'); // Bangkok 22:59
      const c = new Date('2026-07-15T17:30:00Z'); // Bangkok 00:30 next day
      expect(isSameLocalDay(a, b, 'Asia/Bangkok')).toBe(true);
      expect(isSameLocalDay(a, c, 'Asia/Bangkok')).toBe(false);
    });
  });

  describe('computePostponeTarget', () => {
    it('returns now + 1h when it stays within the local day (Bangkok, fixed offset)', () => {
      const now = new Date('2026-07-15T15:00:00Z'); // Bangkok 22:00
      const target = computePostponeTarget(now, 'Asia/Bangkok');
      expect(target).not.toBeNull();
      expect(target!.getTime()).toBe(now.getTime() + POSTPONE_STEP_MS);
      expect(localDay(target!, 'Asia/Bangkok')).toBe('2026-07-15');
    });

    it('returns null at 23:xx local (would cross midnight)', () => {
      expect(computePostponeTarget(new Date('2026-07-15T16:00:00Z'), 'Asia/Bangkok')).toBeNull(); // 23:00
      expect(computePostponeTarget(new Date('2026-07-15T16:30:00Z'), 'Asia/Bangkok')).toBeNull(); // 23:30
    });

    it('returns non-null exactly at 22:00 local and null at 23:00 local', () => {
      expect(computePostponeTarget(new Date('2026-07-15T15:00:00Z'), 'Asia/Bangkok')).not.toBeNull(); // 22:00
      expect(computePostponeTarget(new Date('2026-07-15T16:00:00Z'), 'Asia/Bangkok')).toBeNull();     // 23:00
    });

    it('respects DST — London on BST (UTC+1) in July', () => {
      // 21:00Z = 22:00 BST -> +1h = 23:00 same day -> allowed
      expect(computePostponeTarget(new Date('2026-07-15T21:00:00Z'), 'Europe/London')).not.toBeNull();
      // 22:00Z = 23:00 BST -> +1h crosses midnight -> not allowed
      expect(computePostponeTarget(new Date('2026-07-15T22:00:00Z'), 'Europe/London')).toBeNull();
    });
  });

  describe('isPostponeDue', () => {
    const tz = 'UTC';
    it('is false when unset or invalid', () => {
      expect(isPostponeDue(undefined, new Date('2026-07-15T12:00:00Z'), tz)).toBe(false);
      expect(isPostponeDue('not-a-date', new Date('2026-07-15T12:00:00Z'), tz)).toBe(false);
    });

    it('is true when the target is in the past and on the same local day', () => {
      const now = new Date('2026-07-15T16:00:00Z');
      expect(isPostponeDue('2026-07-15T15:30:00Z', now, tz)).toBe(true);
      expect(isPostponeDue('2026-07-15T16:00:00Z', now, tz)).toBe(true); // exactly now
    });

    it('is false when the target is still in the future', () => {
      const now = new Date('2026-07-15T16:00:00Z');
      expect(isPostponeDue('2026-07-15T17:00:00Z', now, tz)).toBe(false);
    });

    it('is false when the target slipped past midnight (stale after missed ticks)', () => {
      // target was yesterday relative to now's local day
      const now = new Date('2026-07-16T00:30:00Z');
      expect(isPostponeDue('2026-07-15T23:30:00Z', now, tz)).toBe(false);
    });
  });
});
