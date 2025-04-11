/**
 * Test script to verify GitHub Container Registry authentication
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/test-ghcr-auth.ts
 */

import dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken) {
  console.error('Error: GITHUB_TOKEN not found in .env.local');
  process.exit(1);
}

console.log(`Testing GitHub Container Registry authentication...`);
console.log(`Token: ${githubToken.slice(0, 10)}... (truncated for security)`);

try {
  // Create a temporary file to store the token
  const tmpTokenFile = path.join(os.tmpdir(), `github-token-${Date.now()}.txt`);
  fs.writeFileSync(tmpTokenFile, githubToken, 'utf8');
  
  console.log('\nAttempting to check access to GitHub Container Registry...');
  
  try {
    // Login to GitHub Container Registry
    const loginOutput = execSync(
      `cat ${tmpTokenFile} | docker login ghcr.io -u x-access-token --password-stdin`, 
      { stdio: 'pipe' }
    ).toString();
    
    console.log('Login successful!');
    
    // Check if we can access ghcr.io/github/mcp-server image
    console.log('\nChecking if we can access the mcp-server image...');
    
    try {
      // Try to inspect the image without pulling it
      execSync('docker manifest inspect ghcr.io/github/mcp-server:latest', { stdio: 'pipe' });
      console.log('Success! We can access the GitHub MCP server image.');
    } catch (error: any) {
      console.log('Could not access the image. This might be due to permission issues or the image not existing.');
      console.log('Error:', error.message);
    }
    
    // Now try to check repository access via GitHub API
    console.log('\nChecking GitHub repository access...');
    const repoCheckOutput = execSync(
      `curl -s -H "Authorization: token ${githubToken}" https://api.github.com/repos/github/mcp-server`,
      { encoding: 'utf8' }
    );
    
    try {
      const repoData = JSON.parse(repoCheckOutput);
      if (repoData.id) {
        console.log('Success! We have access to the GitHub repository.');
      } else if (repoData.message === 'Not Found') {
        console.log('The repository is not found or not accessible with your token.');
      } else {
        console.log('Unexpected response:', repoData.message);
      }
    } catch (error: any) {
      console.log('Error parsing repository data:', error.message);
    }
    
  } catch (loginError: any) {
    console.error('Failed to login to GitHub Container Registry:', loginError.message);
  }
  
  // Clean up
  fs.unlinkSync(tmpTokenFile);
  console.log('\nCleaned up temporary token file.');
  
  console.log('\nAuthentication test complete.');
} catch (error: any) {
  console.error('Error during authentication test:', error.message);
  process.exit(1);
} 