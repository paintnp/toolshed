import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';

// DynamoDB client setup
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'ToolShedServers';

// Interface for MCP tool
interface MCPTool {
  name: string;
  description: string;
  inputSchema?: any;
}

/**
 * Validates an MCP server endpoint and updates DynamoDB with results
 */
export const handler = async (event: any): Promise<any> => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    // Extract information from the event
    const { serverId, endpoint, taskArn, imageDetails } = event;
    
    if (!serverId) {
      throw new Error('Missing required parameter: serverId must be provided');
    }
    
    console.log(`Validating MCP server ${serverId} at endpoint ${endpoint || 'unknown'}`);
    
    // Extract image URI information if available
    const imageUri = imageDetails?.imageUri;
    const imageTag = imageDetails?.imageTag;
    const lastVerifiedSha = imageDetails?.lastVerifiedSha;
    
    console.log(`Image URI: ${imageUri || 'Not provided'}`);
    console.log(`Image Tag: ${imageTag || 'Not provided'}`);
    console.log(`Last Verified SHA: ${lastVerifiedSha || 'Not provided'}`);
    
    // If no endpoint is provided, this might be just a metadata update
    // In this case, we can still update the server record with the image information
    if (!endpoint) {
      console.log('No endpoint provided, updating metadata only');
      
      // Prepare metadata for DynamoDB update
      const metadataUpdate = {
        status: 'Image metadata updated',
        lastTested: Date.now(),
        taskArn,
        ...(imageUri && { imageUri }),
        ...(imageTag && { imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      };
      
      // Update DynamoDB with metadata
      await updateServerVerification(serverId, true, metadataUpdate);
      
      return {
        verified: true,
        message: 'Image metadata updated successfully',
        serverId,
        imageUri,
        imageTag,
        lastVerifiedSha
      };
    }
    
    // Test server connection
    const isConnected = await testServerConnection(endpoint);
    if (!isConnected) {
      await updateServerVerification(serverId, false, {
        status: 'Connection failed',
        lastTested: Date.now(),
        taskArn,
        ...(imageUri && { imageUri }),
        ...(imageTag && { imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      });
      return {
        statusCode: 400,
        body: {
          verified: false,
          message: 'Failed to connect to server',
          serverId
        }
      };
    }
    
    // List tools
    const tools = await listServerTools(endpoint);
    if (!tools || tools.length === 0) {
      await updateServerVerification(serverId, false, {
        status: 'No tools found',
        lastTested: Date.now(),
        taskArn,
        ...(imageUri && { imageUri }),
        ...(imageTag && { imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      });
      return {
        statusCode: 400,
        body: {
          verified: false,
          message: 'No tools found on server',
          serverId
        }
      };
    }
    
    // Try a sample tool if available
    let sampleToolResult: { success: boolean; output: null } = { success: false, output: null };
    if (tools.length > 0) {
      const sampleTool = tools[0].name;
      const result = await runSampleTool(endpoint, sampleTool);
      sampleToolResult = { success: result.success, output: result.output || null };
    }
    
    // Update DynamoDB with verification results
    await updateServerVerification(serverId, true, {
      toolCount: tools.length,
      tools,
      status: 'Verified',
      lastTested: Date.now(),
      endpoint,
      taskArn,
      sampleTool: tools.length > 0 ? tools[0].name : '',
      sampleOutput: sampleToolResult.output ? JSON.stringify(sampleToolResult.output).substring(0, 1000) : '',
      sampleRunSuccess: sampleToolResult.success,
      ...(imageUri && { imageUri }),
      ...(imageTag && { imageTag }),
      ...(lastVerifiedSha && { lastVerifiedSha })
    });
    
    return {
      statusCode: 200,
      body: {
        verified: true,
        message: 'Server verified successfully',
        serverId,
        toolCount: tools.length,
        imageUri,
        imageTag,
        lastVerifiedSha
      }
    };
  } catch (error) {
    console.error('Error validating server:', error);
    
    // Attempt to update DynamoDB with error
    if (event.serverId) {
      try {
        await updateServerVerification(event.serverId, false, {
          status: `Error: ${error instanceof Error ? error.message : String(error)}`,
          lastTested: Date.now(),
          taskArn: event.taskArn,
          ...(event.imageDetails?.imageUri && { imageUri: event.imageDetails.imageUri }),
          ...(event.imageDetails?.imageTag && { imageTag: event.imageDetails.imageTag }),
          ...(event.imageDetails?.lastVerifiedSha && { lastVerifiedSha: event.imageDetails.lastVerifiedSha })
        });
      } catch (dbError) {
        console.error('Failed to update DynamoDB with error:', dbError);
      }
    }
    
    return {
      statusCode: 500,
      body: {
        verified: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        serverId: event.serverId
      }
    };
  }
};

/**
 * Test if an MCP server is accessible at the given endpoint
 */
async function testServerConnection(endpoint: string): Promise<boolean> {
  try {
    // Remove trailing slash if present
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    
    console.log(`Testing connection to ${cleanEndpoint}/`);
    
    // Try to connect to the server
    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
      try {
        const response = await axios.get(`${cleanEndpoint}/`, {
          timeout: 5000 // 5 second timeout
        });
        
        if (response.status === 200) {
          console.log(`Successfully connected to MCP server at ${cleanEndpoint}/`);
          return true;
        }
      } catch (error) {
        console.log(`Connection attempt ${retries + 1} failed, retrying...`);
      }
      
      retries++;
      if (retries < maxRetries) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.error(`Failed to connect to MCP server at ${endpoint} after ${maxRetries} attempts`);
    return false;
  } catch (error) {
    console.error(`Error testing connection to ${endpoint}:`, error);
    return false;
  }
}

/**
 * List tools available from an MCP server
 */
async function listServerTools(endpoint: string): Promise<MCPTool[] | null> {
  try {
    // Remove trailing slash if present
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    
    // Try common endpoints for tool listing
    const endpoints = [
      `${cleanEndpoint}/tools`,
      `${cleanEndpoint}/listTools`,
      `${cleanEndpoint}/v1/tools`,
      `${cleanEndpoint}/api/tools`
    ];
    
    for (const toolsEndpoint of endpoints) {
      try {
        const response = await axios.get(toolsEndpoint, {
          timeout: 5000 // 5 second timeout
        });
        
        if (response.status === 200 && response.data) {
          // Check if response contains tools array directly or nested
          if (Array.isArray(response.data)) {
            return response.data;
          } else if (response.data.tools && Array.isArray(response.data.tools)) {
            return response.data.tools;
          }
        }
      } catch (error) {
        // Continue to next endpoint on failure
        console.log(`Endpoint ${toolsEndpoint} failed, trying next...`);
      }
    }
    
    // If we get here, all endpoints failed
    console.error(`Failed to list tools from MCP server at ${endpoint}`);
    return null;
  } catch (error) {
    console.error(`Error listing tools from MCP server at ${endpoint}:`, error);
    return null;
  }
}

/**
 * Run a sample tool on an MCP server
 */
async function runSampleTool(
  endpoint: string,
  toolName: string,
  input: any = {}
): Promise<{success: boolean, output?: any}> {
  try {
    // Remove trailing slash if present
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    
    // Try common endpoints for tool execution
    const endpoints = [
      `${cleanEndpoint}/execute`,
      `${cleanEndpoint}/run`,
      `${cleanEndpoint}/v1/execute`,
      `${cleanEndpoint}/api/execute`
    ];
    
    const payload = {
      tool: toolName,
      input: input
    };
    
    for (const executeEndpoint of endpoints) {
      try {
        const response = await axios.post(executeEndpoint, payload, {
          timeout: 10000 // 10 second timeout
        });
        
        if (response.status >= 200 && response.status < 300) {
          return {
            success: true,
            output: response.data
          };
        }
      } catch (error) {
        // Continue to next endpoint on failure
        console.log(`Execute endpoint ${executeEndpoint} failed, trying next...`);
      }
    }
    
    // If we get here, all endpoints failed
    console.error(`Failed to run tool ${toolName} on MCP server at ${endpoint}`);
    return { success: false };
  } catch (error) {
    console.error(`Error running tool ${toolName} on MCP server at ${endpoint}:`, error);
    return { success: false };
  }
}

/**
 * Update server verification status in DynamoDB
 */
async function updateServerVerification(
  serverId: string,
  verified: boolean,
  verificationData: any
): Promise<boolean> {
  try {
    // Prepare update expression and attribute values
    let updateExpression = 'SET verified = :verified';
    const expressionAttributeValues: Record<string, any> = {
      ':verified': verified,
      ':lastUpdated': Date.now()
    };
    
    // Add all verification data to update expression
    Object.entries(verificationData).forEach(([key, value]) => {
      // Skip null or undefined values
      if (value !== null && value !== undefined) {
        updateExpression += `, ${key} = :${key}`;
        expressionAttributeValues[`:${key}`] = value;
      }
    });
    
    // Add lastUpdated timestamp
    updateExpression += ', lastUpdated = :lastUpdated';
    
    console.log(`Updating DynamoDB for server ${serverId} with expression: ${updateExpression}`);
    console.log('Expression attribute values:', JSON.stringify(expressionAttributeValues, null, 2));
    
    // Update DynamoDB
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { ServerId: serverId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    });
    
    const result = await docClient.send(updateCommand);
    console.log('DynamoDB update result:', JSON.stringify(result, null, 2));
    return true;
  } catch (error) {
    console.error(`Error updating server verification in DynamoDB for ${serverId}:`, error);
    return false;
  }
} 