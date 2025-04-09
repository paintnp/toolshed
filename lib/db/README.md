# DynamoDB Integration

This module provides database functionality for storing and retrieving MCP server metadata using Amazon DynamoDB.

## Features

- Store and retrieve MCP server metadata
- Search servers by name, description, or other criteria
- Track verification status and tool information
- Consistent data structure for all application components

## Database Schema

### ToolShedServers Table

**Primary Key**: `ServerId` (String) - Unique identifier for each server, typically the GitHub repository full name (e.g., "owner/repo")

**Attributes**:
- `name` (String) - Server name (usually the repository name)
- `fullName` (String) - Full repository name in "owner/repo" format
- `description` (String) - Server description
- `language` (String) - Primary programming language
- `url` (String) - URL to the repository
- `stars` (Number) - Number of GitHub stars
- `forks` (Number) - Number of GitHub forks
- `topics` (List) - List of repository topics
- `discoveredAt` (Number) - Timestamp when the server was first discovered
- `lastUpdated` (Number) - Timestamp when the server was last updated
- `verified` (Boolean) - Whether the server has been verified
- `toolCount` (Number) - Number of tools available
- `tools` (List) - List of tool definitions
- `lastTested` (Number) - Timestamp when the server was last tested
- `status` (String) - Status message from verification
- `endpoint` (String) - Server endpoint URL if known

## Usage

### Initialization

Before using the database, you need to create the DynamoDB table:

```bash
# Create the DynamoDB table
npx ts-node -P scripts/tsconfig.json scripts/init-dynamodb.ts
```

### Basic Operations

```typescript
import { 
  saveServer, 
  getServer, 
  listAllServers, 
  queryServersByName,
  updateServerVerification
} from '@/lib/db/dynamodb';

// Save a server
const server = {
  ServerId: 'owner/repo',
  name: 'repo',
  fullName: 'owner/repo',
  description: 'A server description',
  language: 'TypeScript',
  url: 'https://github.com/owner/repo',
  discoveredAt: Date.now(),
  verified: false
};
await saveServer(server);

// Get a server by ID
const server = await getServer('owner/repo');

// List all servers
const servers = await listAllServers();

// Search servers by name
const searchResults = await queryServersByName('example');

// Update verification status
await updateServerVerification(
  'owner/repo',
  true,
  {
    toolCount: 5,
    status: 'OK',
    lastTested: Date.now()
  }
);
```

## Environment Variables

The DynamoDB integration uses these environment variables:

- `AWS_REGION` - AWS region for DynamoDB (default: 'us-east-1')
- `AWS_ACCESS_KEY_ID` - AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key

These can be set in your `.env.local` file.

## Integration with Other Components

The DynamoDB integration is used by:

1. **GitHub Crawler** - Stores discovered servers
2. **Verification System** - Updates server status and tool information
3. **API Routes** - Retrieves server data for the frontend

This provides a consistent data store across all application components. 