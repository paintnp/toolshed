/**
 * Script to check GitHub token scopes and permissions
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/check-github-token-scopes.ts
 */

import dotenv from 'dotenv';
import { execSync } from 'child_process';
import chalk from 'chalk';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken) {
  console.error(chalk.red('Error: GITHUB_TOKEN not found in .env.local'));
  process.exit(1);
}

console.log(chalk.bold.green('\n=== GitHub Token Inspection ===\n'));
console.log(`Token (first 8 chars): ${chalk.yellow(githubToken.substring(0, 8))}...\n`);

// Initialize scope variables
let hasReadPackages = false;
let hasRepo = false;

try {
  // Check token scopes
  console.log(chalk.bold('Checking token scopes...\n'));
  
  const response = execSync(
    `curl -s -I -H "Authorization: token ${githubToken}" https://api.github.com/user`,
    { encoding: 'utf8' }
  );
  
  // Extract the X-OAuth-Scopes header
  const scopesMatch = response.match(/x-oauth-scopes:\s*(.*)/i);
  if (scopesMatch && scopesMatch[1]) {
    const scopes = scopesMatch[1].trim();
    console.log(`Scopes: ${chalk.yellow(scopes)}`);
    
    // Check for required scopes
    hasReadPackages = scopes.includes('read:packages');
    hasRepo = scopes.includes('repo');
    
    console.log('\nEvaluation:');
    console.log(`- read:packages scope: ${hasReadPackages ? chalk.green('✓ Present') : chalk.red('✗ Missing')}`);
    console.log(`- repo scope: ${hasRepo ? chalk.green('✓ Present') : chalk.red('✗ Missing or partial')}`);
    
    if (!hasReadPackages) {
      console.log(chalk.red('\nYour token is missing the read:packages scope, which is required to access the GitHub Container Registry.'));
    }
    
    if (!hasRepo) {
      console.log(chalk.red('\nYour token is missing the repo scope, which may be required if mcp-server is in a private repository.'));
    }
  } else {
    console.log(chalk.red('Could not determine token scopes. This might indicate an invalid token.'));
  }
  
  // Check user information
  console.log(chalk.bold('\nChecking user information...\n'));
  
  const userInfo = execSync(
    `curl -s -H "Authorization: token ${githubToken}" https://api.github.com/user`,
    { encoding: 'utf8' }
  );
  
  const userData = JSON.parse(userInfo);
  if (userData.login) {
    console.log(`Username: ${chalk.yellow(userData.login)}`);
    console.log(`Name: ${chalk.yellow(userData.name || 'Not set')}`);
    console.log(`Token belongs to a valid GitHub account.`);
  } else if (userData.message) {
    console.log(chalk.red(`Error: ${userData.message}`));
  }
  
  // Test access to GitHub Container Registry
  console.log(chalk.bold('\nTesting GitHub Container Registry access...\n'));
  
  try {
    execSync(`curl -s -H "Authorization: Bearer ${githubToken}" https://ghcr.io/v2/github/mcp-server/manifests/latest`, 
      { stdio: 'pipe' }
    );
    
    console.log(chalk.green('✓ Successfully accessed GitHub Container Registry with this token.'));
  } catch (error: any) {
    console.log(chalk.red('✗ Failed to access GitHub Container Registry with this token.'));
    console.log(`Error details: ${error.message}`);
  }
  
  // Conclusion
  console.log(chalk.bold.green('\n=== Conclusion ===\n'));
  
  if (!hasReadPackages || !hasRepo) {
    console.log(chalk.yellow('Your token appears to be missing some required scopes.'));
    console.log('Please follow the instructions to create a new token with the proper scopes:');
    console.log('npx ts-node -P scripts/tsconfig.json scripts/github-token-instructions.ts');
  } else {
    console.log(chalk.green('Your token has the required scopes, but you still need access to the private repository.'));
    console.log('Contact GitHub support or your organization administrator to request access to the github/mcp-server repository.');
  }
  
  console.log(chalk.bold.green('\n=== End of Token Inspection ===\n'));
  
} catch (error: any) {
  console.error(chalk.red('Error during token inspection:'), error.message);
  process.exit(1);
} 