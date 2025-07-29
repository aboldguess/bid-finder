#!/bin/bash

# run.sh - convenience wrapper to launch the server.
# Usage: ./scripts/run.sh [PORT]
# When a port number is provided it is exported as the PORT
# environment variable so the Express application listens
# on that interface.

set -e

# Respect the first argument as the desired port if present.
if [ -n "$1" ]; then
  export PORT="$1"
fi

# Start the Node.js backend.
node server/index.js
