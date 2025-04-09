#!/bin/bash

set -e

CLUSTER_NAME="ToolShedCluster"
REGION="us-east-1"
EXEC_ROLE_NAME="ToolShedFargateExecutionRole"
SECURITY_GROUP_NAME="ToolShedFargateSG"

# Create ECS Cluster
echo "Creating ECS Fargate Cluster: $CLUSTER_NAME"
aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$REGION" --capacity-providers FARGATE > cluster-info.json

CLUSTER_ARN=$(jq -r '.cluster.clusterArn' cluster-info.json)
echo "✅ ECS Cluster created: $CLUSTER_ARN"

# Create IAM Role for Fargate tasks
echo "Creating IAM role: $EXEC_ROLE_NAME"
aws iam create-role \
  --role-name "$EXEC_ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }]
  }' > iam-role.json

aws iam attach-role-policy \
  --role-name "$EXEC_ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"

EXEC_ROLE_ARN=$(jq -r '.Role.Arn' iam-role.json)
echo "✅ IAM Role created: $EXEC_ROLE_ARN"

# Find default VPC and Subnets
VPC_ID=$(aws ec2 describe-vpcs \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region "$REGION")
echo "Default VPC: $VPC_ID"

SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].SubnetId' --output text --region "$REGION")
echo "Subnet IDs: $SUBNET_IDS"

# Create Security Group allowing inbound TCP port 8000 (common MCP port)
echo "Creating Security Group: $SECURITY_GROUP_NAME"
SECURITY_GROUP_ID=$(aws ec2 create-security-group \
  --group-name "$SECURITY_GROUP_NAME" \
  --description "ToolShed ECS Fargate security group" \
  --vpc-id "$VPC_ID" --region "$REGION" \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id "$SECURITY_GROUP_ID" \
  --protocol tcp --port 8000 --cidr 0.0.0.0/0 --region "$REGION"

echo "✅ Security Group created: $SECURITY_GROUP_ID (port 8000 open)"

# Output final environment variables
echo ""
echo "🎯 Add these to your .env.local:"
echo "----------------------------------"
echo "AWS_ECS_CLUSTER_NAME=$CLUSTER_NAME"
echo "AWS_REGION=$REGION"
echo "AWS_ECS_EXECUTION_ROLE_ARN=$EXEC_ROLE_ARN"
echo "AWS_VPC_ID=$VPC_ID"
echo "AWS_SUBNET_IDS=$(echo $SUBNET_IDS | tr '\t' ',')"
echo "AWS_SECURITY_GROUP_ID=$SECURITY_GROUP_ID"
echo "----------------------------------"