#!/bin/bash

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Log groups to monitor
LOG_GROUP_CODEBUILD="/aws/codebuild/ToolShed-MCP-Server-Build"
LOG_GROUP_STEPFUNCTIONS="/aws/vendedlogs/states/ToolShed-MCP-Server-Validation-Pipeline-Logs"

function print_header() {
    echo -e "${BOLD}===== CloudWatch Logs Monitor - ToolShed MCP Server Validation =====${NC}"
    echo -e "Real-time log monitoring utility for tracking validation pipeline progress."
    echo
}

function get_latest_streams() {
    local log_group=$1
    local limit=$2
    
    echo -e "${BLUE}Fetching latest log streams for ${log_group}...${NC}"
    aws logs describe-log-streams \
        --log-group-name "$log_group" \
        --order-by LastEventTime \
        --descending \
        --limit $limit
}

function select_log_stream() {
    local log_group=$1
    
    # Get the latest log streams
    streams=$(aws logs describe-log-streams \
        --log-group-name "$log_group" \
        --order-by LastEventTime \
        --descending \
        --limit 10 \
        --query 'logStreams[*].[logStreamName,creationTime]' \
        --output json)
    
    # Parse and display streams with timestamps
    echo -e "${YELLOW}Available log streams for $log_group:${NC}"
    echo -e "${BOLD}ID\tTimestamp\t\tStream Name${NC}"
    
    count=1
    stream_names=()
    
    while read -r name; do
        read -r timestamp
        # Remove quotes
        name=$(echo $name | tr -d '"')
        timestamp=$(echo $timestamp | tr -d '"')
        
        # Convert timestamp to human readable format
        if [[ $timestamp =~ ^[0-9]+$ ]]; then
            date_str=$(date -r $((timestamp/1000)) "+%Y-%m-%d %H:%M:%S")
        else
            date_str="Unknown"
        fi
        
        echo -e "$count\t$date_str\t$name"
        stream_names+=("$name")
        ((count++))
    done < <(echo "$streams" | jq -r '.[] | .[]')
    
    # Prompt user to select a stream
    echo
    read -p "Select a log stream by ID (1-$((count-1))): " selection
    
    # Validate selection
    if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -ge "$count" ]; then
        echo -e "${RED}Invalid selection. Using the most recent log stream.${NC}"
        selection=1
    fi
    
    # Return the selected stream name
    echo "${stream_names[$((selection-1))]}"
}

function watch_log_events() {
    local log_group=$1
    local log_stream=$2
    local poll_interval=${3:-5}
    
    echo -e "${GREEN}Monitoring log stream: $log_stream${NC}"
    echo -e "${YELLOW}(Press Ctrl+C to stop monitoring)${NC}"
    echo
    
    # Start with no token for first request
    next_token=""
    
    while true; do
        # If we have a token, use it to get next batch of events
        if [ -n "$next_token" ]; then
            response=$(aws logs get-log-events \
                --log-group-name "$log_group" \
                --log-stream-name "$log_stream" \
                --start-from-head \
                --next-token "$next_token")
        else
            # For first request, get most recent events
            response=$(aws logs get-log-events \
                --log-group-name "$log_group" \
                --log-stream-name "$log_stream" \
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
}

function monitor_menu() {
    print_header
    
    PS3="Select a log group to monitor: "
    options=("CodeBuild Logs" "Step Functions Logs" "Quit")
    
    select opt in "${options[@]}"
    do
        case $opt in
            "CodeBuild Logs")
                stream=$(select_log_stream "$LOG_GROUP_CODEBUILD")
                watch_log_events "$LOG_GROUP_CODEBUILD" "$stream"
                break
                ;;
            "Step Functions Logs")
                stream=$(select_log_stream "$LOG_GROUP_STEPFUNCTIONS")
                watch_log_events "$LOG_GROUP_STEPFUNCTIONS" "$stream"
                break
                ;;
            "Quit")
                echo "Exiting log monitor."
                exit 0
                ;;
            *) 
                echo "Invalid option. Please try again."
                ;;
        esac
    done
}

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Please install jq using your package manager:"
    echo "  - On macOS: brew install jq"
    echo "  - On Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

# Start the monitor
monitor_menu 