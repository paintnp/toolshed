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
import { getDatabaseConfig } from "../aws/config";

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

// Table name is loaded dynamically from config
let SERVERS_TABLE_NAME: string | null = null;

/**
 * Get the table name, fetching from config if not already loaded
 */
async function getTableName(): Promise<string> {
  if (!SERVERS_TABLE_NAME) {
    const config = await getDatabaseConfig();
    SERVERS_TABLE_NAME = config.tableName;
  }
  return SERVERS_TABLE_NAME;
}

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
    const tableName = await getTableName();
    console.log(`Checking if table ${tableName} exists`);
    // Try to describe the table
    const command = new DescribeTableCommand({ TableName: tableName });
    await ddbClient.send(command);
    console.log(`Table ${tableName} exists`);
    return true;
  } catch (error) {
    console.error(`Error checking if table ${await getTableName()} exists:`, error);
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
  taskArn?: string;      // Task ARN for running playground
}

/**
 * Save or update a server record in DynamoDB
 * 
 * @param {ServerRecord} server - Server record to save
 * @returns {Promise<ServerRecord>} Saved server record
 */
export async function saveServer(server: ServerRecord): Promise<ServerRecord> {
  // Ensure required fields are present
  if (!server.ServerId) {
    throw new Error('ServerId is required');
  }

  // Get the existing server if it exists to compare and merge fields
  let existingServer: ServerRecord | null = null;
  try {
    existingServer = await getServer(server.ServerId);
  } catch (error) {
    // No existing server, will create new one
    console.log(`Creating new server record for ${server.ServerId}`);
  }

  // Set last updated timestamp
  server.lastUpdated = Date.now();

  // If we have an imageUri but no imageTag, extract the tag from the URI
  if (server.imageUri && !server.imageTag && typeof server.imageUri === 'string') {
    const tagMatch = server.imageUri.match(/:([^:]+)$/);
    if (tagMatch && tagMatch[1]) {
      server.imageTag = tagMatch[1];
      console.log(`Extracted image tag ${server.imageTag} from imageUri`);
    }
  }

  try {
    const tableName = await getTableName();
    
    // Use the Document Client's native marshalling instead of manual marshalling
    // This will handle the correct formatting of the ServerId as a string
    const params = {
      TableName: tableName,
      Item: server  // Document Client will handle conversion automatically
    };
    
    await docClient.send(new PutCommand(params));
    
    console.log(`Saved server record for ${server.ServerId}`);
    return server;
  } catch (error) {
    console.error('Error saving server record:', error);
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
    const tableName = await getTableName();
    
    const response = await docClient.send(new GetCommand({
      TableName: tableName,
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
    const tableName = await getTableName();
    
    // Use a scan with a filter expression
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
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
    const tableName = await getTableName();
    
    const response = await docClient.send(new ScanCommand({
      TableName: tableName
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
    const tableName = await getTableName();
    
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
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
    const tableName = await getTableName();
    
    await docClient.send(new DeleteCommand({
      TableName: tableName,
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