# Toolshed Codebase Documentation

## Project Overview
Toolshed is a platform for managing and using various AI tools and agents, with a focus on Model Context Protocol (MCP) servers. It provides features for discovering, verifying, and running MCP servers from GitHub repositories, enabling users to leverage AI capabilities through a standardized interface.

## Tech Stack
- **Frontend**: Next.js with React 19, TailwindCSS
- **Backend**: Node.js with TypeScript
- **AWS Services**:
  - **ECS (Fargate)**: Container orchestration for MCP servers
  - **DynamoDB**: NoSQL database for storing server metadata
  - **CloudWatch**: Monitoring and logging
  - **Elastic Load Balancing**: Managing traffic to MCP servers
  - **Step Functions**: Orchestration of validation workflow
  - **Lambda**: Serverless functions for validation and utilities
  - **CodeBuild**: Building Docker images from MCP server repositories
  - **ECR**: Container registry for storing MCP server images
- **External APIs**: GitHub API (via Octokit)
- **Infrastructure as Code**: AWS Cloud Development Kit (CDK) with TypeScript

## Architecture Overview

Toolshed follows a microservices architecture pattern with the following key components:

1. **Web Application**: Next.js app providing the UI for users to discover, test, and use MCP servers
2. **API Endpoints**: REST endpoints for programmatic access to platform capabilities
3. **Validation Pipeline**: AWS Step Functions workflow for validating MCP servers
4. **Database Layer**: DynamoDB for storing and querying server metadata
5. **GitHub Integration**: API integration for discovering MCP servers from repositories
6. **Container Management**: ECS/Fargate for running MCP server containers

The system uses a serverless, event-driven approach where possible, with AWS Step Functions orchestrating the validation workflow.

## Directory Structure

### `/app` - Next.js App Router
- **page.tsx**: Main application page
- **/api/**: Backend API endpoints
  - **/api/servers/**: Server management endpoints
  - **/api/search/**: Search functionality endpoints
  - **/api/validation/**: Validation endpoints
- **/servers/**: Server-related pages
  - **/[id]/page.tsx**: Individual server details page
  - **/add/page.tsx**: Add new server page
