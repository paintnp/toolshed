import { NextApiRequest, NextApiResponse } from 'next';
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";

// Create DynamoDB client
const ddbClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

// Table name for MCP servers
const TABLE_NAME = "ToolShedServers";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check if table exists
    console.log(`Checking if table ${TABLE_NAME} exists`);
    const command = new DescribeTableCommand({ TableName: TABLE_NAME });
    await ddbClient.send(command);
    console.log(`Table ${TABLE_NAME} exists`);
    
    return res.status(200).json({ success: true, message: "Table exists" });
  } catch (error) {
    console.error(`Error checking if table ${TABLE_NAME} exists:`, error);
    return res.status(500).json({ success: false, error: String(error) });
  }
} 