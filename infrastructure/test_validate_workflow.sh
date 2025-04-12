#!/bin/bash

# Set up colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${BOLD}${GREEN}Testing validation workflow${NC}"

# 1. Start a new execution of the step function, providing the imageUri directly
EXECUTION_ARN=$(aws stepfunctions start-execution \
    --state-machine-arn "arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline" \
    --input '{"repositoryName": "test-repo", "originalRepositoryName": "test-repo", "serverId": "test-execute-1", "imageDetails": {"imageUri": "public.ecr.aws/nginx/nginx:latest"}}' \
    --query 'executionArn' \
    --output text)

echo -e "${GREEN}Started execution: ${EXECUTION_ARN}${NC}"

# 2. Monitor the execution status
echo -e "${YELLOW}Monitoring execution status every 15 seconds...${NC}"
STATUS="RUNNING"

while [ "$STATUS" == "RUNNING" ]; do
    sleep 15
    STATUS=$(aws stepfunctions describe-execution \
        --execution-arn $EXECUTION_ARN \
        --query 'status' \
        --output text)
    CURRENT_STATE=$(aws stepfunctions get-execution-history \
        --execution-arn $EXECUTION_ARN \
        --query 'events[?type==`TaskStateEntered`].stateEnteredEventDetails.name' \
        --output text | tail -1)
    echo -e "${YELLOW}$(date '+%Y-%m-%d %H:%M:%S')${NC} Status: ${GREEN}${STATUS}${NC}, Current state: ${GREEN}${CURRENT_STATE}${NC}"
done

# 3. Get the final output
echo -e "\n${BOLD}${GREEN}Execution completed with status: ${STATUS}${NC}"

if [ "$STATUS" == "SUCCEEDED" ]; then
    echo -e "${GREEN}Execution succeeded!${NC}"
    aws stepfunctions describe-execution \
        --execution-arn $EXECUTION_ARN \
        --query 'output' \
        --output text | jq .
else
    echo -e "${RED}Execution failed!${NC}"
    aws stepfunctions describe-execution \
        --execution-arn $EXECUTION_ARN \
        --query 'error, cause' \
        --output text
fi

# 4. Check the Lambda logs
echo -e "\n${BOLD}${GREEN}Checking Lambda logs${NC}"
LAMBDA_NAME="ToolShed-MCP-Server-Validation"
LOG_GROUP_NAME="/aws/lambda/${LAMBDA_NAME}"

# Get log streams sorted by last event time (newest first)
LOG_STREAM=$(aws logs describe-log-streams \
    --log-group-name $LOG_GROUP_NAME \
    --order-by LastEventTime \
    --descending \
    --query 'logStreams[0].logStreamName' \
    --output text)

echo -e "${YELLOW}Latest log stream: ${LOG_STREAM}${NC}"

# Get log events
echo -e "${GREEN}Log events:${NC}"
aws logs get-log-events \
    --log-group-name $LOG_GROUP_NAME \
    --log-stream-name $LOG_STREAM \
    --limit 20 \
    --query 'events[*].[timestamp,message]' \
    --output table

echo -e "\n${BOLD}${GREEN}Test completed${NC}" 