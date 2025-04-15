import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import axios from 'axios';
import { ECRClient, DescribeImagesCommand, ListImagesCommand } from '@aws-sdk/client-ecr';

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
    const { serverId, endpoint, taskArn, imageDetails, executionArn } = event;
    
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
    console.log(`Task ARN: ${taskArn || 'Not provided'}`);
    console.log(`Execution ARN: ${executionArn || 'Not provided'}`);
    
    // Verify the image exists in ECR before proceeding
    if (imageUri) {
      try {
        // Extract the repository and tag from the image URI
        const [repository, tag] = extractRepositoryAndTag(imageUri);
        
        if (repository && tag) {
          console.log(`Verifying image exists in ECR: ${repository}:${tag}`);
          
          // Use AWS SDK to check if the image exists
          const ecr = new ECRClient();
          const describeImagesCommand = new DescribeImagesCommand({
            repositoryName: repository.split('/').pop(), // Get the repository name without account prefix
            imageIds: [{ imageTag: tag }]
          });
          
          try {
            const ecrResponse = await ecr.send(describeImagesCommand);
            console.log('ECR verification result:', JSON.stringify(ecrResponse, null, 2));
            
            // If the image doesn't exist, throw an error
            if (!ecrResponse.imageDetails || ecrResponse.imageDetails.length === 0) {
              throw new Error(`Image ${tag} does not exist in repository ${repository}`);
            }
            
            // Image found! No need to search for similar tags as we're using a consistent execution ID
            console.log(`Confirmed image exists in ECR with tag: ${tag}`);
          } catch (ecrError) {
            console.error('Error verifying image in ECR:', ecrError);
            
            // Check if this is just a delay in ECR consistency or a true missing image
            console.log('Checking if there are any images in the repository...');
            const listImagesCommand = new ListImagesCommand({
              repositoryName: repository.split('/').pop()
            });
            
            const listResult = await ecr.send(listImagesCommand);
            const availableTags = listResult.imageIds
              ?.filter(id => id.imageTag)
              .map(id => id.imageTag) || [];
            
            console.log(`Available tags in repository: ${availableTags.join(', ')}`);
            
            // With consistent execution IDs, we would expect the tag to exist exactly
            // If not, there might be an issue with the build process
            throw new Error(`Image verification failed: ${tag} not found in repository. Available tags: ${availableTags.join(', ')}`);
          }
        }
      } catch (error) {
        console.error('Error during image verification:', error);
        throw new Error(`Image verification failed: ${error.message}`);
      }
    }
    
    // If no endpoint is provided, this might be just a metadata update
    // In this case, we can still update the server record with the image information
    if (!endpoint) {
      console.log('No endpoint provided, updating metadata only');
      
      // Prepare metadata for DynamoDB update
      const metadataUpdate = {
        status: 'Image metadata updated',
        lastTested: Date.now(),
        taskArn,
        executionArn,
        ...(imageDetails?.imageUri && { imageUri: imageDetails.imageUri }),
        ...(imageDetails?.imageTag && { imageTag: imageDetails.imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      };
      
      // Update DynamoDB with metadata
      await updateServerVerification(serverId, true, metadataUpdate);
      
      return {
        verified: true,
        message: 'Image metadata updated successfully',
        serverId,
        imageUri: imageDetails?.imageUri,
        imageTag: imageDetails?.imageTag,
        lastVerifiedSha,
        taskArn,
        executionArn
      };
    }
    
    // Test server connection
    const isConnected = await testServerConnection(endpoint);
    
    if (!isConnected) {
      const status = 'Failed to connect to server';
      
      // Update DynamoDB with the failure
      await updateServerVerification(serverId, false, {
        status,
        lastTested: Date.now(),
        taskArn,
        executionArn,
        ...(imageUri && { imageUri }),
        ...(imageTag && { imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      });
      
      return {
        verified: false,
        message: status,
        serverId,
        imageUri,
        imageTag,
        lastVerifiedSha,
        taskArn,
        executionArn
      };
    }
    
    // List available tools
    console.log(`Listing tools from endpoint: ${endpoint}`);
    const tools = await listServerTools(endpoint);
    
    if (!tools || tools.length === 0) {
      const status = 'No tools found in server response';
      
      // Update DynamoDB with the failure
      await updateServerVerification(serverId, false, {
        status,
        toolCount: 0,
        lastTested: Date.now(),
        taskArn,
        executionArn,
        ...(imageUri && { imageUri }),
        ...(imageTag && { imageTag }),
        ...(lastVerifiedSha && { lastVerifiedSha })
      });
      
      return {
        verified: false,
        message: status,
        serverId,
        toolCount: 0,
        imageUri,
        imageTag,
        lastVerifiedSha,
        taskArn,
        executionArn
      };
    }
    
    console.log(`Found ${tools.length} tools from server response`);
    
    // Update DynamoDB with successful verification
    await updateServerVerification(serverId, true, {
      status: 'VERIFIED',
      toolCount: tools.length,
      tools,
      lastTested: Date.now(),
      taskArn,
      executionArn,
      ...(imageUri && { imageUri }),
      ...(imageTag && { imageTag }),
      ...(lastVerifiedSha && { lastVerifiedSha })
    });
    
    return {
      verified: true,
      message: 'Server verified successfully',
      serverId,
      toolCount: tools.length,
      imageUri,
      imageTag,
      lastVerifiedSha,
      taskArn,
      executionArn
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
          executionArn: event.executionArn,
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

/**
 * Extract repository and tag from an image URI
 */
function extractRepositoryAndTag(imageUri: string): [string | null, string | null] {
  // Format: <account-id>.dkr.ecr.<region>.amazonaws.com/<repository-name>:<tag>
  const match = imageUri.match(/^(.*):([^:]+)$/);
  if (match) {
    return [match[1], match[2]];
  }
  return [null, null];
}

// We no longer need the findMostSimilarTag function since we're using consistent execution IDs
// But we'll keep it for backward compatibility with existing tags
function findMostSimilarTag(requestedTag: string, availableTags: string[]): string | null {
  if (!availableTags || availableTags.length === 0) {
    return null;
  }
  
  // Filter tags that are exactly the same except for possibly the timestamp
  const baseName = requestedTag.split('-').slice(0, -1).join('-');
  console.log(`Base name for tag matching: ${baseName}`);
  
  // First try to find tags with the same base name
  const matchingBaseTags = availableTags.filter(tag => 
    tag.startsWith(baseName)
  );
  
  if (matchingBaseTags.length > 0) {
    // Sort by most recent timestamp (assuming timestamp format YYYYMMDDHHMMSS)
    const sorted = [...matchingBaseTags].sort().reverse();
    console.log(`Found ${matchingBaseTags.length} tag(s) with matching base name. Most recent: ${sorted[0]}`);
    return sorted[0];
  }
  
  // If no tags with matching base name, fall back to Levenshtein distance
  const distances = availableTags.map(tag => ({
    tag,
    distance: levenshteinDistance(requestedTag, tag)
  }));
  
  // Sort by distance (smaller is more similar)
  distances.sort((a, b) => a.distance - b.distance);
  
  // Choose the most similar tag if it's above a threshold
  if (distances.length > 0 && distances[0].distance < requestedTag.length / 2) {
    console.log(`Found similar tag ${distances[0].tag} with Levenshtein distance ${distances[0].distance}`);
    return distances[0].tag;
  }
  
  return null;
}

/**
 * Levenshtein distance between two strings
 * 
 * Used for finding similar tags
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize the matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
} 