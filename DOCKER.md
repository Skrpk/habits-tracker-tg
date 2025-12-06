# Docker Development Setup

This guide explains how to run the Habits Tracker bot locally using Docker with Redis.

## Prerequisites

- Docker and Docker Compose installed
- Telegram Bot Token (get it from [@BotFather](https://t.me/botfather))

## Quick Start

1. **Create a `.env` file** in the project root:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

2. **Start everything with Docker Compose**:
```bash
docker-compose up
```

This will:
- Start a Redis container on port 6379
- Build and start the bot container
- The bot will automatically connect to Redis

3. **View logs**:
```bash
docker-compose logs -f bot
```

4. **Stop everything**:
```bash
docker-compose down
```

## Development Workflow

### Running Redis Only

If you want to run Redis in Docker but the bot locally:

```bash
# Start only Redis
docker-compose up -d redis

# Run bot locally
export TELEGRAM_BOT_TOKEN=your_token
export USE_LOCAL_REDIS=true
export REDIS_URL=redis://localhost:6379
export NODE_ENV=development

npm install
npm run dev
```

### Clearing Redis Data

To start fresh and clear all Redis data:

```bash
docker-compose down -v
```

### Rebuilding Containers

After changing dependencies or Dockerfile:

```bash
docker-compose build
docker-compose up
```

## Environment Variables

The Docker setup uses these environment variables:

- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token (required)
- `NODE_ENV` - Set to `development` (default in docker-compose)
- `REDIS_URL` - Redis connection URL (default: `redis://redis:6379`)
- `USE_LOCAL_REDIS` - Set to `true` to use local Redis instead of Vercel KV
- `CRON_SCHEDULE` - Cron expression for reminders (default: `0 9 * * *` - daily at 9 AM)
  - Uses standard cron format: `minute hour day month weekday`
  - Examples:
    - `* * * * *` - Every minute
    - `*/5 * * * *` - Every 5 minutes
    - `0 * * * *` - Every hour
    - `0 9 * * *` - Daily at 9 AM
    - `30 14 * * *` - Daily at 2:30 PM

## How It Works

- **Development Mode**: When `USE_LOCAL_REDIS=true` or `NODE_ENV=development` (without KV credentials), the bot uses a local Redis instance
- **Production Mode**: When deployed to Vercel, it uses Vercel KV (Upstash Redis) via REST API
- The code automatically detects which mode to use based on environment variables

## Troubleshooting

### Redis connection errors

If you see Redis connection errors:
1. Make sure Redis container is running: `docker-compose ps`
2. Check Redis logs: `docker-compose logs redis`
3. Verify Redis is healthy: `docker-compose exec redis redis-cli ping`

### Bot not starting

1. Check bot logs: `docker-compose logs bot`
2. Verify `TELEGRAM_BOT_TOKEN` is set in `.env` file
3. Make sure Redis is healthy before bot starts (docker-compose handles this automatically)

### Port conflicts

If port 6379 is already in use:
1. Change the port mapping in `docker-compose.yml`:
```yaml
ports:
  - "6380:6379"  # Use 6380 instead
```
2. Update `REDIS_URL` to match: `redis://localhost:6380`

