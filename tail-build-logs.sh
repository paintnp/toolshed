#!/bin/bash

# Colors for better readability
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Log group for CodeBuild
LOG_GROUP="/aws/codebuild/ToolShed-MCP-Server-Build"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Please install jq using your package manager:"
    echo "  - On macOS: brew install jq"
    echo "  - On Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

echo -e "${BOLD}===== CloudWatch Log Tail - CodeBuild =====${NC}"
echo -e "Automatically tailing the most recent CodeBuild log stream"

# Get the latest log stream
echo -e "${BLUE}Fetching latest log stream...${NC}"
LATEST_STREAM=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --query "logStreams[0].logStreamName" \
    --output text)

if [ -z "$LATEST_STREAM" ] || [ "$LATEST_STREAM" == "None" ]; then
    echo -e "${RED}No log streams found for $LOG_GROUP${NC}"
    exit 1
fi

echo -e "${GREEN}Monitoring log stream: $LATEST_STREAM${NC}"
echo -e "${YELLOW}(Press Ctrl+C to stop monitoring)${NC}"
echo

# Start with no token for first request
next_token=""
poll_interval=2

while true; do
    # If we have a token, use it to get next batch of events
    if [ -n "$next_token" ]; then
        response=$(aws logs get-log-events \
            --log-group-name "$LOG_GROUP" \
            --log-stream-name "$LATEST_STREAM" \
            --start-from-head \
            --next-token "$next_token")
    else
        # For first request, get most recent events
        response=$(aws logs get-log-events \
            --log-group-name "$LOG_GROUP" \
            --log-stream-name "$LATEST_STREAM" \
            --start-from-head)
    fi
    
    # Extract events and next token
    events=$(echo "$response" | jq -r '.events[]? | "\(.timestamp | tonumber / 1000 | strftime("%Y-%m-%d %H:%M:%S")) \(.message)"')
    new_token=$(echo "$response" | jq -r '.nextForwardToken')
    
    # If we have events and the token has changed, display them
    if [ -n "$events" ] && [ "$new_token" != "$next_token" ]; then
        echo "$events" | while read -r line; do
            timestamp=$(echo "$line" | cut -d' ' -f1-2)
            message=$(echo "$line" | cut -d' ' -f3-)
            echo -e "${BOLD}${timestamp}${NC} ${message}"
        done
    fi
    
    # Update token for next iteration if it changed
    if [ "$new_token" != "$next_token" ]; then
        next_token="$new_token"
    fi
    
    sleep $poll_interval
done 