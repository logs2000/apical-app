#!/bin/bash
# keep-alive.sh — bulletproof watchdog for the Next.js dev server.
# The sandbox periodically kills the next-server process (memory pressure / reaper).
# This script runs as a detached daemon, polls port 3000 every 2s, and restarts
# the server the moment it dies. It also restarts itself if killed by trapping signals.

PROJECT_DIR="/home/z/my-project/my-project-temp"
LOG="/home/z/my-project/dev.log"
PIDFILE="/home/z/my-project/.dev.pid"

# Make this script survive: ignore hangup, trap TERM/INT to restart loop
trap '' HUP
trap 'echo "[$(date +%H:%M:%S)] caught signal, continuing watchdog loop" >> "$LOG"' TERM INT

cd "$PROJECT_DIR"

echo "[$(date +%H:%M:%S)] === keep-alive watchdog started (PID $$) ===" >> "$LOG"

while true; do
  # Start the dev server if nothing is listening on 3000
  if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date +%H:%M:%S)] port 3000 not responding — starting next dev..." >> "$LOG"
    # Kill any stale next processes
    pkill -f "next-server" 2>/dev/null
    pkill -f "next dev" 2>/dev/null
    sleep 1
    # Start with a memory cap to reduce OOM risk
    NODE_OPTIONS="--max-old-space-size=1536" nohup node "$PROJECT_DIR/node_modules/.bin/next" dev -p 3000 >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    disown 2>/dev/null || true
    # Give it up to 25s to come up
    for i in $(seq 1 50); do
      if curl -s -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
        echo "[$(date +%H:%M:%S)] server is up (attempt OK)" >> "$LOG"
        break
      fi
      sleep 0.5
    done
  fi
  sleep 2
done
