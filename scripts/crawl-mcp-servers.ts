#!/usr/bin/env ts-node

import { crawlMCPServers, logCrawlerResults } from '../lib/github/crawler';

async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    const query = args[0];
    const maxResults = args[1] ? parseInt(args[1]) : undefined;
    
    console.log('Starting MCP server crawler...');
    console.log(`Query: ${query || 'Default (topic:mcp)'}`);
    console.log(`Max Results: ${maxResults || 'Default (100)'}\n`);
    
    // Crawl GitHub repositories
    const results = await crawlMCPServers(query, maxResults);
    
    // Log results
    logCrawlerResults(results);
    
    // In the future, this is where we would save to DynamoDB
    console.log('\nCrawling completed.');
    console.log('Note: Data is not being saved to a database yet.');
  } catch (error) {
    console.error('Error running crawler:', error);
    process.exit(1);
  }
}

// Run the crawler
main(); 