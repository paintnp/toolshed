# MCP Server Validation Pipeline

This document explains the updated validation pipeline for MCP servers in the Toolshed application.

## Overview

The validation pipeline has been updated to use AWS Step Functions instead of directly managing Fargate tasks. This approach offers several advantages:

1. **Improved Reliability**: Step Functions provides built-in error handling and retry logic
2. **Better Observability**: The state of the validation process can be tracked through the Step Functions console
3. **Simplified Code**: The complex task of managing Fargate containers is delegated to Step Functions
4. **Scalability**: The pipeline can be easily extended with additional steps

## Architecture

The validation pipeline consists of the following components:

1. **ECR Repository**: Stores Docker images for MCP servers
2. **CodeBuild Project**: Builds Docker images from GitHub repositories
3. **ECS Cluster & Task Definition**: Runs MCP server containers for validation
4. **Lambda Function**: Validates MCP server endpoints and updates DynamoDB
5. **Step Functions State Machine**: Orchestrates the entire workflow

The workflow follows these steps:

1. **Build Image**: The CodeBuild project clones the GitHub repository and builds a Docker image
2. **Run Container**: The ECS Fargate task runs the Docker image
3. **Validate Server**: A Lambda function validates the MCP server endpoints
4. **Clean Up**: The ECS task is stopped, and resources are cleaned up
5. **Update Results**: The validation results are stored in DynamoDB

## Code Changes

### 1. New Infrastructure

The infrastructure is defined using AWS CDK in the `infrastructure/` directory:

- `ValidationPipelineStack.ts`: Defines all AWS resources for the pipeline
- `cdk/lambda/validation.ts`: Contains the Lambda function code for validation

### 2. Updated Fargate Module

The `lib/aws/fargate.ts` module has been updated to use Step Functions:

- `startServerValidation()`: Starts the validation pipeline using Step Functions
- `getValidationStatus()`: Checks the status of a validation pipeline execution
- `launchContainer()`: Now a legacy function that delegates to `startServerValidation()`

### 3. Environment Configuration

A new environment variable has been added:

- `VALIDATION_STATE_MACHINE_ARN`: The ARN of the Step Functions state machine

## Usage

To validate an MCP server, use the `startServerValidation()` function:

```typescript
import { startServerValidation } from '../lib/aws/fargate';
import { ServerRecord } from '../lib/db/dynamodb';

// Create or retrieve a server record
const server: ServerRecord = {
  ServerId: 'owner/repo',
  name: 'repo',
  fullName: 'owner/repo',
  url: 'https://github.com/owner/repo',
  discoveredAt: Date.now(),
  verified: false
};

// Start the validation pipeline
const result = await startServerValidation(server);

if (result.success) {
  console.log(`Validation started with execution ARN: ${result.executionArn}`);
  
  // Optionally, check the status later
  const status = await getValidationStatus(result.executionArn);
  console.log(`Validation status: ${status.status}`);
} else {
  console.error(`Failed to start validation: ${result.error}`);
}
```

## Deployment

To deploy the validation pipeline:

1. Update the `.env.local` file with your AWS configuration
2. Navigate to the `infrastructure/` directory
3. Run `npm install` to install dependencies
4. Run `npm run deploy` to deploy the stack
5. Copy the state machine ARN from the outputs and set it as `VALIDATION_STATE_MACHINE_ARN` in `.env.local` 