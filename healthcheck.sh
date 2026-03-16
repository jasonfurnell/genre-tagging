#!/bin/sh
# Self-healing health check for Docker.
#
# Problem: Docker's --restart policy only triggers when a container EXITS.
# If gunicorn's master stays alive but the worker is frozen, the container
# is marked "unhealthy" but never restarts — it stays broken forever.
#
# Solution: After 5 consecutive health check failures (~2.5 min at 30s
# interval), kill PID 1 (gunicorn master) to force a container exit,
# which triggers the --restart unless-stopped policy.

FAIL_FILE=/tmp/healthcheck_failures

if curl -sf http://localhost:5001/healthz > /dev/null 2>&1; then
    # Healthy — reset failure counter
    rm -f "$FAIL_FILE"
    exit 0
fi

# Failed — increment counter
COUNT=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$FAIL_FILE"

# After 5 consecutive failures, kill gunicorn to trigger container restart
if [ "$COUNT" -ge 5 ]; then
    echo "Health check failed $COUNT consecutive times — killing gunicorn to trigger restart" >&2
    kill -TERM 1
fi

exit 1
