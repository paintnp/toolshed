import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

// Table name for MCP servers
const TABLE_NAME = "ToolShedServers";

// Create DynamoDB client
const ddbClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

// Create DynamoDB Document client (for easier JSON handling)
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    // Convert empty strings, arrays, and objects to null
    convertEmptyValues: true,
    // Remove undefined values
    removeUndefinedValues: true,
  }
});

/**
 * Check if AWS credentials are properly configured
 */
export async function checkAwsCredentials(): Promise<boolean> {
  try {
    // Try to make a simple DynamoDB operation to verify credentials
    await ddbClient.config.credentials();
    return true;
  } catch (error) {
    console.error('Error checking AWS credentials:', error);
    return false;
  }
}

/**
 * Check if DynamoDB table exists
 */
export async function tableExists(): Promise<boolean> {
  try {
    console.log(`Checking if table ${TABLE_NAME} exists`);
    // Try to describe the table
    const command = new DescribeTableCommand({ TableName: TABLE_NAME });
    await ddbClient.send(command);
    console.log(`Table ${TABLE_NAME} exists`);
    return true;
  } catch (error) {
    console.error(`Error checking if table ${TABLE_NAME} exists:`, error);
    return false;
  }
}

// Server record interface
export interface ServerRecord {
  ServerId: string;      // Primary key: owner/repo or a slug
  name: string;          // Short name (repo name)
  fullName: string;      // Full name in "owner/repo" format
  description?: string;  // Server description
  language?: string;     // Primary language
  url: string;           // Link to repo
  stars?: number;        // Stars count
  forks?: number;        // Forks count
  topics?: string[];     // Repository topics
  discoveredAt: number;  // Timestamp of discovery
  verified: boolean;     // Verification status
  toolCount?: number;    // Number of tools
  tools?: Array<{        // List of tools
    name: string;
    description: string;
    inputSchema?: any;
  }>;
  lastTested?: number;   // Last test timestamp
  status?: string;       // Status message
  endpoint?: string;     // Server endpoint if known
  lastUpdated?: number;  // Last update timestamp
  imageUri?: string;     // ECR image URI for the verified server
  imageTag?: string;     // Docker image tag
  lastVerifiedSha?: string; // Git commit SHA of the last verification
}

/**
 * Save or update a server record in DynamoDB
 * 
 * @param {ServerRecord} server - Server record to save
 * @returns {Promise<ServerRecord>} Saved server record
 */
export async function saveServer(server: ServerRecord): Promise<ServerRecord> {
  try {
    // Set lastUpdated timestamp
    const updatedServer = {
      ...server,
      lastUpdated: Date.now()
    };
    
    // Put item in DynamoDB
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedServer
    }));
    
    return updatedServer;
  } catch (error) {
    console.error('Error saving server to DynamoDB:', error);
    throw error;
  }
}

/**
 * Get a server record by ID
 * 
 * @param {string} serverId - Server ID
 * @returns {Promise<ServerRecord | null>} Server record or null if not found
 */
export async function getServer(serverId: string): Promise<ServerRecord | null> {
  try {
    const response = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        ServerId: serverId
      }
    }));
    
    return response.Item as ServerRecord || null;
  } catch (error) {
    console.error(`Error getting server ${serverId} from DynamoDB:`, error);
    throw error;
  }
}

/**
 * Get server by full name (owner/repo)
 * 
 * @param {string} fullName - Full name in "owner/repo" format
 * @returns {Promise<ServerRecord | null>} Server record or null if not found
 */
export async function getServerByFullName(fullName: string): Promise<ServerRecord | null> {
  try {
    // Use a scan with a filter expression
    const response = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "fullName = :fullName",
      ExpressionAttributeValues: {
        ":fullName": fullName
      },
      Limit: 1
    }));
    
    if (response.Items && response.Items.length > 0) {
      return response.Items[0] as ServerRecord;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting server by full name ${fullName} from DynamoDB:`, error);
    throw error;
  }
}

/**
 * List all servers
 * 
 * @returns {Promise<ServerRecord[]>} Array of server records
 */
export async function listAllServers(): Promise<ServerRecord[]> {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));
    
    return (response.Items || []) as ServerRecord[];
  } catch (error) {
    console.error('Error listing servers from DynamoDB:', error);
    throw error;
  }
}

/**
 * Query servers by name or description
 * 
 * @param {string} query - Search query
 * @returns {Promise<ServerRecord[]>} Array of matching server records
 */
export async function queryServersByName(query: string): Promise<ServerRecord[]> {
  try {
    // Lowercase query for case-insensitive matching
    const searchQuery = query.toLowerCase();
    
    // Get all servers (since we don't have a GSI, we need to scan)
    const servers = await listAllServers();
    
    // Filter locally
    return servers.filter(server => 
      (server.name && server.name.toLowerCase().includes(searchQuery)) ||
      (server.description && server.description.toLowerCase().includes(searchQuery)) ||
      (server.fullName && server.fullName.toLowerCase().includes(searchQuery))
    );
  } catch (error) {
    console.error(`Error querying servers by name ${query} from DynamoDB:`, error);
    throw error;
  }
}

/**
 * List verified servers
 * 
 * @returns {Promise<ServerRecord[]>} Array of verified server records
 */
export async function listVerifiedServers(): Promise<ServerRecord[]> {
  try {
    const response = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "verified = :verified",
      ExpressionAttributeValues: {
        ":verified": true
      }
    }));
    
    return (response.Items || []) as ServerRecord[];
  } catch (error) {
    console.error('Error listing verified servers from DynamoDB:', error);
    throw error;
  }
}

/**
 * Update server verification status
 * 
 * @param {string} serverId - Server ID
 * @param {boolean} verified - Verification status
 * @param {object} verificationData - Additional verification data
 * @returns {Promise<ServerRecord | null>} Updated server record or null if not found
 */
export async function updateServerVerification(
  serverId: string,
  verified: boolean,
  verificationData: {
    toolCount?: number;
    tools?: any[];
    status?: string;
    lastTested?: number;
    endpoint?: string;
    sampleTool?: string;
    sampleOutput?: string;
    sampleRunSuccess?: boolean;
  }
): Promise<ServerRecord | null> {
  try {
    // Get current server
    const server = await getServer(serverId);
    if (!server) {
      return null;
    }
    
    // Update verification fields
    const updatedServer: ServerRecord = {
      ...server,
      verified,
      ...verificationData,
      lastUpdated: Date.now()
    };
    
    // Save updated server
    return await saveServer(updatedServer);
  } catch (error) {
    console.error(`Error updating server verification ${serverId} in DynamoDB:`, error);
    throw error;
  }
}

/**
 * Delete a server record
 * 
 * @param {string} serverId - Server ID
 * @returns {Promise<boolean>} True if deleted successfully
 */
export async function deleteServer(serverId: string): Promise<boolean> {
  try {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        ServerId: serverId
      }
    }));
    
    return true;
  } catch (error) {
    console.error(`Error deleting server ${serverId} from DynamoDB:`, error);
    throw error;
  }
} 