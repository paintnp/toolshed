/**
 * Instructions for creating a GitHub token with the right permissions
 * for accessing the GitHub MCP Server container
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/github-token-instructions.ts
 */

import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const githubToken = process.env.GITHUB_TOKEN || '';

function displayInstructions() {
  console.log(chalk.bold.green('\n=== GitHub Token Setup Instructions ===\n'));

  console.log('To deploy the official GitHub MCP server, you need a GitHub token with the right permissions.');
  console.log('The following steps will guide you through creating a new token or checking your existing token.\n');

  if (githubToken) {
    console.log(chalk.yellow('Current token:') + ' ' + `${githubToken.substring(0, 8)}...`);
    console.log('This token appears to lack the necessary permissions for accessing the GitHub MCP server.\n');
  }

  console.log(chalk.bold('Step 1: Create a new GitHub Personal Access Token (PAT)\n'));
  console.log('1. Go to https://github.com/settings/tokens');
  console.log('2. Click "Generate new token" > "Generate new token (classic)"');
  console.log('3. Add a note like "ToolShed MCP Server Access"');
  console.log('4. Select the following scopes:');
  console.log('   - `read:packages` to download packages from GitHub Package Registry');
  console.log('   - `repo` for full repository access (if this is a private repository)');
  console.log('   - `workflow` if the repository requires workflow permissions');
  console.log('5. Click "Generate token" and copy the generated token\n');

  console.log(chalk.bold('Step 2: Update your .env.local file\n'));
  console.log('Replace your current GitHub token with the new one in your .env.local file:');
  console.log('GITHUB_TOKEN=your_new_token_here\n');

  console.log(chalk.bold('Step 3: Request access to the private repository\n'));
  console.log('If you don\'t have access to the `github/mcp-server` repository:');
  console.log('1. Contact GitHub support or your organization administrator');
  console.log('2. Request access to the `github/mcp-server` container registry repository');
  console.log('3. Provide your GitHub username and details about why you need access\n');

  console.log(chalk.bold('Step 4: Test with the new token\n'));
  console.log('After updating your token, run:');
  console.log('npx ts-node -P scripts/tsconfig.json scripts/test-ghcr-auth.ts\n');

  console.log(chalk.bold('Step 5: Deploy the MCP server\n'));
  console.log('Once your token has the right permissions:');
  console.log('npx ts-node -P scripts/tsconfig.json scripts/deploy-github-mcp.ts\n');

  console.log(chalk.bold.green('=== End of Instructions ===\n'));
}

// Save instructions to a file for reference
function saveInstructionsToFile() {
  const instructions = `
# GitHub Token Setup Instructions for MCP Server Access

To deploy the official GitHub MCP server, you need a GitHub token with the right permissions.
The following steps will guide you through creating a new token with the necessary permissions.

## Current Token Status

${githubToken ? `Current token starts with: ${githubToken.substring(0, 8)}...
This token appears to lack the necessary permissions for accessing the GitHub MCP server.` : 'No GitHub token found in .env.local'}

## Step 1: Create a new GitHub Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" > "Generate new token (classic)"
3. Add a note like "ToolShed MCP Server Access"
4. Select the following scopes:
   - \`read:packages\` to download packages from GitHub Package Registry
   - \`repo\` for full repository access (if this is a private repository)
   - \`workflow\` if the repository requires workflow permissions
5. Click "Generate token" and copy the generated token

## Step 2: Update your .env.local file

Replace your current GitHub token with the new one in your .env.local file:
\`\`\`
GITHUB_TOKEN=your_new_token_here
\`\`\`

## Step 3: Request access to the private repository

If you don't have access to the \`github/mcp-server\` repository:
1. Contact GitHub support or your organization administrator
2. Request access to the \`github/mcp-server\` container registry repository
3. Provide your GitHub username and details about why you need access

## Step 4: Test with the new token

After updating your token, run:
\`\`\`
npx ts-node -P scripts/tsconfig.json scripts/test-ghcr-auth.ts
\`\`\`

## Step 5: Deploy the MCP server

Once your token has the right permissions:
\`\`\`
npx ts-node -P scripts/tsconfig.json scripts/deploy-github-mcp.ts
\`\`\`
`;

  fs.writeFileSync('github-token-instructions.md', instructions, 'utf8');
  console.log('Instructions saved to github-token-instructions.md for later reference.');
}

// Main function
function main() {
  displayInstructions();
  saveInstructionsToFile();
}

main(); 