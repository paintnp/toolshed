#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { 
  saveServer, 
  getServer, 
  listAllServers, 
  deleteServer, 
  ServerRecord 
} from '../lib/db/dynamodb';

// Load environment variables
dotenv.config({ path: '.env.local' });

/**
 * Test DynamoDB operations
 */
async function testDynamoDB() {
  try {
    console.log('Testing DynamoDB operations...');
    
    // Create a test server record
    const testServer: ServerRecord = {
      ServerId: 'test/mcp-server',
      name: 'Test MCP Server',
      fullName: 'test/mcp-server',
      description: 'A test MCP server for validation',
      language: 'TypeScript',
      url: 'https://github.com/test/mcp-server',
      discoveredAt: Date.now(),
      verified: false,
      tools: [
        {
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      toolCount: 1
    };
    
    // 1. Test saveServer
    console.log('1. Testing saveServer...');
    const savedServer = await saveServer(testServer);
    console.log('Server saved successfully:', savedServer.ServerId);
    
    // 2. Test getServer
    console.log('\n2. Testing getServer...');
    const retrievedServer = await getServer(testServer.ServerId);
    console.log('Server retrieved:', retrievedServer?.name);
    
    // 3. Test listAllServers
    console.log('\n3. Testing listAllServers...');
    const allServers = await listAllServers();
    console.log(`Retrieved ${allServers.length} servers:`);
    allServers.forEach(server => {
      console.log(`- ${server.name} (${server.ServerId})`);
    });
    
    // 4. Test update through saveServer
    console.log('\n4. Testing server update...');
    const updatedServer: ServerRecord = {
      ...testServer,
      verified: true,
      status: 'Verified successfully',
      lastTested: Date.now()
    };
    
    await saveServer(updatedServer);
    const retrievedUpdatedServer = await getServer(testServer.ServerId);
    console.log('Updated server verification status:', retrievedUpdatedServer?.verified);
    console.log('Updated server status:', retrievedUpdatedServer?.status);
    
    // 5. Test deleteServer
    console.log('\n5. Testing deleteServer...');
    await deleteServer(testServer.ServerId);
    const deletedServer = await getServer(testServer.ServerId);
    console.log('Server deleted:', deletedServer === null ? 'Yes' : 'No');
    
    console.log('\nAll DynamoDB operations completed successfully!');
  } catch (error) {
    console.error('Error testing DynamoDB:', error);
    process.exit(1);
  }
}

// Run the test
testDynamoDB(); 