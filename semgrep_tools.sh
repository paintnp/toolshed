#!/bin/bash

# Server URL
SERVER_URL="http://34.226.219.58:8000"

echo "Connecting to SSE endpoint to get session ID..."
# Get the session ID from the SSE endpoint
session_id=$(curl -N -s -H "Accept: text/event-stream" "$SERVER_URL/sse" | grep -m 1 "session_id" | sed -E 's/.*session_id=([a-zA-Z0-9]+).*/\1/')

if [ -z "$session_id" ]; then
    echo "Failed to get session ID"
    exit 1
fi

echo "Found session ID: $session_id"

# Request URL with session ID
request_url="$SERVER_URL/messages/?session_id=$session_id"

# Request payload
request_payload='{"jsonrpc":"2.0","id":"tools-request","method":"list_tools"}'

echo "Sending request to $request_url"
echo "Payload: $request_payload"

# Send the request
response=$(curl -s -X POST -H "Content-Type: application/json" -d "$request_payload" "$request_url")

echo "Response: $response"
echo "Done" 