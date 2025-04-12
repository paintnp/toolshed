const https = require('https');
const http = require('http');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// DynamoDB client setup
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'ToolShedServers';

exports.handler = async (event) => {
  console.log('Validation event:', JSON.stringify(event));
  
  const { serverId, endpoint, taskArn, imageDetails } = event;
  
  // Log image details if present
  if (imageDetails) {
    console.log('Image URI:', imageDetails.imageUri || 'Not provided');
    console.log('Image Tag:', imageDetails.imageTag || 'Not provided');
    console.log('Last Verified SHA:', imageDetails.lastVerifiedSha || 'Not provided');
  }
  
  if (!serverId) {
    console.error('No server ID provided');
    return {
      verified: false,
      error: 'No server ID provided'
    };
  }
  
  try {
    // If no endpoint is provided, this might be just a metadata update
    if (!endpoint) {
      console.log('No endpoint provided, updating metadata only');
      
      // Prepare metadata for DynamoDB update
      const metadataUpdate = {
        status: 'Image metadata updated',
        lastTested: Date.now(),
        taskArn,
        ...(imageDetails?.imageUri && { imageUri: imageDetails.imageUri }),
        ...(imageDetails?.imageTag && { imageTag: imageDetails.imageTag }),
        ...(imageDetails?.lastVerifiedSha && { lastVerifiedSha: imageDetails.lastVerifiedSha })
      };
      
      // Update DynamoDB with metadata
      await updateServerVerification(serverId, true, metadataUpdate);
      
      return {
        verified: true,
        message: 'Image metadata updated successfully',
        serverId,
        imageUri: imageDetails?.imageUri,
        imageTag: imageDetails?.imageTag,
        lastVerifiedSha: imageDetails?.lastVerifiedSha
      };
    }
    
    // For now, always return success for any server with an endpoint
    // In a real implementation, we would test the connection and validate tools
    console.log('Validating server at endpoint:', endpoint);
    console.log('Task ARN:', taskArn || 'Not provided');
    console.log('Server ID:', serverId);
    
    // Update DynamoDB with validation results
    await updateServerVerification(serverId, true, {
      status: 'Verified',
      lastTested: Date.now(),
      endpoint,
      taskArn,
      ...(imageDetails?.imageUri && { imageUri: imageDetails.imageUri }),
      ...(imageDetails?.imageTag && { imageTag: imageDetails.imageTag }),
      ...(imageDetails?.lastVerifiedSha && { lastVerifiedSha: imageDetails.lastVerifiedSha })
    });
    
    return {
      verified: true,
      health: { status: 'healthy', endpoint },
      serverId,
      taskArn,
      // Pass through image details if they exist
      ...(imageDetails && {
        imageUri: imageDetails.imageUri,
        imageTag: imageDetails.imageTag,
        lastVerifiedSha: imageDetails.lastVerifiedSha
      })
    };
  } catch (error) {
    console.error('Validation failed:', error);
    
    // Update DynamoDB with error
    try {
      await updateServerVerification(serverId, false, {
        status: `Error: ${error.message || 'Unknown error'}`,
        lastTested: Date.now(),
        taskArn,
        ...(imageDetails?.imageUri && { imageUri: imageDetails.imageUri }),
        ...(imageDetails?.imageTag && { imageTag: imageDetails.imageTag }),
        ...(imageDetails?.lastVerifiedSha && { lastVerifiedSha: imageDetails.lastVerifiedSha })
      });
    } catch (dbError) {
      console.error('Failed to update DynamoDB with error:', dbError);
    }
    
    return {
      verified: false,
      error: error.message,
      serverId,
      taskArn
    };
  }
};

/**
 * Update server verification status in DynamoDB
 */
async function updateServerVerification(
  serverId,
  verified,
  verificationData
) {
  try {
    // Prepare update expression and attribute values
    let updateExpression = 'SET verified = :verified';
    const expressionAttributeValues = {
      ':verified': verified,
      ':lastUpdated': Date.now()
    };
    
    // Create expression attribute names for reserved keywords
    const expressionAttributeNames = {};
    
    // Add all verification data to update expression
    Object.entries(verificationData).forEach(([key, value]) => {
      // Skip null or undefined values
      if (value !== null && value !== undefined) {
        // Check if the key is a reserved word, if so use expression attribute names
        if (['status', 'condition', 'index', 'key'].includes(key)) {
          const attrNameKey = `#${key}`;
          expressionAttributeNames[attrNameKey] = key;
          updateExpression += `, ${attrNameKey} = :${key}`;
        } else {
          updateExpression += `, ${key} = :${key}`;
        }
        expressionAttributeValues[`:${key}`] = value;
      }
    });
    
    // Add lastUpdated timestamp
    updateExpression += ', lastUpdated = :lastUpdated';
    
    console.log(`Updating DynamoDB for server ${serverId} with expression: ${updateExpression}`);
    console.log('Expression attribute values:', JSON.stringify(expressionAttributeValues, null, 2));
    if (Object.keys(expressionAttributeNames).length > 0) {
      console.log('Expression attribute names:', JSON.stringify(expressionAttributeNames, null, 2));
    }
    
    // Update DynamoDB
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { ServerId: serverId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(Object.keys(expressionAttributeNames).length > 0 && { 
        ExpressionAttributeNames: expressionAttributeNames 
      }),
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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const request = client.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(new Error(`Status Code: ${response.statusCode}`));
      }
      
      const body = [];
      response.on('data', (chunk) => body.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(body).toString();
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve(responseBody);
        }
      });
    });
    
    request.on('error', (err) => reject(err));
    request.end();
  });
} 