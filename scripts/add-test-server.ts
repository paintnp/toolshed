#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { saveServer, ServerRecord } from '../lib/db/dynamodb';

// Load environment variables
dotenv.config({ path: '.env.local' });

/**
 * Add test server to DynamoDB
 */
async function addTestServer() {
  try {
    // Create a test server record
    const testServer: ServerRecord = {
      ServerId: 'example/test-mcp-server',
      name: 'Test MCP Server',
      fullName: 'example/test-mcp-server',
      description: 'A sample MCP server for testing the API',
      language: 'TypeScript',
      url: 'https://github.com/example/test-mcp-server',
      discoveredAt: Date.now(),
      verified: true,
      stars: 42,
      forks: 12,
      topics: ['mcp', 'ai', 'tools'],
      tools: [
        {
          name: 'search',
          description: 'Search the web for information'
        },
        {
          name: 'code-analysis',
          description: 'Analyze code for bugs and style issues'
        }
      ],
      toolCount: 2,
      lastTested: Date.now(),
      status: 'Active',
      endpoint: 'https://mcp-server.example.com'
    };
    
    // Save the server
    await saveServer(testServer);
    console.log('Test server added successfully:', testServer.ServerId);
  } catch (error) {
    console.error('Error adding test server:', error);
    process.exit(1);
  }
}

// Run the script
addTestServer(); 