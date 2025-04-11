
# GitHub Token Setup Instructions for MCP Server Access

To deploy the official GitHub MCP server, you need a GitHub token with the right permissions.
The following steps will guide you through creating a new token with the necessary permissions.

## Current Token Status

Current token starts with: github_p...
This token appears to lack the necessary permissions for accessing the GitHub MCP server.

## Step 1: Create a new GitHub Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" > "Generate new token (classic)"
3. Add a note like "ToolShed MCP Server Access"
4. Select the following scopes:
   - `read:packages` to download packages from GitHub Package Registry
   - `repo` for full repository access (if this is a private repository)
   - `workflow` if the repository requires workflow permissions
5. Click "Generate token" and copy the generated token

## Step 2: Update your .env.local file

Replace your current GitHub token with the new one in your .env.local file:
```
GITHUB_TOKEN=your_new_token_here
```

## Step 3: Request access to the private repository

If you don't have access to the `github/mcp-server` repository:
1. Contact GitHub support or your organization administrator
2. Request access to the `github/mcp-server` container registry repository
3. Provide your GitHub username and details about why you need access

## Step 4: Test with the new token

After updating your token, run:
```
npx ts-node -P scripts/tsconfig.json scripts/test-ghcr-auth.ts
```

## Step 5: Deploy the MCP server

Once your token has the right permissions:
```
npx ts-node -P scripts/tsconfig.json scripts/deploy-github-mcp.ts
```
