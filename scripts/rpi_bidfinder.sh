#!/bin/bash

# rpi_bidfinder.sh - prepare the project on a Raspberry Pi.
# Installs Node.js, fetches dependencies and initialises the database.
# Use the -p or --production flag to skip dev dependencies.
# Usage: ./scripts/rpi_bidfinder.sh [-p|--production]

set -e

# Parse command line options for production mode
PROD=0
if [[ "$1" == "-p" || "$1" == "--production" ]]; then
  PROD=1 # toggle to install only production dependencies
fi

# Ensure system packages are up to date and install Node.js and npm
sudo apt-get update
sudo apt-get install -y nodejs npm

# Install Node.js dependencies; limit to production packages when requested
if [[ $PROD -eq 1 ]]; then
  npm install --production
else
  npm install
fi

# Initialise the SQLite database so the server can start without errors
npm run init-db # create the SQLite database

