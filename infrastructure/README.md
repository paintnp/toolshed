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

# Infrastructure Setup and Management

This directory contains the AWS CDK code for setting up the ToolShed infrastructure, including the validation pipeline and playground environments.

## Stack Outputs

When you deploy the CDK stacks, they produce several outputs that are used by the application. These include:

- Cluster ARNs
- Repository names and URIs
- Security group IDs
- Subnet IDs
- State machine ARNs

## Storing Outputs in Parameter Store

After deploying the stacks, you should store the outputs in AWS Systems Manager Parameter Store for use by the application. A script is provided to automate this:

```bash
# Install dependencies
npm install @aws-sdk/client-ssm

# Make the script executable
chmod +x store-stack-outputs.js

# Run the script
node store-stack-outputs.js
```

This script will store all necessary parameters in SSM Parameter Store with the following path structure:

- `/toolshed/validation/*` - Validation pipeline parameters
- `/toolshed/playground/*` - Playground parameters

## Environment Variables

For local development, you can also store these values in your `.env.local` file:

```
AWS_CLUSTER_ARN=arn:aws:ecs:us-east-1:277502524328:cluster/ToolShed-Validation-Cluster
AWS_ECR_REPOSITORY=toolshed-mcp-servers-v2
AWS_ECR_REPOSITORY_URI=277502524328.dkr.ecr.us-east-1.amazonaws.com/toolshed-mcp-servers-v2
AWS_STATE_MACHINE_ARN=arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline
AWS_SECURITY_GROUP_ID=sg-0d9310075aac2bc60
AWS_SUBNETS=subnet-02dc88f8641a3502b,subnet-09e525f61b309b43e
```

## Updating Parameters

If you redeploy the stacks and obtain new output values, update the `store-stack-outputs.js` script with the new values and run it again. The script uses the `Overwrite: true` flag, so it will update existing parameters. 