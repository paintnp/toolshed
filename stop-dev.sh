#!/bin/bash

echo "Stopping all Next.js development servers..."

# Kill processes on standard Next.js ports
for port in {3000..3007} 3091; do
  proc=$(lsof -i :$port -t 2>/dev/null)
  if [ ! -z "$proc" ]; then
    echo "Killing process on port $port (PID: $proc)"
    kill -9 $proc 2>/dev/null
  fi
done

echo "All development servers stopped." 