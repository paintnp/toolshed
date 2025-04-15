# ToolShed Playground Documentation

## Overview

The ToolShed Playground is a feature designed to allow users to interact with verified MCP (MOdel context protocol) servers directly from the web interface. It leverages AWS Fargate to dynamically spin up containers running MCP server images and provides a command-line-like interface for users to interact with these servers.

### Current Implementation Status

**IMPORTANT NOTE**: While the container deployment pipeline works successfully (containers reach RUNNING state), the user interaction components of the playground have critical issues:

1. ❌ **Command Execution**: The execute button remains disabled/grayed out, preventing user interaction
2. ❌ **Server Communication**: Users cannot send commands to the running MCP server
3. ❌ **Playground Termination**: The "Stop Playground" functionality is not working as expected

## Technical Stack

- **Frontend**: Next.js with App Router, React, TypeScript
- **Backend**: Node.js, AWS SDK
- **Infrastructure**: AWS CDK, CloudFormation
- **Compute**: AWS Fargate, ECS (Elastic Container Service)
- **Storage**: DynamoDB for server metadata, ECR (Elastic Container Registry) for Docker images
- **Orchestration**: AWS Step Functions for validation pipeline
- **Monitoring**: CloudWatch Logs

## Container Generation Pipeline

### Validation Pipeline Architecture

The system uses a multi-stage pipeline to validate MCP servers and prepare them for playground use:

1. **Server Discovery/Registration**: A server is added to the system with basic metadata
2. **Validation Initiation**: The validation pipeline is triggered via AWS Step Functions
3. **Docker Image Building**: A Docker image is built containing the MCP server
4. **Image Storage**: The built image is stored in Amazon ECR
5. **Server Record Update**: The DynamoDB record is updated with image URI and validation status

### Detailed Workflow

#### Step Functions State Machine

The validation workflow is defined in `infrastructure/ValidationPipelineStack.ts` with the following key states:

```typescript
// From ValidationPipelineStack.ts
const validationStateMachine = new sfn.StateMachine(this, 'MCP-Server-Validation-Pipeline', {
  stateMachineName: 'ToolShed-MCP-Server-Validation-Pipeline',
  definition: sfn.Chain
    .start(checkServerRecord)
    .next(new sfn.Choice(this, 'ServerExists?')
      .when(sfn.Condition.stringEquals('$.serverExists', 'false'), createInitialServerRecord)
      .otherwise(new sfn.Pass(this, 'ServerRecordExists')))
    .next(startBuildTask)
    .next(waitForBuildTask)
    .next(new sfn.Choice(this, 'BuildSucceeded?')
      .when(sfn.Condition.stringEquals('$.buildStatus', 'SUCCEEDED'), updateServerVerificationSuccess)
      .otherwise(updateServerVerificationFailure)),
  timeout: cdk.Duration.minutes(30),
  tracingEnabled: true,
});
```

#### Lambda Functions

The workflow uses several Lambda functions to handle different stages:

- `infrastructure/cdk/lambda/build.ts`: Builds Docker images for MCP servers
- `infrastructure/cdk/lambda/check-server.ts`: Verifies server existence in DynamoDB
- `infrastructure/cdk/lambda/update-server.ts`: Updates server verification status

### Key Components

#### 1. Step Functions Workflow

The validation workflow defined in `infrastructure/ValidationPipelineStack.ts` orchestrates:
- Server verification
- Docker image building
- Metadata storage

#### 2. ECR Repository

The system maintains an ECR repository (`toolshed-mcp-servers-v2`) to store Docker images for validated servers, with tags that link back to the validation execution ID.

ECR repository configuration in `ValidationPipelineStack.ts`:

```typescript
// ECR Repository for storing server images
const ecrRepository = new ecr.Repository(this, 'MCPServersRepository', {
  repositoryName: 'toolshed-mcp-servers-v2',
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  lifecycleRules: [
    {
      description: 'Keep only the last 20 images',
      maxImageCount: 20,
      rulePriority: 1,
    }
  ]
});
```

#### 3. DynamoDB Integration

Server records are stored in the `ToolShedServers` table with attributes like:
- `ServerId`: Unique identifier for the server
- `imageUri`: The ECR URI of the validated Docker image
- `status`: Validation status (e.g., "VERIFIED", "FAILED")
- `taskArn`: Reference to the ECS task or Step Functions execution

DynamoDB table access pattern in `lib/db/dynamodb.ts`:

```typescript
// Function signature from lib/db/dynamodb.ts
export async function getServerById(
  serverId: string
): Promise<ServerRecord | null> {
  const params: GetItemCommandInput = {
    TableName: SERVERS_TABLE_NAME,
    Key: {
      ServerId: { S: serverId }
    }
  };

  try {
    const result = await dynamoClient.send(new GetItemCommand(params));
    if (!result.Item) return null;
    
    return unmarshallServerRecord(result.Item);
  } catch (error) {
    console.error(`Error getting server with ID ${serverId}:`, error);
    throw error;
  }
}
```

## Container Execution and Access

### Playground Deployment Architecture

The playground feature deploys containers on-demand using AWS Fargate:

1. **Task Definition Registration**: Dynamic task definitions are created per server
2. **Fargate Task Execution**: Tasks are launched in AWS Fargate with public IP assignment
3. **Status Monitoring**: The system periodically checks the task status
4. **Connection Establishment**: A connection to the running container is established via HTTP

### Key Components

#### 1. Playground Management (`lib/aws/playground.ts`)

Core functions with actual signatures:

```typescript
// From lib/aws/playground.ts
export async function registerPlaygroundTaskDefinition(
  image: string,
  containerName: string = 'mcp-server',
  containerPort: number = DEFAULT_CONFIG.containerPort
): Promise<string>

export async function launchPlayground(
  image: string,
  serverId: string
): Promise<{ 
  success: boolean, 
  taskArn?: string, 
  error?: string 
}>

export async function stopPlayground(
  taskArn: string
): Promise<{ 
  success: boolean, 
  error?: string 
}>

export async function getPlaygroundStatus(
  taskArn: string
): Promise<{ 
  success: boolean, 
  status?: string, 
  endpoint?: string, 
  error?: string 
}>
```

Task launch implementation (simplified):

```typescript
// From lib/aws/playground.ts - task launch logic
const runTaskCommand = new RunTaskCommand({
  cluster: playgroundConfig.cluster,
  taskDefinition: taskDefinitionArn,
  launchType: 'FARGATE',
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: playgroundConfig.subnets,
      securityGroups: [playgroundConfig.securityGroupId],
      assignPublicIp: AssignPublicIp.ENABLED
    }
  },
  startedBy: `toolshed-playground-${serverId}`,
  tags: [
    { key: 'ServerID', value: serverId },
    { key: 'Environment', value: 'Playground' }
  ]
});
```

#### 2. Task Definition Configuration

Each MCP server gets a unique task definition with:
- Networking configuration with public IP assignment
- Container port mapping (default: 8000)
- CloudWatch logging configuration
- Server-specific parameters (e.g., special flags for Semgrep MCP servers)

Task definition creation (simplified):

```typescript
// From lib/aws/playground.ts - task definition creation
const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
  family: `${baseFamily}-${imageHash}`,
  requiresCompatibilities: ['FARGATE'],
  networkMode: 'awsvpc',
  cpu: DEFAULT_CONFIG.cpu,
  memory: DEFAULT_CONFIG.memory,
  executionRoleArn: playgroundConfig.executionRoleArn,
  containerDefinitions: [{
    name: containerName,
    image: image,
    essential: true,
    portMappings: [
      {
        containerPort: containerPort,
        hostPort: containerPort,
        protocol: 'tcp'
      }
    ],
    logConfiguration: {
      logDriver: 'awslogs',
      options: {
        'awslogs-group': `/ecs/ToolshedPlayground`,
        'awslogs-region': process.env.AWS_REGION || 'us-east-1',
        'awslogs-stream-prefix': 'playground',
        'awslogs-create-group': 'true'
      }
    }
  }]
});
```

#### 3. Configuration Management (`lib/aws/config.ts`)

Retrieves deployment settings from SSM parameters or environment variables:
- Security groups
- Subnets
- IAM roles
- Cluster settings

Configuration retrieval (simplified):

```typescript
// From lib/aws/config.ts
export async function getPlaygroundConfig(): Promise<PlaygroundConfig> {
  const config: PlaygroundConfig = {
    subnets: [],
    securityGroupId: '',
    executionRoleArn: '',
    cluster: 'default'
  };
  
  // Try to get from environment variables first
  if (process.env.AWS_PLAYGROUND_SUBNETS) {
    config.subnets = process.env.AWS_PLAYGROUND_SUBNETS.split(',');
  }
  
  if (process.env.AWS_PLAYGROUND_SECURITY_GROUP) {
    config.securityGroupId = process.env.AWS_PLAYGROUND_SECURITY_GROUP;
  }
  
  // Fall back to SSM if environment variables not set
  // [SSM parameter loading logic...]
  
  return config;
}
```