- **/search/**: Search functionality pages
- **/playground/**: Testing playground UI for interacting with MCP servers

### `/lib` - Core Business Logic
- **/aws/**: AWS service integrations
  - **fargate.ts**: Validation pipeline integration with Step Functions
  - **load-balancer.ts**: Application Load Balancer configuration
  - **codebuild.ts**: CodeBuild integration for building Docker images
  - **stepfunctions.ts**: Step Functions integration for workflow management
  - **lambda.ts**: Lambda function utilities
- **/db/**: Database interactions
  - **dynamodb.ts**: DynamoDB operations for server data
  - **schema.ts**: Database schema definitions
  - **queries.ts**: Reusable database queries
- **/github/**: GitHub API integration
  - **crawler.ts**: Discovers MCP servers on GitHub
  - **repository.ts**: Repository management functions
  - **octokit.ts**: Octokit client configuration
- **/mcp/**: MCP protocol implementations
  - **client.ts**: Client for interacting with MCP servers
  - **types.ts**: TypeScript type definitions for MCP protocol
  - **validation.ts**: Protocol validation functions
- **/verification/**: Server verification logic
  - **tester.ts**: Tests MCP server functionality
  - **pipeline.ts**: Validation pipeline orchestration
  - **docker.ts**: Docker-related utilities for building/running containers
- **/data/**: Data models and utilities
  - **models.ts**: TypeScript interfaces for data models
  - **transformers.ts**: Data transformation utilities
  - **validation.ts**: Input validation functions

### `/components` - UI Components
- **/ui/**: Shared UI components
  - **/button/**: Button components
  - **/dialog/**: Dialog components
  - **/form/**: Form components
  - **/layout/**: Layout components
- **Navigation.tsx**: Navigation bar component
- **SearchBar.tsx**: Search functionality component
- **ServersPageActions.tsx**: Action buttons for server pages
- **AddMCPServerDialog.tsx**: Dialog for adding new MCP servers
- **ServerList.tsx**: Component for displaying server lists
- **ValidationStatus.tsx**: Component for displaying validation status

### `/scripts` - Utility Scripts
- **crawl-mcp-servers.ts**: Scripts for crawling GitHub repositories
- **deploy-github-mcp.ts**: Scripts for AWS resource management
- **init-dynamodb.ts**: Scripts for database initialization
- **test-mcp-server.ts**: Scripts for testing MCP servers
- **launch-github-mcp.ts**: Scripts for launching MCP servers
- **monitor-logs.sh**: Scripts for monitoring logs during validation

### `/infrastructure` - CDK Infrastructure
- **ValidationPipelineStack.ts**: AWS CDK stack for the validation pipeline
- **app.ts**: CDK application entry point
- **TestValidationWorkflow.ts**: CDK stack for testing validation workflow
- **/cdk/lambda/**: Lambda functions used in CDK deployment
  - **index.js**: Main validation Lambda function
  - **validation.ts**: Lambda function for validating MCP servers
  - **/stop-task/**: Lambda function for stopping ECS tasks

## Key Files and Functions

### Database Module (`lib/db/dynamodb.ts`)

```typescript
// Server record interface
export interface ServerRecord {
  ServerId: string;      // Primary key: owner/repo or a slug
  name: string;          // Short name (repo name)
  fullName: string;      // Full name in "owner/repo" format
  description?: string;  // Server description
  language?: string;     // Primary language
  url: string;           // Link to repo
  stars?: number;        // Stars count
  forks?: number;        // Forks count
  topics?: string[];     // Repository topics
  discoveredAt: number;  // Timestamp of discovery
  verified: boolean;     // Verification status
  toolCount?: number;    // Number of tools
  tools?: Array<{        // List of tools
    name: string;
    description: string;
    inputSchema?: any;
  }>;
  lastTested?: number;   // Last test timestamp
  status?: string;       // Status message
  endpoint?: string;     // Server endpoint if known
  lastUpdated?: number;  // Last update timestamp
  imageUri?: string;     // Docker image URI if built
  taskArn?: string;      // ECS task ARN if running
  validationArn?: string; // Step Functions execution ARN
}

// Database Functions
export async function saveServer(server: ServerRecord): Promise<ServerRecord>
  // Saves or updates a server record in DynamoDB
  // Input: Server record object
  // Output: Saved server record with updated timestamp

export async function getServer(serverId: string): Promise<ServerRecord | null>
  // Retrieves a server record by ID
  // Input: Server ID string
  // Output: Server record or null if not found

export async function getServerByFullName(fullName: string): Promise<ServerRecord | null>
  // Retrieves a server record by full name (owner/repo)
  // Input: Full name string in "owner/repo" format
  // Output: Server record or null if not found

export async function listAllServers(): Promise<ServerRecord[]>
  // Lists all server records in the database
  // Output: Array of all server records

export async function queryServersByName(query: string): Promise<ServerRecord[]>
  // Searches for servers by name, description, or full name
  // Input: Search query string
  // Output: Array of matching server records

export async function listVerifiedServers(): Promise<ServerRecord[]>
  // Lists servers that have been verified
  // Output: Array of verified server records

export async function updateServerVerification(
  serverId: string,
  verified: boolean,
  verificationData: object
): Promise<ServerRecord | null>
  // Updates verification status and data for a server
  // Input: Server ID, verification status, and verification data
  // Output: Updated server record or null if not found

export async function updateServerImage(
  serverId: string,
  imageUri: string
): Promise<ServerRecord | null>
  // Updates the Docker image URI for a server
  // Input: Server ID and image URI
  // Output: Updated server record or null if not found

export async function updateServerValidationStatus(
  serverId: string,
  status: string,
  details?: any
): Promise<ServerRecord | null>
  // Updates validation status for a server
  // Input: Server ID, status, and optional details
  // Output: Updated server record or null if not found

export async function deleteServer(serverId: string): Promise<boolean>
  // Deletes a server record
  // Input: Server ID
  // Output: True if deletion was successful
```

### GitHub Module (`lib/github/crawler.ts`)

```typescript
// Repository metadata interface
export interface MCPRepository {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  url: string;
  stars: number;
  forks: number;
  topics: string[];
  lastUpdated: string;
  discoveredAt: number;
  verified: boolean;
  // Verification fields
  endpoint?: string;
  toolCount?: number;
  sampleTool?: string;
  sampleOutput?: string;
  sampleRunSuccess?: boolean;
  lastTested?: string;
  status?: string;
  taskArn?: string;
  imageUri?: string;
  validationArn?: string;
}

// GitHub API Functions
export async function searchMCPRepositories(
  query: string = 'topic:mcp',
  maxResults: number = 100,
  saveToDb: boolean = true
): Promise<MCPRepository[]>
  // Searches GitHub for repositories based on search criteria
  // Input: Search query, maximum results, save to database flag
  // Output: Array of repository metadata

export async function crawlMCPServers(
  query?: string,
  maxResults?: number,
  saveToDb: boolean = true
): Promise<{found: number, repositories: MCPRepository[]}>
  // Crawls GitHub for MCP server repositories
  // Input: Search query, maximum results, save to database flag
  // Output: Object with count and array of repository metadata

export async function crawlAwesomeMCPList(): Promise<MCPRepository[]>
  // Searches repositories from the awesome-mcp-servers list
  // Output: Array of repository metadata

export async function cloneRepository(
  repoFullName: string,
  destination: string
): Promise<{success: boolean, error?: string}>
  // Clones a repository to local destination
  // Input: Repository full name, destination directory
  // Output: Success status and error message if failed

export async function checkRepositoryValidity(
  repoFullName: string
): Promise<{valid: boolean, reason?: string}>
  // Checks if a repository is a valid MCP server
  // Input: Repository full name
  // Output: Validity status and reason if invalid
```

### Verification Module (`lib/verification/tester.ts`)

```typescript
// Tool definition interface
interface MCPTool {
  name: string;
  description: string;
  inputSchema?: any;
}

// Verification Functions
export async function verifyServer(
  server: MCPRepository,
  saveToDb: boolean = true
): Promise<MCPRepository>
  // Verifies a single MCP server
  // Input: Repository metadata, save to database flag
  // Output: Updated repository metadata with verification results

export async function verifyServers(
  servers: MCPRepository[],
  saveToDb: boolean = true
): Promise<MCPRepository[]>
  // Verifies multiple MCP servers
  // Input: Array of repository metadata, save to database flag
  // Output: Array of updated repository metadata with verification results

export async function verifyMCPServerFromGitHub(repoFullName: string): Promise<{
  verified: boolean;
  repoFullName: string;
  message?: string;
  details?: any;
}>
  // Verifies an MCP server directly from GitHub
  // Input: Repository full name
  // Output: Verification result with status and details

export async function startVerificationPipeline(
  server: ServerRecord
): Promise<{
  success: boolean;
  executionArn?: string;
  error?: string;
}>
  // Starts the AWS Step Functions verification pipeline
  // Input: Server record
  // Output: Execution details

export async function monitorVerificationStatus(
  executionArn: string
): Promise<{
  status: string;
  success: boolean;
  details?: any;
}>
  // Monitors the status of a verification pipeline execution
  // Input: Execution ARN
  // Output: Status information

// Helper Functions
async function testServerConnection(endpoint: string): Promise<boolean>
  // Tests if an MCP server is accessible
  // Input: Server endpoint URL
  // Output: True if server is accessible

async function listServerTools(endpoint: string): Promise<MCPTool[] | null>
  // Lists tools available from an MCP server
  // Input: Server endpoint URL
  // Output: Array of tools or null if failed

async function runSampleTool(
  endpoint: string,
  toolName: string,
  input: any = {}
): Promise<{success: boolean, output?: any}>
  // Runs a sample tool on an MCP server
  // Input: Server endpoint, tool name, input parameters
  // Output: Tool execution result with success flag and output
```

### AWS Fargate Module (`lib/aws/fargate.ts`)

```typescript
// Default configuration
export const DEFAULT_CONFIG = {
  region: process.env.AWS_REGION || 'us-east-1',
  vpcId: process.env.AWS_VPC_ID,
  subnets: process.env.AWS_SUBNETS ? process.env.AWS_SUBNETS.split(',') : [],
  securityGroupId: process.env.AWS_SECURITY_GROUP_ID,
  executionRoleArn: process.env.AWS_EXECUTION_ROLE_ARN,
  taskRoleArn: process.env.AWS_TASK_ROLE_ARN,
  logGroupName: process.env.AWS_LOG_GROUP_NAME || '/ecs/mcp-server',
  taskDefinitionFamily: process.env.AWS_TASK_DEFINITION_FAMILY || 'mcp-server-task',
  containerPort: parseInt(process.env.CONTAINER_PORT || '8000', 10),
  cpu: process.env.TASK_CPU || '256',
  memory: process.env.TASK_MEMORY || '512'
};

// Fargate Functions
export async function startServerValidation(
  server: ServerRecord
): Promise<{
  success: boolean;
  executionArn?: string;
  error?: string;
}>
  // Starts the validation pipeline for an MCP server using Step Functions
  // Input: Server record object
  // Output: Result with execution ARN

export async function getValidationStatus(
  executionArn: string
): Promise<{
  status: string;
  success: boolean;
  output?: any;
  error?: string;
}>
  // Checks the status of a validation pipeline execution
  // Input: Execution ARN
  // Output: Execution status information

export async function stopContainer(
  taskArn: string, 
  reason: string = 'Task no longer needed'
): Promise<{
  success: boolean;
  error?: string;
}>
  // Stops a running container
  // Input: Task ARN and reason
  // Output: Success status and error message if any

export async function checkContainerStatus(
  taskArn: string
): Promise<{
  running: boolean;
  status?: string;
  error?: string;
  details?: any;
}>
  // Checks the status of a container
  // Input: Task ARN
  // Output: Detailed status information

export async function launchContainer(options: {
  image: string;
  serverName: string;
  taskDefinitionFamily?: string;
  containerPort?: number;
  environmentVariables?: Array<{ name: string; value: string }>;
}): Promise<{
  success: boolean;
  endpoint?: string;
  taskArn?: string;
  error?: string;
}>
  // Launches a container with the specified options
  // Input: Container options
  // Output: Successful launch information with endpoint

export async function ensureTaskDefinition(
  options: {
    image: string;
    containerPort?: number;
    cpu?: string;
    memory?: string;
    taskDefinitionFamily?: string;
    environmentVariables?: Array<{ name: string; value: string }>;
  }
): Promise<string>
  // Ensures a task definition exists or creates one
  // Input: Task definition options
  // Output: Task definition ARN
```

### AWS CDK Validation Pipeline (`infrastructure/ValidationPipelineStack.ts`)

```typescript
// ValidationPipelineStack Interface
export interface ValidationPipelineStackProps extends cdk.StackProps {
  vpcId?: string;
  subnetIds?: string[];
  securityGroupId?: string;
  dynamoDbTableName?: string;
}

// ValidationPipelineStack Class
export class ValidationPipelineStack extends cdk.Stack {
  public readonly stateMachineArn: string;
  
  constructor(scope: Construct, id: string, props?: ValidationPipelineStackProps) {
    super(scope, id, props);
    
    // Resources created in this stack:
    // 1. ECR Repository for MCP Server images
    // 2. GitHub & DockerHub Secrets (from existing secrets)
    // 3. CodeBuild Project for building Docker images
    // 4. ECS Cluster for running validation tasks
    // 5. IAM Roles for task execution and permissions
    // 6. Lambda Functions for validation and task management
    // 7. Step Functions State Machine for orchestration
    
    // Step Functions Workflow:
    // 1. BuildMCPServerImage: Build Docker image from GitHub repository
    // 2. ParseImageUri: Extract image URI from build output
    // 3. RegisterValidationTaskDef: Create ECS task definition with the image
    // 4. RunMCPServerContainer: Run the container in ECS
    // 5. WaitForTaskStartup: Wait for the container to initialize
    // 6. DescribeTask: Get details of the running task
    // 7. ValidateMCPServer: Validate the MCP server functionality
    // 8. StopMCPServerContainer: Clean up the running container
    // 9. Decision: Succeed or fail based on validation result
  }
}
```

### Lambda Validation Function (`infrastructure/cdk/lambda/index.js`)

```javascript
// Validation Lambda handler
exports.handler = async (event) => {
  console.log('Validation event:', JSON.stringify(event));
  
  const { serverId, endpoint, taskArn } = event;
  
  if (!endpoint) {
    console.error('No endpoint provided');
    return {
      verified: false,
      error: 'No endpoint provided'
    };
  }
  
  try {
    // Validate the MCP server by testing its connection and functionality
    // Test connection to endpoint
    // List available tools
    // Run a sample tool to verify functionality
    
    return {
      verified: true,
      health: { status: 'healthy', endpoint },
      serverId,
      taskArn
    };
  } catch (error) {
    console.error('Validation failed:', error);
    return {
      verified: false,
      error: error.message,
      serverId,
      taskArn
    };
  }
};
```

### Stop Task Lambda Function (`infrastructure/cdk/lambda/stop-task/index.js`)

```javascript
const { ECSClient, StopTaskCommand } = require("@aws-sdk/client-ecs");

// Stop Task Lambda handler
exports.handler = async (event) => {
  const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
  
  try {
    // Stop the ECS task using the provided task ARN
    const stopTaskCommand = new StopTaskCommand({
      cluster: process.env.CLUSTER_ARN || 'ToolShed-Validation-Cluster',
      task: event.taskArn,
      reason: 'Stopped by Step Functions'
    });
    
    await ecsClient.send(stopTaskCommand);
    
    return { 
      success: true, 
      taskArn: event.taskArn 
    };
  } catch (error) {
    console.error('Error stopping task:', error);
    throw error;
  }
};
```

## Detailed Validation Pipeline Workflow

The validation pipeline is a key component of the Toolshed platform, responsible for validating MCP servers discovered from GitHub repositories. The workflow is orchestrated using AWS Step Functions and includes the following steps:

1. **Trigger Point**: The pipeline is triggered when a user adds a new MCP server or requests validation of an existing server.

2. **Build Process**:
   - The CodeBuild project is started to build a Docker image from the GitHub repository
   - The repository is cloned using GitHub credentials
   - Docker image is built and pushed to ECR
   - The image URI is captured for subsequent steps

3. **Task Definition**:
   - A dynamic ECS task definition is registered with the built image URI
   - The task definition includes configuration for container port, memory, CPU, and logging

4. **Container Execution**:
   - The ECS task is started using Fargate
   - The system waits for the container to initialize
   - Once running, the task information including network configuration is retrieved

5. **Validation Process**:
   - A Lambda function validates the MCP server by:
     - Testing connectivity to the server endpoint
     - Listing available tools
     - Running a sample tool to verify functionality
   - Validation results are returned to the Step Functions workflow

6. **Cleanup**:
   - The running ECS task is stopped to release resources
   - Validation results are persisted to DynamoDB

7. **Result Handling**:
   - The workflow ends with success or failure based on validation results
   - The server record is updated with validation status and details

## Key Scripts and Commands

```typescript
// scripts/crawl-mcp-servers.ts
// Crawls GitHub for MCP servers and stores in DynamoDB
// Usage: npx ts-node -P scripts/tsconfig.json scripts/crawl-mcp-servers.ts "topic:mcp" 10

// scripts/verify-mcp-servers.ts
// Verifies discovered servers and updates metadata
// Usage: npx ts-node -P scripts/tsconfig.json scripts/verify-mcp-servers.ts "topic:mcp" 5

// scripts/init-dynamodb.ts
// Initializes the DynamoDB tables needed for the application
// Usage: npx ts-node -P scripts/tsconfig.json scripts/init-dynamodb.ts

// scripts/test-load-balancer.ts
// Tests the load balancer configuration for MCP servers
// Usage: npx ts-node -P scripts/tsconfig.json scripts/test-load-balancer.ts

// scripts/deploy-github-mcp.ts
// Deploys an MCP server from a GitHub repository
// Usage: npx ts-node -P scripts/tsconfig.json scripts/deploy-github-mcp.ts owner/repo

// infrastructure/test_validate_workflow.sh
// Tests the validation workflow with a sample repository
// Usage: ./infrastructure/test_validate_workflow.sh

// infrastructure/monitor-logs.sh
// Monitors logs from Step Functions, CodeBuild, and ECS
// Usage: ./infrastructure/monitor-logs.sh [execution-arn]
```

## CDK Deployment

The CDK infrastructure is deployed using the following commands:

```bash
# Initialize the CDK project (if not already done)
cd infrastructure
npm install
npm run build

# Deploy the validation pipeline stack
cdk deploy ValidationPipelineStack

# To test the validation pipeline
./test_validate_workflow.sh
```

## Environment Variables
Important variables from `.env.local`:
- `AWS_REGION`: AWS region for services
- `AWS_SUBNETS`: AWS subnet IDs (comma-separated)
- `AWS_VPC_ID`: AWS VPC ID
- `AWS_SECURITY_GROUP_ID`: AWS security group ID
- `AWS_EXECUTION_ROLE_ARN`: AWS IAM role ARN for task execution
- `AWS_TASK_ROLE_ARN`: AWS IAM role ARN for task permissions
- `GITHUB_TOKEN`: GitHub API token for repository access
- `VALIDATION_STATE_MACHINE_ARN`: ARN of the Step Functions state machine for validation
- `DYNAMODB_TABLE`: Name of the DynamoDB table for server records
- `CONTAINER_PORT`: Default port for MCP server containers (default: 8000)
- `TASK_CPU`: CPU units for ECS tasks (default: 256)
- `TASK_MEMORY`: Memory for ECS tasks (default: 512)

## Common Issues and Solutions

1. **Invalid JSON Path in Step Functions**: Make sure to use the exact case in JSONPath expressions when accessing properties in Step Functions states, as AWS service responses have specific casing.

2. **CodeBuild Environment Variables**: Environment variables in CodeBuild are passed in the format `name`, `value`, and `type`. The type can be `PLAINTEXT`, `PARAMETER_STORE`, or `SECRETS_MANAGER`.

3. **ECS Task Registration**: When dynamically registering ECS tasks, ensure the container definition includes all required properties such as `Name`, `Image`, `Essential`, and proper `LogConfiguration`.

4. **Step Functions Error Handling**: Use the `Catch` property in Step Functions states to handle specific errors and provide fallback paths.

5. **Lambda Function Timeouts**: Default Lambda timeouts might be too short for validation purposes. Set appropriate timeout values (e.g., 5-15 minutes) for validation functions.

## Adding New Features

When adding new features to Toolshed, consider the following:

1. **Frontend Components**: Add new React components in the `/components` directory and update pages in the `/app` directory.

2. **API Endpoints**: Add new API endpoints in the `/app/api` directory following the Next.js API route patterns.

3. **Business Logic**: Extend the core business logic in the `/lib` directory, keeping functionality organized by domain.

4. **Infrastructure**: Update CDK stacks in the `/infrastructure` directory when adding new AWS resources.

5. **Database Schema**: Update data models in `lib/db/schema.ts` when changing database structure.

6. **Scripts**: Add new utility scripts in the `/scripts` directory for automation tasks.

7. **Documentation**: Update this documentation when adding significant new features.

## Future Improvements

1. **Multi-Region Support**: Add support for deploying MCP servers in multiple AWS regions.

2. **User Authentication**: Implement user authentication and authorization for server management.

3. **Dashboard**: Create a comprehensive dashboard for monitoring server status and metrics.

4. **Integration Tests**: Add more comprehensive integration tests for the validation pipeline.

5. **Cost Optimization**: Implement auto-scaling and cost optimization strategies for ECS tasks.

6. **Enhanced Monitoring**: Add enhanced monitoring and alerting for MCP servers.

7. **API Gateway Integration**: Add API Gateway integration for exposing MCP servers externally. 