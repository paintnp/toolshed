#!/bin/bash

# Kill any process running on port 3091
lsof -i :3091 -t | xargs kill -9 2>/dev/null || true

# Also kill any processes on ports 3000-3007 that might be lingering Next.js servers
for port in {3000..3007}; do
  lsof -i :$port -t | xargs kill -9 2>/dev/null || true
done

echo "Starting Next.js server on port 3091..."
npm run dev 