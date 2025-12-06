#!/bin/bash

REMINDER_URL="${REMINDER_URL:-http://bot:3000/api/reminders}"
CRON_SECRET="${CRON_SECRET:-}"

send_reminder() {
  echo "$(date): Sending reminders..."
  
  if [ -n "$CRON_SECRET" ]; then
    curl -X POST "$REMINDER_URL?secret=$CRON_SECRET" \
      -H "Content-Type: application/json" \
      -f -s -o /dev/null
  else
    curl -X POST "$REMINDER_URL" \
      -H "Content-Type: application/json" \
      -f -s -o /dev/null
  fi
  
  if [ $? -eq 0 ]; then
    echo "$(date): Reminders sent successfully"
  else
    echo "$(date): Error sending reminders"
  fi
}

send_reminder
