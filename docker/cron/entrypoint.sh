#!/bin/sh

REMINDER_URL="${REMINDER_URL:-http://bot:3000/api/reminders}"
CRON_SECRET="${CRON_SECRET:-}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 9 * * *}"  # Default: daily at 9 AM

echo "Starting cron service..."
echo "Reminder URL: $REMINDER_URL"
echo "Cron Schedule: $CRON_SCHEDULE"

# Wait until the reminders API is ready
echo "Waiting for reminders API to be ready..."
max_attempts=60
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if curl -f -s -X POST "$REMINDER_URL" > /dev/null 2>&1; then
    echo "Reminders API is ready!"
    break
  fi
  attempt=$((attempt + 1))
  echo "Reminders API not ready, waiting 5 seconds... (attempt $attempt/$max_attempts)"
  sleep 5
done

if [ $attempt -eq $max_attempts ]; then
  echo "Warning: Reminders API may not be ready, but continuing anyway..."
fi

# Create crontab file with environment variables
# Export env vars so cron can access them
echo "REMINDER_URL=$REMINDER_URL" > /tmp/cronenv
echo "CRON_SECRET=$CRON_SECRET" >> /tmp/cronenv
echo "" >> /tmp/cronenv
echo "$CRON_SCHEDULE . /tmp/cronenv && /app/cron.sh" > /tmp/crontab

# Install crontab
crontab /tmp/crontab

# Show installed crontab
echo "Installed crontab:"
crontab -l

# Start cron daemon in foreground
# Busybox crond uses different flags: -f (foreground), -l (log level), -L (log file)
exec crond -f -l 2

