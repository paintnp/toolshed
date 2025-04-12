"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const axios_1 = require("axios");
// DynamoDB client setup
const ddbClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'ToolShedServers';
/**
 * Validates an MCP server endpoint and updates DynamoDB with results
 */
const handler = async (event) => {
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
        let sampleToolResult = { success: false, output: null };
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
    }
    catch (error) {
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
            }
            catch (dbError) {
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
exports.handler = handler;
/**
 * Test if an MCP server is accessible at the given endpoint
 */
async function testServerConnection(endpoint) {
    try {
        // Remove trailing slash if present
        const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        console.log(`Testing connection to ${cleanEndpoint}/`);
        // Try to connect to the server
        let retries = 0;
        const maxRetries = 5;
        while (retries < maxRetries) {
            try {
                const response = await axios_1.default.get(`${cleanEndpoint}/`, {
                    timeout: 5000 // 5 second timeout
                });
                if (response.status === 200) {
                    console.log(`Successfully connected to MCP server at ${cleanEndpoint}/`);
                    return true;
                }
            }
            catch (error) {
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
    }
    catch (error) {
        console.error(`Error testing connection to ${endpoint}:`, error);
        return false;
    }
}
/**
 * List tools available from an MCP server
 */
async function listServerTools(endpoint) {
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
                const response = await axios_1.default.get(toolsEndpoint, {
                    timeout: 5000 // 5 second timeout
                });
                if (response.status === 200 && response.data) {
                    // Check if response contains tools array directly or nested
                    if (Array.isArray(response.data)) {
                        return response.data;
                    }
                    else if (response.data.tools && Array.isArray(response.data.tools)) {
                        return response.data.tools;
                    }
                }
            }
            catch (error) {
                // Continue to next endpoint on failure
                console.log(`Endpoint ${toolsEndpoint} failed, trying next...`);
            }
        }
        // If we get here, all endpoints failed
        console.error(`Failed to list tools from MCP server at ${endpoint}`);
        return null;
    }
    catch (error) {
        console.error(`Error listing tools from MCP server at ${endpoint}:`, error);
        return null;
    }
}
/**
 * Run a sample tool on an MCP server
 */
async function runSampleTool(endpoint, toolName, input = {}) {
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
                const response = await axios_1.default.post(executeEndpoint, payload, {
                    timeout: 10000 // 10 second timeout
                });
                if (response.status >= 200 && response.status < 300) {
                    return {
                        success: true,
                        output: response.data
                    };
                }
            }
            catch (error) {
                // Continue to next endpoint on failure
                console.log(`Execute endpoint ${executeEndpoint} failed, trying next...`);
            }
        }
        // If we get here, all endpoints failed
        console.error(`Failed to run tool ${toolName} on MCP server at ${endpoint}`);
        return { success: false };
    }
    catch (error) {
        console.error(`Error running tool ${toolName} on MCP server at ${endpoint}:`, error);
        return { success: false };
    }
}
/**
 * Update server verification status in DynamoDB
 */
