# Habits Tracker Telegram Bot

A TypeScript Telegram bot for tracking daily habits with streak counting. Built with clean architecture principles and deployed on Vercel.

## Features

- ✅ Create and manage habits
- 🔥 Track daily streaks
- 📅 Daily habit reminders
- 🎯 Simple yes/no habit checking
- 💾 Persistent storage using Vercel Key-Value Store

## Architecture

The project follows clean architecture principles with three main layers:

1. **Domain Layer** (`src/domain/`)
   - Business logic and entities
   - Use cases for habit operations
   - Repository interfaces

2. **Infrastructure Layer** (`src/infrastructure/`)
   - Vercel KV implementation
   - Database access

3. **Presentation Layer** (`src/presentation/`)
   - Telegram bot handlers
   - User interaction logic

## Setup

### Prerequisites

- Node.js 18+ 
- A Telegram Bot Token (get it from [@BotFather](https://t.me/botfather))
- Vercel account with KV store

### Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
# Copy .env.example to .env and fill in the values
TELEGRAM_BOT_TOKEN=your_bot_token_here
REDIS_URL=your_redis_connection_string
NODE_ENV=development
WEBHOOK_URL=https://your-domain.vercel.app/api/webhook
```

### Local Development

#### Option 1: Using Docker (Recommended)

1. Create a `.env` file with your bot token:
```bash
echo "TELEGRAM_BOT_TOKEN=your_bot_token_here" > .env
```

2. Start Redis and bot with Docker Compose:
```bash
docker-compose up
```

Or run in detached mode:
```bash
docker-compose up -d
```

3. View logs:
```bash
docker-compose logs -f bot
```

4. Stop everything:
```bash
docker-compose down
```

5. Stop and clear Redis data:
```bash
docker-compose down -v
```

#### Option 2: Local Development (Redis only)

1. Start Redis with Docker:
```bash
docker-compose up -d redis
```

2. Set environment variables:
```bash
export TELEGRAM_BOT_TOKEN=your_bot_token_here
export USE_LOCAL_REDIS=true
export REDIS_URL=redis://localhost:6379
export NODE_ENV=development
```

3. Install dependencies and run:
```bash
npm install
npm run dev
```

The bot will use polling mode when `NODE_ENV` is not set to `production` and will connect to local Redis when `USE_LOCAL_REDIS=true`.

**Automatic Daily Reminders:**
- A cron service runs in Docker that calls the reminders endpoint using standard cron expressions
- The bot will automatically ask users about their unchecked habits
- Default schedule: `0 9 * * *` (daily at 9:00 AM) - same as Vercel production
- To change the schedule, set `CRON_SCHEDULE` environment variable in `docker-compose.yml`:
  - `* * * * *` - Every minute (for testing)
  - `*/5 * * * *` - Every 5 minutes
  - `0 * * * *` - Every hour
  - `0 9 * * *` - Daily at 9 AM (default)
- The reminders server runs alongside the bot in the same container

### Production Deployment

1. Build the project:
```bash
npm run build
```

2. Deploy to Vercel:
```bash
vercel deploy
```

3. Set environment variables in Vercel dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `REDIS_URL` - Your Redis connection string
   - `NODE_ENV=production`
   - `WEBHOOK_URL=https://your-domain.vercel.app/api/webhook`

4. Set up the webhook (run once after deployment):
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.vercel.app/api/webhook"
```

## Usage

### Bot Commands

- `/start` - Start the bot and see available commands
- `/newhabit <name>` - Create a new habit
- `/myhabits` - View all your habits with streaks
- `/check` - Check habits for today
- `/deletehabit <id>` - Delete a habit by ID

### Example Flow

1. Start the bot: `/start`
2. Create a habit: `/newhabit Don't smoke`
3. Check your habits: `/myhabits`
4. Daily check: `/check` - The bot will ask if you completed your habit
5. Answer Yes/No using the inline buttons

## How It Works

- **Streak Tracking**: When you answer "Yes", your streak increases. If you answer "No", the streak resets to 0.
- **Daily Checks**: The bot tracks which habits haven't been checked today.
- **Data Storage**: All habits are stored in Vercel KV Store, keyed by user ID.

## Project Structure

```
habits-tracker/
├── src/
│   ├── domain/              # Business logic
│   │   ├── entities/        # Domain models
│   │   ├── repositories/    # Repository interfaces
│   │   └── use-cases/       # Business use cases
│   ├── infrastructure/      # External services
│   │   ├── config/          # Configuration
│   │   └── repositories/   # Repository implementations
│   ├── presentation/        # Telegram bot
│   │   └── telegram/        # Bot handlers
│   ├── api/                 # API handlers
│   └── index.ts             # Entry point (dev mode)
├── api/                     # Vercel API routes
│   └── webhook.ts           # Webhook handler
├── package.json
├── tsconfig.json
└── vercel.json
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | Yes |
| `REDIS_URL` | Redis connection string (redis:// or rediss://) | Yes |
| `NODE_ENV` | Environment (production/development) | Yes |
| `WEBHOOK_URL` | Full webhook URL for production | Production only |
| `NOTIFICATION_CHANNEL_ID` | Telegram channel ID for new user notifications | No |

## License

MIT
