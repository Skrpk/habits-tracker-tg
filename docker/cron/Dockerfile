FROM alpine:latest

# Install cron and curl
# Use busybox crond instead of dcron to avoid setpgid issues
RUN apk add --no-cache bash curl tzdata

WORKDIR /app

# Copy cron script
COPY docker/cron/cron.sh /app/cron.sh
RUN chmod +x /app/cron.sh

# Create crontab entry point
COPY docker/cron/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
