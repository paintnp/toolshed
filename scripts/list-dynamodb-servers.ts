#!/usr/bin/env ts-node

import { listAllServers } from '../lib/db/dynamodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function main() {
  try {
    console.log('Listing servers from DynamoDB...');
    
    // Fetch all servers from DynamoDB
    const servers = await listAllServers();
    
    console.log(`Found ${servers.length} servers:\n`);
    
    // Display server information
    servers.forEach((server, index) => {
      console.log(`${index + 1}. ${server.fullName} (${server.ServerId})`);
      console.log(`   Name: ${server.name}`);
      console.log(`   Description: ${server.description || 'None'}`);
      console.log(`   Language: ${server.language || 'Unknown'}`);
      console.log(`   URL: ${server.url}`);
      console.log(`   Stars: ${server.stars || 0}, Forks: ${server.forks || 0}`);
      console.log(`   Topics: ${server.topics?.join(', ') || 'None'}`);
      console.log(`   Discovered: ${new Date(server.discoveredAt).toLocaleString()}`);
      console.log(`   Verified: ${server.verified ? 'Yes' : 'No'}`);
      
      if (server.verified) {
        console.log(`   Tool Count: ${server.toolCount || 0}`);
        console.log(`   Last Tested: ${server.lastTested ? new Date(server.lastTested).toLocaleString() : 'Never'}`);
      }
      
      if (server.status) {
        console.log(`   Status: ${server.status}`);
      }
      
      console.log('');
    });
    
  } catch (error) {
    console.error('Error listing servers from DynamoDB:', error);
    process.exit(1);
  }
}

// Run the script
main(); 