async function updateServerVerification(serverId, verified, verificationData) {
    try {
        // Prepare update expression and attribute values
        let updateExpression = 'SET verified = :verified';
        const expressionAttributeValues = {
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
        const updateCommand = new lib_dynamodb_1.UpdateCommand({
            TableName: TABLE_NAME,
            Key: { ServerId: serverId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        });
        const result = await docClient.send(updateCommand);
        console.log('DynamoDB update result:', JSON.stringify(result, null, 2));
        return true;
    }
    catch (error) {
        console.error(`Error updating server verification in DynamoDB for ${serverId}:`, error);
        return false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2Nkay9sYW1iZGEvdmFsaWRhdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQThFO0FBQzlFLGlDQUEwQjtBQUUxQix3QkFBd0I7QUFDeEIsTUFBTSxTQUFTLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUN6RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDekQsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLElBQUksaUJBQWlCLENBQUM7QUFTbkU7O0dBRUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBVSxFQUFnQixFQUFFO0lBQ3hELE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFL0QsSUFBSSxDQUFDO1FBQ0gscUNBQXFDO1FBQ3JDLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFNUQsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2QsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixRQUFRLGdCQUFnQixRQUFRLElBQUksU0FBUyxFQUFFLENBQUMsQ0FBQztRQUV0Riw2Q0FBNkM7UUFDN0MsTUFBTSxRQUFRLEdBQUcsWUFBWSxFQUFFLFFBQVEsQ0FBQztRQUN4QyxNQUFNLFFBQVEsR0FBRyxZQUFZLEVBQUUsUUFBUSxDQUFDO1FB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SSw4QkFBOEIsQ0FBQztRQUVuRCxPQUFPLENBQUMsR0FBRyxDQUFDLGdDQUFnQyxRQUFRLHFCQUFxQixnQkFBZ0IsRUFBRSxDQUFDLENBQUM7UUFDN0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLHlCQUF5QixFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRWhHLGtCQUFrQjtRQUNsQixNQUFNLGFBQWEsR0FBRyxJQUFJLDRCQUFhLENBQUM7WUFDdEMsU0FBUyxFQUFFLFVBQVU7WUFDckIsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtZQUMzQixnQkFBZ0IsRUFBRSxnQkFBZ0I7WUFDbEMseUJBQXlCLEVBQUUseUJBQXlCO1lBQ3BELFlBQVksRUFBRSxTQUFTO1NBQ3hCLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3hFLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHNEQUFzRCxRQUFRLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN4RixPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgVXBkYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XG5pbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuXG4vLyBEeW5hbW9EQiBjbGllbnQgc2V0dXBcbmNvbnN0IGRkYkNsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkZGJDbGllbnQpO1xuY29uc3QgVEFCTEVfTkFNRSA9IHByb2Nlc3MuZW52LkRZTkFNT0RCX1RBQkxFIHx8ICdUb29sU2hlZFNlcnZlcnMnO1xuXG4vLyBJbnRlcmZhY2UgZm9yIE1DUCB0b29sXG5pbnRlcmZhY2UgTUNQVG9vbCB7XG4gIG5hbWU6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgaW5wdXRTY2hlbWE/OiBhbnk7XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGFuIE1DUCBzZXJ2ZXIgZW5kcG9pbnQgYW5kIHVwZGF0ZXMgRHluYW1vREIgd2l0aCByZXN1bHRzXG4gKi9cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBhbnkpOiBQcm9taXNlPGFueT4gPT4ge1xuICBjb25zb2xlLmxvZygnRXZlbnQgcmVjZWl2ZWQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcbiAgXG4gIHRyeSB7XG4gICAgLy8gRXh0cmFjdCBpbmZvcm1hdGlvbiBmcm9tIHRoZSBldmVudFxuICAgIGNvbnN0IHsgc2VydmVySWQsIGVuZHBvaW50LCB0YXNrQXJuLCBpbWFnZURldGFpbHMgfSA9IGV2ZW50O1xuICAgIFxuICAgIGlmICghc2VydmVySWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXI6IHNlcnZlcklkIG11c3QgYmUgcHJvdmlkZWQnKTtcbiAgICB9XG4gICAgXG4gICAgY29uc29sZS5sb2coYFZhbGlkYXRpbmcgTUNQIHNlcnZlciAke3NlcnZlcklkfSBhdCBlbmRwb2ludCAke2VuZHBvaW50IHx8ICd1bmtub3duJ31gKTtcbiAgICBcbiAgICAvLyBFeHRyYWN0IGltYWdlIFVSSSBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcbiAgICBjb25zdCBpbWFnZVVyaSA9IGltYWdlRGV0YWlscz8uaW1hZ2VVcmk7XG4gICAgY29uc3QgaW1hZ2VUYWcgPSBpbWFnZURldGFpbHM/LmltYWdlVGFnO1xuICAgIGNvbnN0IGxhc3RWZXJpZmllZFNoYSA9IGltYWdlRGV0YWlscz8ubGFzdFZlcmlmaWVkU2hhO1xuICAgIFxuICAgIGNvbnNvbGUubG9nKGBJbWFnZSBVUkk6ICR7aW1hZ2VVcmkgfHwgJ05vdCBwcm92aWRlZCd9YCk7XG4gICAgY29uc29sZS5sb2coYEltYWdlIFRhZzogJHtpbWFnZVRhZyB8fCAnTm90IHByb3ZpZGVkJ31gKTtcbiAgICBjb25zb2xlLmxvZyhgTGFzdCBWZXJpZmllZCBTSEE6ICR7bGFzdFZlcmlmaWVkU2hhIHx8ICdOb3QgcHJvdmlkZWQnfWApO1xuICAgIFxuICAgIC8vIElmIG5vIGVuZHBvaW50IGlzIHByb3ZpZGVkLCB0aGlzIG1pZ2h0IGJlIGp1c3QgYSBtZXRhZGF0YSB1cGRhdGVcbiAgICAvLyBJbiB0aGlzIGNhc2UsIHdlIGNhbiBzdGlsbCB1cGRhdGUgdGhlIHNlcnZlciByZWNvcmQgd2l0aCB0aGUgaW1hZ2UgaW5mb3JtYXRpb25cbiAgICBpZiAoIWVuZHBvaW50KSB7XG4gICAgICBjb25zb2xlLmxvZygnTm8gZW5kcG9pbnQgcHJvdmlkZWQsIHVwZGF0aW5nIG1ldGFkYXRhIG9ubHknKTtcbiAgICAgIFxuICAgICAgLy8gUHJlcGFyZSBtZXRhZGF0YSBmb3IgRHluYW1vREIgdXBkYXRlXG4gICAgICBjb25zdCBtZXRhZGF0YVVwZGF0ZSA9IHtcbiAgICAgICAgc3RhdHVzOiAnSW1hZ2UgbWV0YWRhdGEgdXBkYXRlZCcsXG4gICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgIHRhc2tBcm4sXG4gICAgICAgIC4uLihpbWFnZVVyaSAmJiB7IGltYWdlVXJpIH0pLFxuICAgICAgICAuLi4oaW1hZ2VUYWcgJiYgeyBpbWFnZVRhZyB9KSxcbiAgICAgICAgLi4uKGxhc3RWZXJpZmllZFNoYSAmJiB7IGxhc3RWZXJpZmllZFNoYSB9KVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gVXBkYXRlIER5bmFtb0RCIHdpdGggbWV0YWRhdGFcbiAgICAgIGF3YWl0IHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihzZXJ2ZXJJZCwgdHJ1ZSwgbWV0YWRhdGFVcGRhdGUpO1xuICAgICAgXG4gICAgICByZXR1cm4ge1xuICAgICAgICB2ZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgbWVzc2FnZTogJ0ltYWdlIG1ldGFkYXRhIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgICAgc2VydmVySWQsXG4gICAgICAgIGltYWdlVXJpLFxuICAgICAgICBpbWFnZVRhZyxcbiAgICAgICAgbGFzdFZlcmlmaWVkU2hhXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBUZXN0IHNlcnZlciBjb25uZWN0aW9uXG4gICAgY29uc3QgaXNDb25uZWN0ZWQgPSBhd2FpdCB0ZXN0U2VydmVyQ29ubmVjdGlvbihlbmRwb2ludCk7XG4gICAgaWYgKCFpc0Nvbm5lY3RlZCkge1xuICAgICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKHNlcnZlcklkLCBmYWxzZSwge1xuICAgICAgICBzdGF0dXM6ICdDb25uZWN0aW9uIGZhaWxlZCcsXG4gICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgIHRhc2tBcm4sXG4gICAgICAgIC4uLihpbWFnZVVyaSAmJiB7IGltYWdlVXJpIH0pLFxuICAgICAgICAuLi4oaW1hZ2VUYWcgJiYgeyBpbWFnZVRhZyB9KSxcbiAgICAgICAgLi4uKGxhc3RWZXJpZmllZFNoYSAmJiB7IGxhc3RWZXJpZmllZFNoYSB9KVxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB2ZXJpZmllZDogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogJ0ZhaWxlZCB0byBjb25uZWN0IHRvIHNlcnZlcicsXG4gICAgICAgICAgc2VydmVySWRcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gTGlzdCB0b29sc1xuICAgIGNvbnN0IHRvb2xzID0gYXdhaXQgbGlzdFNlcnZlclRvb2xzKGVuZHBvaW50KTtcbiAgICBpZiAoIXRvb2xzIHx8IHRvb2xzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKHNlcnZlcklkLCBmYWxzZSwge1xuICAgICAgICBzdGF0dXM6ICdObyB0b29scyBmb3VuZCcsXG4gICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgIHRhc2tBcm4sXG4gICAgICAgIC4uLihpbWFnZVVyaSAmJiB7IGltYWdlVXJpIH0pLFxuICAgICAgICAuLi4oaW1hZ2VUYWcgJiYgeyBpbWFnZVRhZyB9KSxcbiAgICAgICAgLi4uKGxhc3RWZXJpZmllZFNoYSAmJiB7IGxhc3RWZXJpZmllZFNoYSB9KVxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB2ZXJpZmllZDogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogJ05vIHRvb2xzIGZvdW5kIG9uIHNlcnZlcicsXG4gICAgICAgICAgc2VydmVySWRcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gVHJ5IGEgc2FtcGxlIHRvb2wgaWYgYXZhaWxhYmxlXG4gICAgbGV0IHNhbXBsZVRvb2xSZXN1bHQ6IHsgc3VjY2VzczogYm9vbGVhbjsgb3V0cHV0OiBudWxsIH0gPSB7IHN1Y2Nlc3M6IGZhbHNlLCBvdXRwdXQ6IG51bGwgfTtcbiAgICBpZiAodG9vbHMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc2FtcGxlVG9vbCA9IHRvb2xzWzBdLm5hbWU7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBydW5TYW1wbGVUb29sKGVuZHBvaW50LCBzYW1wbGVUb29sKTtcbiAgICAgIHNhbXBsZVRvb2xSZXN1bHQgPSB7IHN1Y2Nlc3M6IHJlc3VsdC5zdWNjZXNzLCBvdXRwdXQ6IHJlc3VsdC5vdXRwdXQgfHwgbnVsbCB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBVcGRhdGUgRHluYW1vREIgd2l0aCB2ZXJpZmljYXRpb24gcmVzdWx0c1xuICAgIGF3YWl0IHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihzZXJ2ZXJJZCwgdHJ1ZSwge1xuICAgICAgdG9vbENvdW50OiB0b29scy5sZW5ndGgsXG4gICAgICB0b29scyxcbiAgICAgIHN0YXR1czogJ1ZlcmlmaWVkJyxcbiAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICBlbmRwb2ludCxcbiAgICAgIHRhc2tBcm4sXG4gICAgICBzYW1wbGVUb29sOiB0b29scy5sZW5ndGggPiAwID8gdG9vbHNbMF0ubmFtZSA6ICcnLFxuICAgICAgc2FtcGxlT3V0cHV0OiBzYW1wbGVUb29sUmVzdWx0Lm91dHB1dCA/IEpTT04uc3RyaW5naWZ5KHNhbXBsZVRvb2xSZXN1bHQub3V0cHV0KS5zdWJzdHJpbmcoMCwgMTAwMCkgOiAnJyxcbiAgICAgIHNhbXBsZVJ1blN1Y2Nlc3M6IHNhbXBsZVRvb2xSZXN1bHQuc3VjY2VzcyxcbiAgICAgIC4uLihpbWFnZVVyaSAmJiB7IGltYWdlVXJpIH0pLFxuICAgICAgLi4uKGltYWdlVGFnICYmIHsgaW1hZ2VUYWcgfSksXG4gICAgICAuLi4obGFzdFZlcmlmaWVkU2hhICYmIHsgbGFzdFZlcmlmaWVkU2hhIH0pXG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgdmVyaWZpZWQ6IHRydWUsXG4gICAgICAgIG1lc3NhZ2U6ICdTZXJ2ZXIgdmVyaWZpZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgICAgc2VydmVySWQsXG4gICAgICAgIHRvb2xDb3VudDogdG9vbHMubGVuZ3RoLFxuICAgICAgICBpbWFnZVVyaSxcbiAgICAgICAgaW1hZ2VUYWcsXG4gICAgICAgIGxhc3RWZXJpZmllZFNoYVxuICAgICAgfVxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgdmFsaWRhdGluZyBzZXJ2ZXI6JywgZXJyb3IpO1xuICAgIFxuICAgIC8vIEF0dGVtcHQgdG8gdXBkYXRlIER5bmFtb0RCIHdpdGggZXJyb3JcbiAgICBpZiAoZXZlbnQuc2VydmVySWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihldmVudC5zZXJ2ZXJJZCwgZmFsc2UsIHtcbiAgICAgICAgICBzdGF0dXM6IGBFcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgICBsYXN0VGVzdGVkOiBEYXRlLm5vdygpLFxuICAgICAgICAgIHRhc2tBcm46IGV2ZW50LnRhc2tBcm4sXG4gICAgICAgICAgLi4uKGV2ZW50LmltYWdlRGV0YWlscz8uaW1hZ2VVcmkgJiYgeyBpbWFnZVVyaTogZXZlbnQuaW1hZ2VEZXRhaWxzLmltYWdlVXJpIH0pLFxuICAgICAgICAgIC4uLihldmVudC5pbWFnZURldGFpbHM/LmltYWdlVGFnICYmIHsgaW1hZ2VUYWc6IGV2ZW50LmltYWdlRGV0YWlscy5pbWFnZVRhZyB9KSxcbiAgICAgICAgICAuLi4oZXZlbnQuaW1hZ2VEZXRhaWxzPy5sYXN0VmVyaWZpZWRTaGEgJiYgeyBsYXN0VmVyaWZpZWRTaGE6IGV2ZW50LmltYWdlRGV0YWlscy5sYXN0VmVyaWZpZWRTaGEgfSlcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChkYkVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byB1cGRhdGUgRHluYW1vREIgd2l0aCBlcnJvcjonLCBkYkVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgdmVyaWZpZWQ6IGZhbHNlLFxuICAgICAgICBtZXNzYWdlOiBgRXJyb3I6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgIHNlcnZlcklkOiBldmVudC5zZXJ2ZXJJZFxuICAgICAgfVxuICAgIH07XG4gIH1cbn07XG5cbi8qKlxuICogVGVzdCBpZiBhbiBNQ1Agc2VydmVyIGlzIGFjY2Vzc2libGUgYXQgdGhlIGdpdmVuIGVuZHBvaW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRlc3RTZXJ2ZXJDb25uZWN0aW9uKGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICAvLyBSZW1vdmUgdHJhaWxpbmcgc2xhc2ggaWYgcHJlc2VudFxuICAgIGNvbnN0IGNsZWFuRW5kcG9pbnQgPSBlbmRwb2ludC5lbmRzV2l0aCgnLycpID8gZW5kcG9pbnQuc2xpY2UoMCwgLTEpIDogZW5kcG9pbnQ7XG4gICAgXG4gICAgY29uc29sZS5sb2coYFRlc3RpbmcgY29ubmVjdGlvbiB0byAke2NsZWFuRW5kcG9pbnR9L2ApO1xuICAgIFxuICAgIC8vIFRyeSB0byBjb25uZWN0IHRvIHRoZSBzZXJ2ZXJcbiAgICBsZXQgcmV0cmllcyA9IDA7XG4gICAgY29uc3QgbWF4UmV0cmllcyA9IDU7XG4gICAgXG4gICAgd2hpbGUgKHJldHJpZXMgPCBtYXhSZXRyaWVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldChgJHtjbGVhbkVuZHBvaW50fS9gLCB7XG4gICAgICAgICAgdGltZW91dDogNTAwMCAvLyA1IHNlY29uZCB0aW1lb3V0XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gMjAwKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYFN1Y2Nlc3NmdWxseSBjb25uZWN0ZWQgdG8gTUNQIHNlcnZlciBhdCAke2NsZWFuRW5kcG9pbnR9L2ApO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdGlvbiBhdHRlbXB0ICR7cmV0cmllcyArIDF9IGZhaWxlZCwgcmV0cnlpbmcuLi5gKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgcmV0cmllcysrO1xuICAgICAgaWYgKHJldHJpZXMgPCBtYXhSZXRyaWVzKSB7XG4gICAgICAgIC8vIFdhaXQgYmVmb3JlIHJldHJ5XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDAwKSk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBjb25uZWN0IHRvIE1DUCBzZXJ2ZXIgYXQgJHtlbmRwb2ludH0gYWZ0ZXIgJHttYXhSZXRyaWVzfSBhdHRlbXB0c2ApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciB0ZXN0aW5nIGNvbm5lY3Rpb24gdG8gJHtlbmRwb2ludH06YCwgZXJyb3IpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIExpc3QgdG9vbHMgYXZhaWxhYmxlIGZyb20gYW4gTUNQIHNlcnZlclxuICovXG5hc3luYyBmdW5jdGlvbiBsaXN0U2VydmVyVG9vbHMoZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8TUNQVG9vbFtdIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaCBpZiBwcmVzZW50XG4gICAgY29uc3QgY2xlYW5FbmRwb2ludCA9IGVuZHBvaW50LmVuZHNXaXRoKCcvJykgPyBlbmRwb2ludC5zbGljZSgwLCAtMSkgOiBlbmRwb2ludDtcbiAgICBcbiAgICAvLyBUcnkgY29tbW9uIGVuZHBvaW50cyBmb3IgdG9vbCBsaXN0aW5nXG4gICAgY29uc3QgZW5kcG9pbnRzID0gW1xuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vdG9vbHNgLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vbGlzdFRvb2xzYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L3YxL3Rvb2xzYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L2FwaS90b29sc2BcbiAgICBdO1xuICAgIFxuICAgIGZvciAoY29uc3QgdG9vbHNFbmRwb2ludCBvZiBlbmRwb2ludHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KHRvb2xzRW5kcG9pbnQsIHtcbiAgICAgICAgICB0aW1lb3V0OiA1MDAwIC8vIDUgc2Vjb25kIHRpbWVvdXRcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSAyMDAgJiYgcmVzcG9uc2UuZGF0YSkge1xuICAgICAgICAgIC8vIENoZWNrIGlmIHJlc3BvbnNlIGNvbnRhaW5zIHRvb2xzIGFycmF5IGRpcmVjdGx5IG9yIG5lc3RlZFxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc3BvbnNlLmRhdGEpKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlLmRhdGEudG9vbHMgJiYgQXJyYXkuaXNBcnJheShyZXNwb25zZS5kYXRhLnRvb2xzKSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEudG9vbHM7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBDb250aW51ZSB0byBuZXh0IGVuZHBvaW50IG9uIGZhaWx1cmVcbiAgICAgICAgY29uc29sZS5sb2coYEVuZHBvaW50ICR7dG9vbHNFbmRwb2ludH0gZmFpbGVkLCB0cnlpbmcgbmV4dC4uLmApO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBJZiB3ZSBnZXQgaGVyZSwgYWxsIGVuZHBvaW50cyBmYWlsZWRcbiAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gbGlzdCB0b29scyBmcm9tIE1DUCBzZXJ2ZXIgYXQgJHtlbmRwb2ludH1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciBsaXN0aW5nIHRvb2xzIGZyb20gTUNQIHNlcnZlciBhdCAke2VuZHBvaW50fTpgLCBlcnJvcik7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSdW4gYSBzYW1wbGUgdG9vbCBvbiBhbiBNQ1Agc2VydmVyXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJ1blNhbXBsZVRvb2woXG4gIGVuZHBvaW50OiBzdHJpbmcsXG4gIHRvb2xOYW1lOiBzdHJpbmcsXG4gIGlucHV0OiBhbnkgPSB7fVxuKTogUHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgb3V0cHV0PzogYW55fT4ge1xuICB0cnkge1xuICAgIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaCBpZiBwcmVzZW50XG4gICAgY29uc3QgY2xlYW5FbmRwb2ludCA9IGVuZHBvaW50LmVuZHNXaXRoKCcvJykgPyBlbmRwb2ludC5zbGljZSgwLCAtMSkgOiBlbmRwb2ludDtcbiAgICBcbiAgICAvLyBUcnkgY29tbW9uIGVuZHBvaW50cyBmb3IgdG9vbCBleGVjdXRpb25cbiAgICBjb25zdCBlbmRwb2ludHMgPSBbXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS9leGVjdXRlYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L3J1bmAsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS92MS9leGVjdXRlYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L2FwaS9leGVjdXRlYFxuICAgIF07XG4gICAgXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIHRvb2w6IHRvb2xOYW1lLFxuICAgICAgaW5wdXQ6IGlucHV0XG4gICAgfTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IGV4ZWN1dGVFbmRwb2ludCBvZiBlbmRwb2ludHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdChleGVjdXRlRW5kcG9pbnQsIHBheWxvYWQsIHtcbiAgICAgICAgICB0aW1lb3V0OiAxMDAwMCAvLyAxMCBzZWNvbmQgdGltZW91dFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPj0gMjAwICYmIHJlc3BvbnNlLnN0YXR1cyA8IDMwMCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgb3V0cHV0OiByZXNwb25zZS5kYXRhXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQ29udGludWUgdG8gbmV4dCBlbmRwb2ludCBvbiBmYWlsdXJlXG4gICAgICAgIGNvbnNvbGUubG9nKGBFeGVjdXRlIGVuZHBvaW50ICR7ZXhlY3V0ZUVuZHBvaW50fSBmYWlsZWQsIHRyeWluZyBuZXh0Li4uYCk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIElmIHdlIGdldCBoZXJlLCBhbGwgZW5kcG9pbnRzIGZhaWxlZFxuICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBydW4gdG9vbCAke3Rvb2xOYW1lfSBvbiBNQ1Agc2VydmVyIGF0ICR7ZW5kcG9pbnR9YCk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciBydW5uaW5nIHRvb2wgJHt0b29sTmFtZX0gb24gTUNQIHNlcnZlciBhdCAke2VuZHBvaW50fTpgLCBlcnJvcik7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTtcbiAgfVxufVxuXG4vKipcbiAqIFVwZGF0ZSBzZXJ2ZXIgdmVyaWZpY2F0aW9uIHN0YXR1cyBpbiBEeW5hbW9EQlxuICovXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVTZXJ2ZXJWZXJpZmljYXRpb24oXG4gIHNlcnZlcklkOiBzdHJpbmcsXG4gIHZlcmlmaWVkOiBib29sZWFuLFxuICB2ZXJpZmljYXRpb25EYXRhOiBhbnlcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIC8vIFByZXBhcmUgdXBkYXRlIGV4cHJlc3Npb24gYW5kIGF0dHJpYnV0ZSB2YWx1ZXNcbiAgICBsZXQgdXBkYXRlRXhwcmVzc2lvbiA9ICdTRVQgdmVyaWZpZWQgPSA6dmVyaWZpZWQnO1xuICAgIGNvbnN0IGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAnOnZlcmlmaWVkJzogdmVyaWZpZWQsXG4gICAgICAnOmxhc3RVcGRhdGVkJzogRGF0ZS5ub3coKVxuICAgIH07XG4gICAgXG4gICAgLy8gQWRkIGFsbCB2ZXJpZmljYXRpb24gZGF0YSB0byB1cGRhdGUgZXhwcmVzc2lvblxuICAgIE9iamVjdC5lbnRyaWVzKHZlcmlmaWNhdGlvbkRhdGEpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgLy8gU2tpcCBudWxsIG9yIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVwZGF0ZUV4cHJlc3Npb24gKz0gYCwgJHtrZXl9ID0gOiR7a2V5fWA7XG4gICAgICAgIGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXNbYDoke2tleX1gXSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEFkZCBsYXN0VXBkYXRlZCB0aW1lc3RhbXBcbiAgICB1cGRhdGVFeHByZXNzaW9uICs9ICcsIGxhc3RVcGRhdGVkID0gOmxhc3RVcGRhdGVkJztcbiAgICBcbiAgICBjb25zb2xlLmxvZyhgVXBkYXRpbmcgRHluYW1vREIgZm9yIHNlcnZlciAke3NlcnZlcklkfSB3aXRoIGV4cHJlc3Npb246ICR7dXBkYXRlRXhwcmVzc2lvbn1gKTtcbiAgICBjb25zb2xlLmxvZygnRXhwcmVzc2lvbiBhdHRyaWJ1dGUgdmFsdWVzOicsIEpTT04uc3RyaW5naWZ5KGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXMsIG51bGwsIDIpKTtcbiAgICBcbiAgICAvLyBVcGRhdGUgRHluYW1vREJcbiAgICBjb25zdCB1cGRhdGVDb21tYW5kID0gbmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBUQUJMRV9OQU1FLFxuICAgICAgS2V5OiB7IFNlcnZlcklkOiBzZXJ2ZXJJZCB9LFxuICAgICAgVXBkYXRlRXhwcmVzc2lvbjogdXBkYXRlRXhwcmVzc2lvbixcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXMsXG4gICAgICBSZXR1cm5WYWx1ZXM6ICdBTExfTkVXJ1xuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKHVwZGF0ZUNvbW1hbmQpO1xuICAgIGNvbnNvbGUubG9nKCdEeW5hbW9EQiB1cGRhdGUgcmVzdWx0OicsIEpTT04uc3RyaW5naWZ5KHJlc3VsdCwgbnVsbCwgMikpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHVwZGF0aW5nIHNlcnZlciB2ZXJpZmljYXRpb24gaW4gRHluYW1vREIgZm9yICR7c2VydmVySWR9OmAsIGVycm9yKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn0gIl19