#!/usr/bin/env ts-node

import { crawlMCPServers } from '../lib/github/crawler';
import { verifyServers, MCPRepository } from '../lib/verification/tester';

async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    const query = args[0];
    const maxResults = args[1] ? parseInt(args[1]) : 2; // Default to 2 for safety
    const skipVerification = args.includes('--skip-verification');
    
    console.log('Starting MCP server discovery and verification...');
    console.log(`Query: ${query || 'Default (topic:mcp)'}`);
    console.log(`Max Results: ${maxResults}`);
    console.log(`Skip Verification: ${skipVerification ? 'Yes' : 'No'}\n`);
    
    // Crawl GitHub repositories
    console.log('Step 1: Discovering MCP servers...');
    const crawlResults = await crawlMCPServers(query, maxResults);
    
    console.log(`Found ${crawlResults.found} MCP server repositories.\n`);
    
    if (crawlResults.found === 0 || skipVerification) {
      console.log('No servers to verify or verification skipped.');
      return;
    }
    
    // Verify discovered servers
    console.log('Step 2: Verifying MCP servers...');
    const verifiedServers = await verifyServers(crawlResults.repositories);
    
    // Print verification results
    console.log('\nVerification Results:');
    console.log(`Total Servers: ${verifiedServers.length}`);
    console.log(`Verified Successfully: ${verifiedServers.filter(s => s.verified).length}`);
    console.log(`Failed Verification: ${verifiedServers.filter(s => !s.verified).length}\n`);
    
    verifiedServers.forEach((server, index) => {
      console.log(`${index + 1}. ${server.fullName}`);
      console.log(`   Status: ${server.status}`);
      console.log(`   Verified: ${server.verified ? 'Yes' : 'No'}`);
      console.log(`   Tools: ${server.toolCount || 0}`);
      
      if (server.sampleTool) {
        console.log(`   Sample Tool: ${server.sampleTool}`);
        console.log(`   Tool Run Success: ${server.sampleRunSuccess ? 'Yes' : 'No'}`);
        
        if (server.sampleOutput) {
          console.log(`   Sample Output: ${server.sampleOutput}`);
        }
      }
      
      console.log('');
    });
    
    // In the future, this is where we would save to DynamoDB
    console.log('\nVerification completed.');
    console.log('Note: Data is not being saved to a database yet.');
  } catch (error) {
    console.error('Error running script:', error);
    process.exit(1);
  }
}

// Run the script
main(); 