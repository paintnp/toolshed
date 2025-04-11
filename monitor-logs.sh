#!/bin/bash

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Get the most recent execution ARN
EXECUTION_ARN=$(aws stepfunctions list-executions \
    --state-machine-arn "arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline" \
    --query 'executions[0].executionArn' \
    --output text)

if [ -z "$EXECUTION_ARN" ] || [ "$EXECUTION_ARN" = "None" ]; then
    echo -e "${RED}No Step Functions execution found${NC}"
    exit 1
fi

function print_section() {
    echo -e "\n${BOLD}${BLUE}===== $1 =====${NC}"
}

function monitor_step_functions() {
    print_section "Step Functions Execution Status"
    aws stepfunctions describe-execution --execution-arn "$EXECUTION_ARN" | jq -r '. | "Status: \(.status)\nStart Time: \(.startDate)\nEnd Time: \(.stopDate // "Still running")\nOutput: \(.output // "No output yet")"'
}

function monitor_codebuild() {
    print_section "CodeBuild Logs"
    
    # Get the latest CodeBuild project build
    BUILD_ID=$(aws codebuild list-builds-for-project \
        --project-name "ToolShed-MCP-Server-Build" \
        --query 'ids[0]' \
        --output text)
    
    if [ -z "$BUILD_ID" ] || [ "$BUILD_ID" = "None" ]; then
        echo -e "${YELLOW}No CodeBuild builds found${NC}"
        return
    fi
    
    # Get the log stream name for this build
    LOG_STREAM=$(aws codebuild batch-get-builds \
        --ids "$BUILD_ID" \
        --query 'builds[0].logs.streamName' \
        --output text)
    
    if [ -z "$LOG_STREAM" ] || [ "$LOG_STREAM" = "None" ]; then
        echo -e "${YELLOW}No log stream found for build $BUILD_ID${NC}"
        return
    fi
    
    echo -e "${GREEN}Fetching logs for build: $BUILD_ID${NC}"
    
    aws logs get-log-events \
        --log-group-name "/aws/codebuild/ToolShed-MCP-Server-Build" \
        --log-stream-name "$LOG_STREAM" \
        --query 'events[*].[timestamp,message]' \
        --output text | while read -r timestamp message; do
            if [ -n "$timestamp" ] && [ -n "$message" ]; then
                date_str=$(date -r $((timestamp/1000)) "+%Y-%m-%d %H:%M:%S")
                echo -e "${GREEN}[$date_str]${NC} $message"
            fi
        done
}

function monitor_ecs() {
    print_section "ECS Task Logs"
    
    # Get the specific task we're interested in
    TASK_ID=$(aws ecs list-tasks \
        --cluster ToolShed-Validation-Cluster \
        --family ValidationPipelineStackMCPServerTaskDef80539BDE \
        --query 'taskArns[0]' \
        --output text)
    
    if [ "$TASK_ID" = "None" ] || [ -z "$TASK_ID" ]; then
        echo -e "${YELLOW}No active ECS tasks found${NC}"
        return
    fi
    
    # Extract just the task ID from the full ARN
    TASK_SHORT_ID=$(echo $TASK_ID | awk -F'/' '{print $NF}')
    echo -e "${GREEN}Found task: $TASK_SHORT_ID${NC}"
    
    # Construct the log stream name based on the awslogs configuration
    LOG_STREAM="mcp-server/MCPServerContainer/$TASK_SHORT_ID"
    
    echo -e "${GREEN}Fetching logs from stream: $LOG_STREAM${NC}"
    
    aws logs get-log-events \
        --log-group-name "/ecs/ValidationPipelineStackMCPServerTaskDef80539BDE" \
        --log-stream-name "$LOG_STREAM" \
        --query 'events[*].[timestamp,message]' \
        --output text 2>/dev/null | while read -r timestamp message; do
            if [ -n "$timestamp" ] && [ -n "$message" ]; then
                date_str=$(date -r $((timestamp/1000)) "+%Y-%m-%d %H:%M:%S")
                echo -e "${YELLOW}[$date_str]${NC} $message"
            fi
        done
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}No logs found yet for this task. The container might still be starting.${NC}"
    fi
}

echo -e "${BOLD}Monitoring ToolShed MCP Server Validation Pipeline${NC}"
echo -e "Repository: github/github-mcp-server"
echo -e "Press Ctrl+C to stop monitoring\n"

while true; do
    monitor_step_functions
    monitor_codebuild
    monitor_ecs
    
    echo -e "\n${BOLD}Waiting 30 seconds before next update...${NC}"
    sleep 30
done 