## Frontend Implementation

### User Interface Components

#### 1. Playground Page (`app/playground/page.tsx`)

Main React component that implements:
- Server selection
- Playground launch and status monitoring
- Command execution interface
- Tool listing
- Session persistence with localStorage

**Key UI State Management** (where issues occur):

```typescript
// From app/playground/page.tsx
const [playgroundStatus, setPlaygroundStatus] = useState<{
  isLaunching: boolean;
  taskArn?: string;
  endpoint?: string;
  statusMessage?: string;
  ip?: string;
  port?: string;
}>({
  isLaunching: false
});

// Command execution function - PROBLEMATIC
async function executeCommand(e: React.FormEvent) {
  e.preventDefault();
  
  if (!input.trim() || !serverInfo || !playgroundStatus.endpoint) return;
  
  const command = input.trim();
  setInput('');
  
  // Add command to history
  setHistory(prev => [...prev, { type: 'input', content: command }]);
  
  try {
    setLoading(true);
    
    const response = await fetch(`/api/servers/${encodeURIComponent(serverInfo.id)}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        command,
        endpoint: playgroundStatus.endpoint  // Pass the endpoint to the API
      }),
    });
    
    // [Response handling...]
  } catch (error) {
    // [Error handling...]
  }
}
```

**Command Input Form** (where user can't interact with server):

```tsx
// From app/playground/page.tsx - Command input form
<form onSubmit={executeCommand} className="flex gap-2">
  <Input
    value={input}
    onChange={(e) => setInput(e.target.value)}
    placeholder={playgroundStatus.endpoint ? "Enter a command..." : "Wait for playground to start..."}
    disabled={!playgroundStatus.endpoint || loading}
    className="font-mono"
  />
  <Button 
    type="submit" 
    disabled={!playgroundStatus.endpoint || loading || !input.trim()}
  >
    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
    Execute
  </Button>
