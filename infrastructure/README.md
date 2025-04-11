# ToolShed Validation Pipeline Infrastructure

This directory contains the AWS CDK infrastructure code for the ToolShed MCP Server validation pipeline. The pipeline automatically builds, deploys, and validates MCP servers from GitHub repositories.

## Components

The validation pipeline consists of the following AWS resources:

1. **ECR Repository**: Stores Docker images for MCP servers
2. **CodeBuild Project**: Builds Docker images from GitHub repositories
3. **ECS Cluster & Task Definition**: Runs MCP server containers for validation
4. **Lambda Function**: Validates MCP server endpoints and updates DynamoDB
5. **Step Functions State Machine**: Orchestrates the entire workflow

## Deployment

### Prerequisites

1. AWS CLI installed and configured
2. Node.js and npm installed
3. AWS CDK toolkit installed globally (`npm install -g aws-cdk`)
4. GitHub personal access token stored in AWS Secrets Manager as `toolshed/github-token`

### Configuration

Create a `.env.local` file in the project root or update the existing one with the following variables:

```
AWS_REGION=us-east-1
AWS_VPC_ID=vpc-xxxxxxxxx
AWS_SUBNETS=subnet-xxxxxxx,subnet-yyyyyyy
AWS_SECURITY_GROUP_ID=sg-xxxxxxxxx
DYNAMODB_TABLE_NAME=ToolShedServers
```

### Deploy the Stack

```bash
# Install dependencies
npm install

# Bootstrap CDK (if not already done)
npm run bootstrap

# Synthesize CloudFormation template
npm run synth

# Deploy the stack
npm run deploy
```

## Using the Validation Pipeline

After deployment, the stack outputs the ARN of the Step Functions state machine. To start the validation process for an MCP server repository, invoke the state machine with input in the following format:

```json
{
  "repositoryName": "owner/repo",
  "serverId": "unique-server-id"
}
```

Example using AWS CLI:

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:ToolShed-MCP-Server-Validation-Pipeline \
  --input '{"repositoryName": "github/mcp-server", "serverId": "github/mcp-server"}'
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  CodeBuild  │─────▶    ECR      │─────▶  ECS Task   │─────▶   Lambda    │
│  Project    │     │ Repository  │     │  Container  │     │ Validation  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                                            │
       └────────────────────┐                           ┌───────────┘
                          ┌─▼──────────────────────────▼┐
                          │     Step Functions          │
                          │      State Machine          │
                          └─────────────────────────────┘
```

## Notes

- The Lambda function uses DynamoDB to store validation results
- The pipeline cleans up resources (stops containers) automatically
- Update the code in `cdk/lambda/validation.ts` to change validation logic 