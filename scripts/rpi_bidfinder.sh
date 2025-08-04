#!/bin/bash

# rpi_bidfinder.sh - prepare the project on a Raspberry Pi.
# Installs Node.js, fetches dependencies, initialises the database and can
# optionally launch the server. Use the -p or --production flag to skip dev
# dependencies and supply a port number to start the server immediately.
# Usage: ./scripts/rpi_bidfinder.sh [-p|--production] [PORT]

set -e

# Parse command line options for production mode and optional port number. The
# port argument can be provided in any position as long as it is not preceded
# by -p or --production.
PROD=0
PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--production)
      PROD=1 # toggle to install only production dependencies
      shift
      ;;
    *)
      PORT="$1" # treat any other argument as the desired port
      shift
      ;;
  esac
done

# Ensure system packages are up to date and then install Node.js.
# The Node.js package from NodeSource already includes npm; installing the
# separate `npm` package causes conflicts with this bundled version, so we
# avoid installing it explicitly.
sudo apt-get update

# Remove any previously installed standalone npm package to avoid conflicts
# with the bundled npm from NodeSource's Node.js package. Suppress errors if
# npm is not present so the script can proceed.
sudo apt-get purge -y npm || true

sudo apt-get install -y nodejs

# Install Node.js dependencies; limit to production packages when requested
if [[ $PROD -eq 1 ]]; then
  npm install --production
else
  npm install
fi

# Initialise the SQLite database so the server can start without errors
npm run init-db # create the SQLite database

# Launch the application when a port number is supplied. The run.sh helper
# exports PORT before starting the Node.js server.
if [[ -n "$PORT" ]]; then
  ./scripts/run.sh "$PORT"
fi