</form>
```

#### 2. API Routes

- `/api/servers/[id]/playground` (`app/api/servers/[id]/playground/route.ts`): Launches a playground environment
- `/api/servers/[id]/playground/status`: Checks playground status and provides connection information
- `/api/servers/[id]/playground/stop`: Stops a running playground
- `/api/servers/[id]/execute`: Executes commands against the running MCP server
- `/api/servers/[id]/mcp-proxy`: Proxies requests to the MCP server for tool discovery

**API Route for Command Execution** (`app/api/servers/[id]/execute/route.ts`):

```typescript
// From app/api/servers/[id]/execute/route.ts
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const serverId = params.id;
    const body = await request.json();
    const { command, endpoint } = body;
    
    // Validate inputs
    if (!command) {
      return Response.json({ error: 'Command is required' }, { status: 400 });
    }
    
    if (!endpoint) {
      return Response.json({ error: 'Endpoint is required' }, { status: 400 });
    }
    
    // Call the MCP server through the proxy
    const result = await fetch(`${endpoint}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    });
    
    // Handle response and return to client
    // [...]
  } catch (error) {
    console.error('Error executing command:', error);
    return Response.json(
      { error: 'Failed to execute command' },
      { status: 500 }
    );
  }
}
```

**Status Check API** (`app/api/servers/[id]/playground/status/route.ts`):

```typescript
// From app/api/servers/[id]/playground/status/route.ts
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const taskArn = searchParams.get('taskArn');
    
    if (!taskArn) {
      return Response.json({ error: 'Task ARN is required' }, { status: 400 });
    }
    
    const status = await getPlaygroundStatus(taskArn);
    
    // Process the status response
    if (status.success && status.status === 'RUNNING') {
      // Get IP and port from endpoint
      let ip = null;
      let port = null;
      
      if (status.endpoint) {
        try {
          const url = new URL(status.endpoint);
          ip = url.hostname;
          port = url.port;
        } catch (e) {
          console.error('Error parsing endpoint URL:', e);
        }
      }
      
      return Response.json({
        status: status.status,
        endpoint: status.endpoint,
        ip,
        port
      });
    }
    
    return Response.json({
      status: status.status || 'UNKNOWN',
      reason: status.error
    });
  } catch (error) {
    console.error('Error checking playground status:', error);
    return Response.json(
      { error: 'Failed to check playground status' },
      { status: 500 }
    );
  }
}
```

### User Flow Issues

The following functionality is **NOT WORKING** despite containers reaching RUNNING state:

1. **Command Interface Disabled**:
   - The UI shows the container is running, but the command interface remains disabled
   - The `disabled={!playgroundStatus.endpoint || loading || !input.trim()}` condition in the Button component prevents interaction
   - Investigation needed: Is `playgroundStatus.endpoint` being correctly set when the container is running?

2. **Server Communication**:
   - The UI reports successful container launch but cannot send/receive commands
   - Possible issue: Connectivity between frontend and container endpoint

3. **Playground Termination**:
   - The "Stop Playground" button is present but not functional
   - This should call the `/api/servers/[id]/playground/stop` endpoint with the task ARN

## Open Architecture Questions

1. **Public Network Access**:
   - **Question**: Are the containers actually accessible from the public internet?
   - **Context**: The task configurations set `assignPublicIp: AssignPublicIp.ENABLED`, but we need to verify:
     - Are the security groups properly configured to allow inbound traffic on the MCP server port (default: 8000)?
     - Does the VPC configuration allow public IP routing?
     - Are there any Network ACLs blocking public access?

2. **Cross-Origin Resource Sharing (CORS)**:
   - **Question**: Are CORS headers properly configured to allow the frontend to communicate with the container?
   - **Context**: The browser may block direct API calls to the container if CORS headers are missing

3. **Endpoint Format Verification**:
   - **Question**: Is the endpoint URL correctly formatted and accessible from the client browser?
   - **Context**: The endpoint is constructed as `http://${publicIpDetail.value}:${DEFAULT_CONFIG.containerPort}`
   - **Issue**: This direct IP access might be blocked by browser security policies or network configurations

4. **API Proxy Implementation**:
   - **Question**: Is the MCP-proxy API route correctly forwarding requests to the container?
   - **Context**: The system uses a proxy endpoint to avoid CORS issues, but it may not be functioning correctly

## Infrastructure as Code (CDK)

### Key Stacks

#### 1. ValidationPipelineStack

Defined in `infrastructure/ValidationPipelineStack.ts`, this stack creates:
- Step Functions state machine for validation
- Lambda functions for Docker image building
- ECR repository for image storage
- IAM roles and policies
- CloudWatch logs

#### 2. TestValidationWorkflow

Defined in `infrastructure/TestValidationWorkflow.ts`, this stack is for testing:
- Direct invocation of validation steps
- Testing server verification logic

### Deployment Configuration

- Region: `us-east-1` (hardcoded in app.ts)
- Environment variables loaded from `.env.local`
- Custom VPC, subnet, and security group configuration

## Current Issues and Challenges

The current implementation has the following challenges:

1. **Container Access**: While containers reach the RUNNING state, users cannot effectively interact with them through the UI
2. **Connection Mechanism**: The connection mechanism between the UI and the running containers may need improvement
3. **Tool Discovery**: The system attempts different methods to discover tools from the MCP server, but may not be fully reliable
4. **User Experience**: The playground UI may need enhanced functionality for effective interaction with MCP servers

## Potential Areas for Improvement

1. **Direct API Access**: Implement a dedicated API proxy to forward all requests to the running container
2. **Interactive Documentation**: Generate interactive documentation based on discovered tools
3. **WebSocket Connection**: Consider implementing WebSocket connections for real-time interaction
4. **Enhanced UX**: Improve the playground UI with features like:
   - Tool-specific input forms
   - Visual result rendering
   - Session management
   - Examples and templates
5. **Network Configuration**: Verify that security groups and network settings allow proper access

## Debugging Steps for Interaction Issues

1. **Verify Endpoint Accessibility**:
   ```bash
   # Test if the container endpoint is accessible
   curl -v http://<container-ip>:8000/
   
   # Check if tools API endpoints respond
   curl -v http://<container-ip>:8000/api/tools
   ```

2. **Check CloudWatch Logs**:
   - Examine the container logs in CloudWatch (`/ecs/ToolshedPlayground`) for errors
   - Check for any connection attempts or errors in the application logs

3. **Security Group Verification**:
   ```bash
   # Retrieve security group details
   aws ec2 describe-security-groups --group-ids <security-group-id>
   
   # Verify inbound rules allow traffic on port 8000
   ```

4. **Frontend Network Analysis**:
   - Use browser developer tools to monitor network requests
   - Check console for CORS errors or other connection issues

## Conclusion

The ToolShed Playground feature implements a sophisticated pipeline for validating, deploying, and interacting with MCP servers. The system successfully builds and launches containers, but critical issues prevent user interaction with the containers.

The key problems to solve are:
1. Why the command interface remains disabled despite container RUNNING status
2. Whether containers are actually accessible from the public internet
3. How to properly handle communication between the frontend and container endpoints

Future development should focus on addressing these issues to provide a seamless interactive experience with MCP servers. 