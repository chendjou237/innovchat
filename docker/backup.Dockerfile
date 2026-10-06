FROM postgres:16-alpine
RUN apk add --no-cache gnupg
COPY docker/backup.sh /backup.sh
COPY docker/restore.sh /restore.sh
# Every day at 02:00 (server time zone set by TZ).
RUN echo '0 2 * * * /backup.sh >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
