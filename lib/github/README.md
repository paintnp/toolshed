# GitHub MCP Server Crawler

This module provides functionality to discover and catalog MCP (Model Context Protocol) server repositories on GitHub.

## Features

- Search for repositories by topic, name, or description
- Extract metadata for each repository
- Basic filtering to identify likely MCP server repositories
- Structured output ready for database storage
- Pagination handling for large result sets
- Duplicate detection to prevent re-processing the same repository

## Usage

### Environment Setup

1. Create a GitHub Personal Access Token with `public_repo` scope
2. Add it to your `.env.local` file:

```
GITHUB_TOKEN=your_github_personal_access_token
```

### API Route

The crawler is exposed via an API route at `/api/crawl`:

```
GET /api/crawl?query=topic:mcp&maxResults=20
```

Parameters:
- `query` (optional): GitHub search query string (default: combines several MCP-related queries)
- `maxResults` (optional): Maximum number of results to return (default: 100)

Response:
```json
{
  "found": 5,
  "repositories": [
    {
      "id": "owner/repo",
      "name": "repo",
      "fullName": "owner/repo",
      "description": "An MCP server for XYZ",
      "language": "TypeScript",
      "url": "https://github.com/owner/repo",
      "stars": 42,
      "forks": 5,
      "topics": ["mcp", "server", "api"],
      "lastUpdated": "2025-04-09T12:20:48Z",
      "discoveredAt": 1744202013012,
      "verified": false
    },
    ...
  ]
}
```

### Command Line

You can also run the crawler directly using the provided script:

```bash
npx ts-node -P scripts/tsconfig.json scripts/crawl-mcp-servers.ts "topic:mcp" 10
```

Arguments:
1. Search query (optional)
2. Maximum results (optional)

## Integration with Database

This crawler is designed to work with a database like DynamoDB. The output structure is ready for database storage, with each repository represented as a document with the following fields:

- `id`: Unique identifier (using repository full name)
- `name`: Repository name
- `fullName`: Repository full name (owner/repo)
- `description`: Repository description
- `language`: Primary programming language
- `url`: Repository URL
- `stars`: Number of stars
- `forks`: Number of forks
- `topics`: Array of repository topics
- `lastUpdated`: Timestamp of last update
- `discoveredAt`: Timestamp when the repository was discovered
- `verified`: Boolean flag indicating if the repository has been verified

The database integration will be implemented in a future update. 