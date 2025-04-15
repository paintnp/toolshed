// Script to clear all servers from the DynamoDB table
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand,
  DeleteCommand
} = require("@aws-sdk/lib-dynamodb");

// Table name for MCP servers
const TABLE_NAME = "ToolShedServers";

// Create DynamoDB client
const ddbClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

// Create DynamoDB Document client
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function clearAllServers() {
  try {
    console.log('Scanning all servers from DynamoDB...');
    const scanResult = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: "ServerId"
    }));
    
    const servers = scanResult.Items || [];
    console.log(`Found ${servers.length} servers to delete.`);
    
    if (servers.length === 0) {
      console.log('No servers to delete.');
      return;
    }
    
    // Delete each server
    for (const server of servers) {
      const serverId = server.ServerId;
      console.log(`Deleting server: ${serverId}`);
      
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          ServerId: serverId
        }
      }));
      
      console.log(`Deleted server: ${serverId}`);
    }
    
    console.log('All servers deleted successfully.');
  } catch (error) {
    console.error('Error clearing servers:', error);
  }
}

// Run the function
clearAllServers(); 