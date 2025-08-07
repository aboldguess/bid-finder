#!/bin/bash

# run.sh - convenience wrapper to launch the Procurement Scraper GUI server.
# Usage: ./scripts/run.sh [PORT]
#
# Accepts an optional port argument which is exported as the PORT environment
# variable so the Express application listens on that interface. The server is
# started in the background to avoid blocking the calling script. Logs continue
# to be written to logs/app.log by the application's logger.

set -e

# Respect the first argument as the desired port if present.
if [ -n "$1" ]; then
  export PORT="$1"
fi

# Start the Node.js backend in the background. Use nohup so the server keeps
# running even if the launching terminal closes. Suppress stdout/stderr as the
# application already logs to logs/app.log.
nohup node server/index.js >/dev/null 2>&1 &
SERVER_PID=$!

echo "Server started in background on port ${PORT:-3000} (PID: $SERVER_PID)"
echo "View logs with: tail -f logs/app.log"
