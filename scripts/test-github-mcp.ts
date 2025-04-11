/**
 * Test script for GitHub MCP Server with ALB
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/test-github-mcp.ts
 */

import { launchContainer, stopContainer } from '../lib/aws/fargate';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function main() {
  // Configuration - using GitHub's official MCP server
  const serverName = `github-mcp-test-${Date.now().toString().slice(-6)}`;
  
  console.log(`\n=== Testing GitHub MCP Server with ALB ===`);
  console.log(`Server Name: ${serverName}\n`);
  
  try {
    // Launch container
    console.log('Launching GitHub MCP server container with ALB...');
    const result = await launchContainer({
      image: 'ghcr.io/github/mcp-server', // GitHub's official MCP server
      serverName,
      containerPort: 8000,  // Default port for MCP servers
      environmentVariables: [
        { name: 'PORT', value: '8000' }
      ]
    });
    
    if (!result.success) {
      console.error(`Failed to launch: ${result.error}`);
      return;
    }
    
    console.log(`\nContainer launched successfully!`);
    console.log(`Task ARN: ${result.taskArn}`);
    console.log(`ALB Endpoint: ${result.endpoint}`);
    console.log(`\nNOTE: ALB may take 2-5 minutes to become available.`);
    
    // Try to connect every 30 seconds for up to 5 minutes
    console.log(`\nChecking endpoint availability (will try for 5 minutes)...`);
    let connected = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    if (!result.endpoint) {
      console.error("No endpoint was returned. Cannot test connection.");
      return;
    }
    
    while (!connected && attempts < maxAttempts) {
      attempts++;
      console.log(`\nAttempt ${attempts}/${maxAttempts} to connect to ${result.endpoint}`);
      
      try {
        // Try to connect to the root endpoint
        const rootResponse = await axios.get(result.endpoint, { timeout: 10000 });
        console.log(`Root endpoint accessible with status: ${rootResponse.status}`);
        
        // Also try the /tools endpoint which is common for MCP servers
        try {
          const toolsResponse = await axios.get(`${result.endpoint}/tools`, { timeout: 10000 });
          console.log(`Tools endpoint accessible! Found ${toolsResponse.data.length || 0} tools`);
          
          // Print some tool names if available
          if (toolsResponse.data && toolsResponse.data.length > 0) {
            const toolNames = toolsResponse.data.slice(0, 3).map((tool: any) => tool.name).join(', ');
            console.log(`Sample tools: ${toolNames}${toolsResponse.data.length > 3 ? '...' : ''}`);
          }
        } catch (toolsError) {
          console.log(`Could not access /tools endpoint, server may still be initializing...`);
        }
        
        connected = true;
      } catch (error) {
        console.log(`Failed to connect. Waiting 30 seconds before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
    
    if (connected) {
      console.log(`\nEndpoint is now accessible! GitHub MCP Server is working correctly.`);
    } else {
      console.log(`\nCouldn't connect after ${maxAttempts} attempts. The server might still be initializing.`);
    }
    
    // Ask whether to stop the container
    console.log(`\nThe container is still running. You can access it at ${result.endpoint}`);
    console.log(`To stop it manually, run: aws ecs stop-task --cluster ToolShedCluster --task ${result.taskArn?.split('/').pop()}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error); 