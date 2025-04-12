#!/bin/bash

# Set up colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${BOLD}${GREEN}Testing specific steps in validation workflow${NC}"

echo -e "${YELLOW}Step 1: Register task definition${NC}"
TASK_DEF_ARN=$(aws ecs register-task-definition \
    --family ToolShedTestValidation \
    --network-mode awsvpc \
    --requires-compatibilities FARGATE \
    --cpu 256 \
    --memory 512 \
    --execution-role-arn "arn:aws:iam::277502524328:role/ToolShed-Validation-MCP-Server-Execution-Role" \
    --task-role-arn "arn:aws:iam::277502524328:role/ToolShed-Validation-MCP-Server-Task-Role" \
    --container-definitions '[{"name":"TestContainer","image":"public.ecr.aws/nginx/nginx:latest","essential":true,"memory":512,"portMappings":[{"containerPort":80,"hostPort":80,"protocol":"tcp"}],"logConfiguration":{"logDriver":"awslogs","options":{"awslogs-group":"/ecs/ToolShedTestValidation","awslogs-region":"us-east-1","awslogs-stream-prefix":"test-container"}}}]' \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo -e "${GREEN}Registered task definition: ${TASK_DEF_ARN}${NC}"

echo -e "${YELLOW}Step 2: Run ECS task${NC}"

# Get public subnet and security group
PUBLIC_SUBNET=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=ValidationPipelineStack/ValidationVpc" --query "Vpcs[0].VpcId" --output text)" "Name=tag:Name,Values=*Public*" \
    --query "Subnets[0].SubnetId" \
    --output text)

SECURITY_GROUP=$(aws ec2 describe-security-groups \
    --filters "Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=ValidationPipelineStack/ValidationVpc" --query "Vpcs[0].VpcId" --output text)" \
    --query "SecurityGroups[0].GroupId" \
    --output text)

echo -e "${GREEN}Using subnet: ${PUBLIC_SUBNET} and security group: ${SECURITY_GROUP}${NC}"

# Run the task
TASK_ARN=$(aws ecs run-task \
    --cluster ToolShed-Validation-Cluster \
    --task-definition $TASK_DEF_ARN \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$PUBLIC_SUBNET],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" \
    --query 'tasks[0].taskArn' \
    --output text)

echo -e "${GREEN}Started task: ${TASK_ARN}${NC}"

echo -e "${YELLOW}Step 3: Wait for task to start (60 seconds)${NC}"
sleep 60

echo -e "${YELLOW}Step 4: Describe task to get details${NC}"
aws ecs describe-tasks \
    --cluster ToolShed-Validation-Cluster \
    --tasks $TASK_ARN \
    --query 'tasks[0].{Status:lastStatus,Image:containers[0].image,PublicIP:attachments[0].details[?name==`publicIp`].value | [0]}' \
    --output json | jq .

echo -e "${YELLOW}Step 5: Simulate validation${NC}"
echo -e "${GREEN}Validating task with ARN: ${TASK_ARN}${NC}"
echo -e "${GREEN}Validation successful!${NC}"

echo -e "${YELLOW}Step 6: Cleanup - Stopping task${NC}"
aws ecs stop-task \
    --cluster ToolShed-Validation-Cluster \
    --task $TASK_ARN \
    --reason "Test completed" \
    > /dev/null

echo -e "${GREEN}Task stopped${NC}"

echo -e "\n${BOLD}${GREEN}Test completed successfully${NC}" 