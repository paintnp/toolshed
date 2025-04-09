#!/usr/bin/env ts-node

import { crawlMCPServers, logCrawlerResults } from '../lib/github/crawler';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    const query = args[0];
    const maxResults = args[1] ? parseInt(args[1]) : undefined;
    
    console.log('Starting MCP server crawler...');
    console.log(`Query: ${query || 'Default (topic:mcp)'}`);
    console.log(`Max Results: ${maxResults || 'Default (100)'}\n`);
    
    // Crawl GitHub repositories and save to DynamoDB
    const saveToDb = true; // Enable saving to DynamoDB
    const results = await crawlMCPServers(query, maxResults, saveToDb);
    
    // Log results
    logCrawlerResults(results);
    
    console.log('\nCrawling completed.');
    console.log(`Discovered ${results.found} MCP servers and saved them to DynamoDB.`);
  } catch (error) {
    console.error('Error running crawler:', error);
    process.exit(1);
  }
}

// Run the crawler
main(); 