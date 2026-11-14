#!/bin/sh
# Double-click (Mac) to start Viridian Studio. Close the window to stop it.
cd "$(dirname "$0")" && node studio/server.mjs --open
