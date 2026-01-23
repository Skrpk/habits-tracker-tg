# Mock Habits Data for Testing

This directory contains mock habit data for testing the analytics feature with different time periods.

## Habit Structures

### 1. **Morning Meditation** (1 Month History)
- **Created**: December 23, 2025 (30 days ago)
- **Current Streak**: 5 days
- **Last Checked**: January 21, 2026
- **Skipped Days**: 2
- **Dropped Days**: 1 (had 7-day streak before drop)

### 2. **Daily Exercise** (1 Year History)
- **Created**: January 22, 2025 (365 days ago)
- **Current Streak**: 12 days
- **Last Checked**: January 20, 2026
- **Skipped Days**: 8
- **Dropped Days**: 3 (had streaks of 25, 18, and 30 days before drops)

### 3. **Read 30 Minutes** (3 Years History)
- **Created**: January 23, 2023 (1095 days ago)
- **Current Streak**: 45 days
- **Last Checked**: January 21, 2026
- **Skipped Days**: 25
- **Dropped Days**: 7 (had streaks ranging from 28 to 60 days before drops)

## How to Insert into Redis

### Option 1: Using Redis CLI

```bash
# Read the JSON file and insert
redis-cli SET user:12345:habits "$(cat scripts/mock-habits-redis.json)"
```

### Option 2: Using Redis CLI with escaped JSON

```bash
redis-cli SET user:12345:habits '{"userId":12345,"habits":[...]}'
```

### Option 3: Using Node.js/TypeScript

```typescript
import { kv } from './src/infrastructure/config/kv';
import mockHabits from './scripts/mock-habits-redis.json';

await kv.set('user:12345:habits', mockHabits);
```

### Option 4: Using Redis GUI (like RedisInsight)

1. Connect to your Redis instance
2. Navigate to Browser
3. Create new key: `user:12345:habits`
4. Paste the JSON from `mock-habits-redis.json`
5. Save

## Testing Analytics

After inserting the data:

1. **Access Analytics Page**: Navigate to `/analytics/12345` in your browser
2. **View Habits**: You should see all 3 habits listed
3. **Click Each Habit**: View detailed graphs showing:
   - Streak trends over time
   - Completion statistics
   - Skipped and dropped days
   - Timeline of all check events

## Regenerating Mock Data

To regenerate the mock data with updated dates:

```bash
npx ts-node scripts/create-mock-habits.ts
```

This will output fresh JSON with dates relative to today.

## Notes

- All habits belong to user ID `12345`
- The data uses the new format (no `checkHistory` stored, computed on demand)
- Dates are relative to January 23, 2026
- The `computeCheckHistory()` function will reconstruct the full timeline from streak, creation date, skips, and drops
