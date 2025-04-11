# Toolshed Codebase Documentation

## Project Overview
Toolshed is a platform for managing and using various AI tools and agents, with a focus on Model Context Protocol (MCP) servers. It provides features for discovering, verifying, and running MCP servers.

## Tech Stack
- **Frontend**: Next.js with React 19, TailwindCSS
- **Backend**: Node.js with TypeScript
- **AWS Services**: ECS (Fargate), DynamoDB, CloudWatch, Elastic Load Balancing, Step Functions, Lambda, CodeBuild, ECR
- **External APIs**: GitHub API (via Octokit)

## Directory Structure

### `/app` - Next.js App Router
- **page.tsx**: Main application page
- **/api/**: Backend API endpoints
- **/servers/**: Server-related pages
- **/search/**: Search functionality pages
- **/playground/**: Testing playground UI

### `/lib` - Core Business Logic
- **/aws/**: AWS service integrations
  - **fargate.ts**: Validation pipeline integration with Step Functions
  - **load-balancer.ts**: Application Load Balancer configuration
- **/db/**: Database interactions
  - **dynamodb.ts**: DynamoDB operations for server data
- **/github/**: GitHub API integration
  - **crawler.ts**: Discovers MCP servers on GitHub
- **/mcp/**: MCP protocol implementations
- **/verification/**: Server verification logic
  - **tester.ts**: Tests MCP server functionality
- **/data/**: Data models and utilities

### `/components` - UI Components
- **/ui/**: Shared UI components
- **Navigation.tsx**: Navigation bar component
- **SearchBar.tsx**: Search functionality component
- **ServersPageActions.tsx**: Action buttons for server pages
- **AddMCPServerDialog.tsx**: Dialog for adding new MCP servers

### `/scripts` - Utility Scripts
- Scripts for crawling GitHub repositories
- Scripts for AWS resource management
- Scripts for database initialization
- Scripts for testing MCP servers

### `/infrastructure` - CDK Infrastructure
- **ValidationPipelineStack.ts**: AWS CDK stack for the validation pipeline
- **app.ts**: CDK application entry point
- **/cdk/lambda/**: Lambda functions used in CDK deployment
  - **validation.ts**: Lambda function for validating MCP servers

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
  // Stops a running container (legacy function)
  // Input: Task ARN and reason
  // Output: Success status and error message if any

export async function checkContainerStatus(
  taskArn: string
): Promise<{
  running: boolean;
  status?: string;
  error?: string;
}>
  // Checks the status of a container (legacy function)
  // Input: Task ARN
  // Output: Status information

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
  // Legacy function that now delegates to startServerValidation
  // Input: Container options
  // Output: Status information
```

### AWS CDK Infrastructure (`infrastructure/ValidationPipelineStack.ts`)

```typescript
// ValidationPipelineStack class
export class ValidationPipelineStack extends cdk.Stack
  // Defines AWS infrastructure for the MCP server validation pipeline
  // Includes:
  // - ECR Repository for Docker images
  // - CodeBuild Project for building images
  // - ECS Cluster for running containers
  // - Lambda Function for validation
  // - Step Functions State Machine for orchestration
```

## Key Scripts

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
```

## Environment Variables
Important variables from `.env.local`:
- `AWS_REGION`: AWS region for services
- `AWS_SUBNETS`: AWS subnet IDs (comma-separated)
- `AWS_VPC_ID`: AWS VPC ID
- `AWS_SECURITY_GROUP_ID`: AWS security group ID
- `AWS_EXECUTION_ROLE_ARN`: AWS IAM role ARN for task execution
- `GITHUB_TOKEN`: GitHub API token for repository access
- `VALIDATION_STATE_MACHINE_ARN`: ARN of the Step Functions state machine for validation

Note: There's a comment in the `.env.local` file: "The script used AWS_SUBNET_IDS but our code uses AWS_SUBNETS", indicating a variable naming discrepancy.

## Workflow
1. Crawl GitHub for MCP servers
2. Store server metadata in DynamoDB
3. Validate servers using the Step Functions validation pipeline
4. View validation results in the UI or DynamoDB 