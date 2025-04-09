#!/usr/bin/env ts-node

import { 
  DynamoDBClient, 
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException 
} from "@aws-sdk/client-dynamodb";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Table name for MCP servers
const TABLE_NAME = "ToolShedServers";

// Create DynamoDB client
const ddbClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Create DynamoDB table for MCP servers
 */
async function createTable() {
  try {
    // Check if table already exists
    try {
      const describeParams = {
        TableName: TABLE_NAME
      };
      
      await ddbClient.send(new DescribeTableCommand(describeParams));
      console.log(`Table ${TABLE_NAME} already exists.`);
      return;
    } catch (error) {
      // If table doesn't exist, create it
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
    
    // Create table with serverId as hash key
    const createParams = {
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        {
          AttributeName: "ServerId",
          AttributeType: "S"
        }
      ],
      KeySchema: [
        {
          AttributeName: "ServerId",
          KeyType: "HASH"
        }
      ],
      BillingMode: "PAY_PER_REQUEST"
    };
    
    const result = await ddbClient.send(new CreateTableCommand(createParams));
    console.log(`Table ${TABLE_NAME} created successfully:`, result);
    
    // Wait for table to be active
    console.log(`Waiting for table ${TABLE_NAME} to become active...`);
    let tableActive = false;
    
    while (!tableActive) {
      // Wait 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check table status
      const describeResult = await ddbClient.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
      
      if (describeResult.Table?.TableStatus === 'ACTIVE') {
        tableActive = true;
        console.log(`Table ${TABLE_NAME} is now active and ready for use.`);
      } else {
        console.log(`Waiting for table to be active... Current status: ${describeResult.Table?.TableStatus}`);
      }
    }
  } catch (error) {
    console.error('Error creating DynamoDB table:', error);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Initializing DynamoDB table for MCP servers...');
  
  // Create table
  await createTable();
  
  console.log('DynamoDB initialization complete.');
}

// Run the script
main(); 