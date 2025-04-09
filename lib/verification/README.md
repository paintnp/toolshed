# MCP Server Verification System

This module provides functionality to verify MCP (Model Context Protocol) server repositories by checking their functionality and cataloging their tools.

## Features

- Verify MCP servers by connecting to their HTTP endpoints
- Discover and list available tools from servers
- Run sample tools to confirm functionality
- Launch Docker containers in AWS Fargate for servers without public endpoints
- Automatically clean up resources after testing

## Verification Process

The system follows these steps to verify an MCP server:

1. **Connection Phase**
   - If a server endpoint is provided, use it directly
   - Otherwise, launch a container in AWS Fargate using a known or default Docker image
   - Test basic connectivity to the server

2. **Tools Discovery Phase**
   - Try to list available tools using common endpoints:
     - `/tools`
     - `/listTools`
     - `/v1/tools`
     - `/api/tools`
   - Extract tool metadata (name, description, schema)

3. **Tool Execution Phase**
   - Select a sample tool (typically the first one)
   - Try to execute the tool with minimal input
   - Attempt tool execution using common endpoints:
     - `/execute`
     - `/run`
     - `/v1/execute`
     - `/api/execute`
   - Capture execution results

4. **Cleanup Phase**
   - Stop any containers that were launched for testing
   - Update server metadata with verification results

## Usage

### API Route

The verification system is exposed via API routes:

```
# Verify a single server (POST with server data)
POST /api/verify

# Verify multiple servers by name
GET /api/verify?servers=owner1/repo1,owner2/repo2
```

### Command Line

You can run the verification process from the command line:

```bash
# Discover and verify up to 2 MCP servers
npx ts-node -P scripts/tsconfig.json scripts/verify-mcp-servers.ts "topic:mcp" 2

# Skip verification step (discovery only)
npx ts-node -P scripts/tsconfig.json scripts/verify-mcp-servers.ts "topic:mcp" 5 --skip-verification
```

## Server Metadata

For each verified server, the system collects the following metadata:

- `verified`: Boolean indicating if the server passed verification
- `toolCount`: Number of tools discovered
- `sampleTool`: Name of the tool that was executed
- `sampleOutput`: Sample output from tool execution (truncated)
- `sampleRunSuccess`: Boolean indicating if tool execution succeeded
- `lastTested`: Timestamp when verification was performed
- `status`: Text description of verification status

## Docker Images

The system uses a mapping of known repositories to Docker images. If no mapping exists for a repository, a default image is used. To add more mappings, update the `KNOWN_IMAGES` object in `tester.ts`:

```typescript
const KNOWN_IMAGES: Record<string, string> = {
  'github/mcp-github': 'ghcr.io/github/mcp-server',
  'openai/mcp-reference': 'ghcr.io/openai/mcp-reference',
  // Add more mappings here
  '_default_': 'ghcr.io/mcp-community/reference-server' // Fallback image
};
```

## Integration with Database

This verification system is designed to work with a database like DynamoDB. The output structure is ready for database storage, with each server represented as a document with verification fields.

Database integration will be implemented in a future update. 