# Toolshed Playground with Persistent Image Reuse

This document describes the implementation of the Toolshed Playground feature with persistent image reuse. Instead of rebuilding Docker images for every playground session, we now reuse the pre-built images stored in ECR during the validation process.

## Architecture Overview

1. **Validation Pipeline**: Builds Docker images for MCP servers and stores them in ECR.
2. **DynamoDB Storage**: Stores the ECR image URI, tag, and SHA in the server record.
3. **Playground Launch**: Uses the stored image URI to launch an ECS Fargate task.
4. **Command Execution**: Passes commands from the UI to the running container.

## Implementation Details

### 1. API Routes

#### Playground Launch Endpoint
- **Route**: `POST /api/servers/[id]/playground`
- **Purpose**: Launches a new playground environment for a server
- **Process**:
  - Retrieves server record from DynamoDB
  - Checks if the server is verified and has an `imageUri`
  - Registers a task definition (or uses existing one)
  - Starts an ECS Fargate task with the image
  - Returns the task ARN for tracking

#### Playground Status Endpoint
- **Route**: `GET /api/servers/[id]/playground/status`
- **Purpose**: Checks the status of a running playground environment
- **Process**:
  - Gets the task ARN from query parameters
  - Calls ECS DescribeTasks to get current status
  - Extracts connection details when the task is running
  - Returns status, endpoint, and container details

#### Playground Stop Endpoint
- **Route**: `POST /api/servers/[id]/playground/stop`
- **Purpose**: Stops a running playground environment
- **Process**:
  - Gets the task ARN from request body
  - Calls ECS StopTask to terminate the container
  - Returns success confirmation

#### Command Execution Endpoint
- **Route**: `POST /api/servers/[id]/execute`
- **Purpose**: Executes commands on the running MCP server
- **Process**:
  - Parses the command to extract tool name and parameters
  - Forwards the request to the running container
  - Returns the command output to the client

### 2. UI Components

#### Server Detail Page
- Shows "Try in Playground" button only for verified servers with an image URI
- Links to the playground page with the server ID

#### Playground Page
- Fetches server details and validates image availability
- Launches a playground environment via the API
- Monitors task status until the container is ready
- Provides a command interface for interacting with the server
- Allows stopping the playground environment

## Configuration

The Playground feature relies on the following environment variables:

- `AWS_REGION`: AWS region where resources are deployed
- `PLAYGROUND_CLUSTER` or `AWS_ECS_CLUSTER`: Name of the ECS cluster for playground tasks
- `AWS_SUBNETS`: Comma-separated list of subnet IDs for the tasks
- `AWS_SECURITY_GROUP_ID`: Security group ID for the tasks

## Usage Flow

1. User navigates to a verified server's detail page
2. User clicks "Try in Playground" button
3. System fetches the server's ECR image URI from DynamoDB
4. System launches an ECS task with the image
5. UI polls the task status until it's running
6. UI displays the connection information and command interface
7. User interacts with the server by typing commands
8. User stops the playground when done

## Benefits

- **Faster startup**: Eliminates build time as images are pre-built
- **Consistency**: Same image is used for validation and playground
- **Resource efficiency**: No redundant builds for the same server
- **Version control**: Each image is tied to a specific Git SHA 