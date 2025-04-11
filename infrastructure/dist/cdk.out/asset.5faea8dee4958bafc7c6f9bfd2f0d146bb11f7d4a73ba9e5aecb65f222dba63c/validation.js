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
        const { serverId, endpoint, taskArn } = event;
        if (!serverId || !endpoint) {
            throw new Error('Missing required parameters: serverId and endpoint must be provided');
        }
        console.log(`Validating MCP server ${serverId} at endpoint ${endpoint}`);
        // Test server connection
        const isConnected = await testServerConnection(endpoint);
        if (!isConnected) {
            await updateServerVerification(serverId, false, {
                status: 'Connection failed',
                lastTested: Date.now(),
                taskArn,
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
            sampleRunSuccess: sampleToolResult.success
        });
        return {
            statusCode: 200,
            body: {
                verified: true,
                message: 'Server verified successfully',
                serverId,
                toolCount: tools.length
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
                    taskArn: event.taskArn
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
            updateExpression += `, ${key} = :${key}`;
            expressionAttributeValues[`:${key}`] = value;
        });
        // Add lastUpdated timestamp
        updateExpression += ', lastUpdated = :lastUpdated';
        // Update DynamoDB
        const updateCommand = new lib_dynamodb_1.UpdateCommand({
            TableName: TABLE_NAME,
            Key: { ServerId: serverId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        });
        await docClient.send(updateCommand);
        return true;
    }
    catch (error) {
        console.error(`Error updating server verification in DynamoDB for ${serverId}:`, error);
        return false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2Nkay5vdXQvYXNzZXQuNWZhZWE4ZGVlNDk1OGJhZmM3YzZmOWJmZDJmMGQxNDZiYjExZjdkNGE3M2JhOWU1YWVjYjY1ZjIyMmRiYTYzYy92YWxpZGF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDhEQUEwRDtBQUMxRCx3REFBOEU7QUFDOUUsaUNBQTBCO0FBRTFCLHdCQUF3QjtBQUN4QixNQUFNLFNBQVMsR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ3pFLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN6RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsSUFBSSxpQkFBaUIsQ0FBQztBQVNuRTs7R0FFRztBQUNJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUFVLEVBQWdCLEVBQUU7SUFDeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvRCxJQUFJLENBQUM7UUFDSCxxQ0FBcUM7UUFDckMsTUFBTSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlDLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLHFFQUFxRSxDQUFDLENBQUM7UUFDekYsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLFFBQVEsZ0JBQWdCLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFekUseUJBQXlCO1FBQ3pCLE1BQU0sV0FBVyxHQUFH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S0FBSyxDQUFDLEVBQUUsRUFBRTtZQUN4RCxnQkFBZ0IsSUFBSSxLQUFLLEdBQUcsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUN6Qyx5QkFBeUIsQ0FBQyxJQUFJLEdBQUcsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDO1FBQy9DLENBQUMsQ0FBQyxDQUFDO1FBRUgsNEJBQTRCO1FBQzVCLGdCQUFnQixJQUFJLDhCQUE4QixDQUFDO1FBRW5ELGtCQUFrQjtRQUNsQixNQUFNLGFBQWEsR0FBRyxJQUFJLDRCQUFhLENBQUM7WUFDdEMsU0FBUyxFQUFFLFVBQVU7WUFDckIsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtZQUMzQixnQkFBZ0IsRUFBRSxnQkFBZ0I7WUFDbEMseUJBQXlCLEVBQUUseUJBQXlCO1lBQ3BELFlBQVksRUFBRSxTQUFTO1NBQ3hCLENBQUMsQ0FBQztRQUVILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNwQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxzREFBc0QsUUFBUSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDeEYsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFVwZGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcblxuLy8gRHluYW1vREIgY2xpZW50IHNldHVwXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZGRiQ2xpZW50KTtcbmNvbnN0IFRBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5EWU5BTU9EQl9UQUJMRSB8fCAnVG9vbFNoZWRTZXJ2ZXJzJztcblxuLy8gSW50ZXJmYWNlIGZvciBNQ1AgdG9vbFxuaW50ZXJmYWNlIE1DUFRvb2wge1xuICBuYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGlucHV0U2NoZW1hPzogYW55O1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBNQ1Agc2VydmVyIGVuZHBvaW50IGFuZCB1cGRhdGVzIER5bmFtb0RCIHdpdGggcmVzdWx0c1xuICovXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogYW55KTogUHJvbWlzZTxhbnk+ID0+IHtcbiAgY29uc29sZS5sb2coJ0V2ZW50IHJlY2VpdmVkOicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG4gIFxuICB0cnkge1xuICAgIC8vIEV4dHJhY3QgaW5mb3JtYXRpb24gZnJvbSB0aGUgZXZlbnRcbiAgICBjb25zdCB7IHNlcnZlcklkLCBlbmRwb2ludCwgdGFza0FybiB9ID0gZXZlbnQ7XG4gICAgXG4gICAgaWYgKCFzZXJ2ZXJJZCB8fCAhZW5kcG9pbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXJzOiBzZXJ2ZXJJZCBhbmQgZW5kcG9pbnQgbXVzdCBiZSBwcm92aWRlZCcpO1xuICAgIH1cbiAgICBcbiAgICBjb25zb2xlLmxvZyhgVmFsaWRhdGluZyBNQ1Agc2VydmVyICR7c2VydmVySWR9IGF0IGVuZHBvaW50ICR7ZW5kcG9pbnR9YCk7XG4gICAgXG4gICAgLy8gVGVzdCBzZXJ2ZXIgY29ubmVjdGlvblxuICAgIGNvbnN0IGlzQ29ubmVjdGVkID0gYXdhaXQgdGVzdFNlcnZlckNvbm5lY3Rpb24oZW5kcG9pbnQpO1xuICAgIGlmICghaXNDb25uZWN0ZWQpIHtcbiAgICAgIGF3YWl0IHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihzZXJ2ZXJJZCwgZmFsc2UsIHtcbiAgICAgICAgc3RhdHVzOiAnQ29ubmVjdGlvbiBmYWlsZWQnLFxuICAgICAgICBsYXN0VGVzdGVkOiBEYXRlLm5vdygpLFxuICAgICAgICB0YXNrQXJuLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB2ZXJpZmllZDogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogJ0ZhaWxlZCB0byBjb25uZWN0IHRvIHNlcnZlcicsXG4gICAgICAgICAgc2VydmVySWRcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gTGlzdCB0b29sc1xuICAgIGNvbnN0IHRvb2xzID0gYXdhaXQgbGlzdFNlcnZlclRvb2xzKGVuZHBvaW50KTtcbiAgICBpZiAoIXRvb2xzIHx8IHRvb2xzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKHNlcnZlcklkLCBmYWxzZSwge1xuICAgICAgICBzdGF0dXM6ICdObyB0b29scyBmb3VuZCcsXG4gICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgIHRhc2tBcm4sXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHZlcmlmaWVkOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiAnTm8gdG9vbHMgZm91bmQgb24gc2VydmVyJyxcbiAgICAgICAgICBzZXJ2ZXJJZFxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBUcnkgYSBzYW1wbGUgdG9vbCBpZiBhdmFpbGFibGVcbiAgICBsZXQgc2FtcGxlVG9vbFJlc3VsdDogeyBzdWNjZXNzOiBib29sZWFuOyBvdXRwdXQ6IG51bGwgfSA9IHsgc3VjY2VzczogZmFsc2UsIG91dHB1dDogbnVsbCB9O1xuICAgIGlmICh0b29scy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzYW1wbGVUb29sID0gdG9vbHNbMF0ubmFtZTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJ1blNhbXBsZVRvb2woZW5kcG9pbnQsIHNhbXBsZVRvb2wpO1xuICAgICAgc2FtcGxlVG9vbFJlc3VsdCA9IHsgc3VjY2VzczogcmVzdWx0LnN1Y2Nlc3MsIG91dHB1dDogcmVzdWx0Lm91dHB1dCB8fCBudWxsIH07XG4gICAgfVxuICAgIFxuICAgIC8vIFVwZGF0ZSBEeW5hbW9EQiB3aXRoIHZlcmlmaWNhdGlvbiByZXN1bHRzXG4gICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKHNlcnZlcklkLCB0cnVlLCB7XG4gICAgICB0b29sQ291bnQ6IHRvb2xzLmxlbmd0aCxcbiAgICAgIHRvb2xzLFxuICAgICAgc3RhdHVzOiAnVmVyaWZpZWQnLFxuICAgICAgbGFzdFRlc3RlZDogRGF0ZS5ub3coKSxcbiAgICAgIGVuZHBvaW50LFxuICAgICAgdGFza0FybixcbiAgICAgIHNhbXBsZVRvb2w6IHRvb2xzLmxlbmd0aCA+IDAgPyB0b29sc1swXS5uYW1lIDogJycsXG4gICAgICBzYW1wbGVPdXRwdXQ6IHNhbXBsZVRvb2xSZXN1bHQub3V0cHV0ID8gSlNPTi5zdHJpbmdpZnkoc2FtcGxlVG9vbFJlc3VsdC5vdXRwdXQpLnN1YnN0cmluZygwLCAxMDAwKSA6ICcnLFxuICAgICAgc2FtcGxlUnVuU3VjY2Vzczogc2FtcGxlVG9vbFJlc3VsdC5zdWNjZXNzXG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgdmVyaWZpZWQ6IHRydWUsXG4gICAgICAgIG1lc3NhZ2U6ICdTZXJ2ZXIgdmVyaWZpZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgICAgc2VydmVySWQsXG4gICAgICAgIHRvb2xDb3VudDogdG9vbHMubGVuZ3RoXG4gICAgICB9XG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciB2YWxpZGF0aW5nIHNlcnZlcjonLCBlcnJvcik7XG4gICAgXG4gICAgLy8gQXR0ZW1wdCB0byB1cGRhdGUgRHluYW1vREIgd2l0aCBlcnJvclxuICAgIGlmIChldmVudC5zZXJ2ZXJJZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKGV2ZW50LnNlcnZlcklkLCBmYWxzZSwge1xuICAgICAgICAgIHN0YXR1czogYEVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgICAgdGFza0FybjogZXZlbnQudGFza0FyblxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGRiRXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHVwZGF0ZSBEeW5hbW9EQiB3aXRoIGVycm9yOicsIGRiRXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgYm9keToge1xuICAgICAgICB2ZXJpZmllZDogZmFsc2UsXG4gICAgICAgIG1lc3NhZ2U6IGBFcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICAgc2VydmVySWQ6IGV2ZW50LnNlcnZlcklkXG4gICAgICB9XG4gICAgfTtcbiAgfVxufTtcblxuLyoqXG4gKiBUZXN0IGlmIGFuIE1DUCBzZXJ2ZXIgaXMgYWNjZXNzaWJsZSBhdCB0aGUgZ2l2ZW4gZW5kcG9pbnRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdGVzdFNlcnZlckNvbm5lY3Rpb24oZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIC8vIFJlbW92ZSB0cmFpbGluZyBzbGFzaCBpZiBwcmVzZW50XG4gICAgY29uc3QgY2xlYW5FbmRwb2ludCA9IGVuZHBvaW50LmVuZHNXaXRoKCcvJykgPyBlbmRwb2ludC5zbGljZSgwLCAtMSkgOiBlbmRwb2ludDtcbiAgICBcbiAgICBjb25zb2xlLmxvZyhgVGVzdGluZyBjb25uZWN0aW9uIHRvICR7Y2xlYW5FbmRwb2ludH0vYCk7XG4gICAgXG4gICAgLy8gVHJ5IHRvIGNvbm5lY3QgdG8gdGhlIHNlcnZlclxuICAgIGxldCByZXRyaWVzID0gMDtcbiAgICBjb25zdCBtYXhSZXRyaWVzID0gNTtcbiAgICBcbiAgICB3aGlsZSAocmV0cmllcyA8IG1heFJldHJpZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KGAke2NsZWFuRW5kcG9pbnR9L2AsIHtcbiAgICAgICAgICB0aW1lb3V0OiA1MDAwIC8vIDUgc2Vjb25kIHRpbWVvdXRcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSAyMDApIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgU3VjY2Vzc2Z1bGx5IGNvbm5lY3RlZCB0byBNQ1Agc2VydmVyIGF0ICR7Y2xlYW5FbmRwb2ludH0vYCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0aW9uIGF0dGVtcHQgJHtyZXRyaWVzICsgMX0gZmFpbGVkLCByZXRyeWluZy4uLmApO1xuICAgICAgfVxuICAgICAgXG4gICAgICByZXRyaWVzKys7XG4gICAgICBpZiAocmV0cmllcyA8IG1heFJldHJpZXMpIHtcbiAgICAgICAgLy8gV2FpdCBiZWZvcmUgcmV0cnlcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDMwMDApKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGNvbm5lY3QgdG8gTUNQIHNlcnZlciBhdCAke2VuZHBvaW50fSBhZnRlciAke21heFJldHJpZXN9IGF0dGVtcHRzYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHRlc3RpbmcgY29ubmVjdGlvbiB0byAke2VuZHBvaW50fTpgLCBlcnJvcik7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogTGlzdCB0b29scyBhdmFpbGFibGUgZnJvbSBhbiBNQ1Agc2VydmVyXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGxpc3RTZXJ2ZXJUb29scyhlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTxNQ1BUb29sW10gfCBudWxsPiB7XG4gIHRyeSB7XG4gICAgLy8gUmVtb3ZlIHRyYWlsaW5nIHNsYXNoIGlmIHByZXNlbnRcbiAgICBjb25zdCBjbGVhbkVuZHBvaW50ID0gZW5kcG9pbnQuZW5kc1dpdGgoJy8nKSA/IGVuZHBvaW50LnNsaWNlKDAsIC0xKSA6IGVuZHBvaW50O1xuICAgIFxuICAgIC8vIFRyeSBjb21tb24gZW5kcG9pbnRzIGZvciB0b29sIGxpc3RpbmdcbiAgICBjb25zdCBlbmRwb2ludHMgPSBbXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS90b29sc2AsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS9saXN0VG9vbHNgLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vdjEvdG9vbHNgLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vYXBpL3Rvb2xzYFxuICAgIF07XG4gICAgXG4gICAgZm9yIChjb25zdCB0b29sc0VuZHBvaW50IG9mIGVuZHBvaW50cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQodG9vbHNFbmRwb2ludCwge1xuICAgICAgICAgIHRpbWVvdXQ6IDUwMDAgLy8gNSBzZWNvbmQgdGltZW91dFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDIwMCAmJiByZXNwb25zZS5kYXRhKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgaWYgcmVzcG9uc2UgY29udGFpbnMgdG9vbHMgYXJyYXkgZGlyZWN0bHkgb3IgbmVzdGVkXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVzcG9uc2UuZGF0YSkpIHtcbiAgICAgICAgICAgIHJldHVybiByZXNwb25zZS5kYXRhO1xuICAgICAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2UuZGF0YS50b29scyAmJiBBcnJheS5pc0FycmF5KHJlc3BvbnNlLmRhdGEudG9vbHMpKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzcG9uc2UuZGF0YS50b29scztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENvbnRpbnVlIHRvIG5leHQgZW5kcG9pbnQgb24gZmFpbHVyZVxuICAgICAgICBjb25zb2xlLmxvZyhgRW5kcG9pbnQgJHt0b29sc0VuZHBvaW50fSBmYWlsZWQsIHRyeWluZyBuZXh0Li4uYCk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIElmIHdlIGdldCBoZXJlLCBhbGwgZW5kcG9pbnRzIGZhaWxlZFxuICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBsaXN0IHRvb2xzIGZyb20gTUNQIHNlcnZlciBhdCAke2VuZHBvaW50fWApO1xuICAgIHJldHVybiBudWxsO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGxpc3RpbmcgdG9vbHMgZnJvbSBNQ1Agc2VydmVyIGF0ICR7ZW5kcG9pbnR9OmAsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJ1biBhIHNhbXBsZSB0b29sIG9uIGFuIE1DUCBzZXJ2ZXJcbiAqL1xuYXN5bmMgZnVuY3Rpb24gcnVuU2FtcGxlVG9vbChcbiAgZW5kcG9pbnQ6IHN0cmluZyxcbiAgdG9vbE5hbWU6IHN0cmluZyxcbiAgaW5wdXQ6IGFueSA9IHt9XG4pOiBQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBvdXRwdXQ/OiBhbnl9PiB7XG4gIHRyeSB7XG4gICAgLy8gUmVtb3ZlIHRyYWlsaW5nIHNsYXNoIGlmIHByZXNlbnRcbiAgICBjb25zdCBjbGVhbkVuZHBvaW50ID0gZW5kcG9pbnQuZW5kc1dpdGgoJy8nKSA/IGVuZHBvaW50LnNsaWNlKDAsIC0xKSA6IGVuZHBvaW50O1xuICAgIFxuICAgIC8vIFRyeSBjb21tb24gZW5kcG9pbnRzIGZvciB0b29sIGV4ZWN1dGlvblxuICAgIGNvbnN0IGVuZHBvaW50cyA9IFtcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L2V4ZWN1dGVgLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vcnVuYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L3YxL2V4ZWN1dGVgLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vYXBpL2V4ZWN1dGVgXG4gICAgXTtcbiAgICBcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgdG9vbDogdG9vbE5hbWUsXG4gICAgICBpbnB1dDogaW5wdXRcbiAgICB9O1xuICAgIFxuICAgIGZvciAoY29uc3QgZXhlY3V0ZUVuZHBvaW50IG9mIGVuZHBvaW50cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KGV4ZWN1dGVFbmRwb2ludCwgcGF5bG9hZCwge1xuICAgICAgICAgIHRpbWVvdXQ6IDEwMDAwIC8vIDEwIHNlY29uZCB0aW1lb3V0XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA+PSAyMDAgJiYgcmVzcG9uc2Uuc3RhdHVzIDwgMzAwKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBvdXRwdXQ6IHJlc3BvbnNlLmRhdGFcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBDb250aW51ZSB0byBuZXh0IGVuZHBvaW50IG9uIGZhaWx1cmVcbiAgICAgICAgY29uc29sZS5sb2coYEV4ZWN1dGUgZW5kcG9pbnQgJHtleGVjdXRlRW5kcG9pbnR9IGZhaWxlZCwgdHJ5aW5nIG5leHQuLi5gKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gSWYgd2UgZ2V0IGhlcmUsIGFsbCBlbmRwb2ludHMgZmFpbGVkXG4gICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHJ1biB0b29sICR7dG9vbE5hbWV9IG9uIE1DUCBzZXJ2ZXIgYXQgJHtlbmRwb2ludH1gKTtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHJ1bm5pbmcgdG9vbCAke3Rvb2xOYW1lfSBvbiBNQ1Agc2VydmVyIGF0ICR7ZW5kcG9pbnR9OmAsIGVycm9yKTtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9O1xuICB9XG59XG5cbi8qKlxuICogVXBkYXRlIHNlcnZlciB2ZXJpZmljYXRpb24gc3RhdHVzIGluIER5bmFtb0RCXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihcbiAgc2VydmVySWQ6IHN0cmluZyxcbiAgdmVyaWZpZWQ6IGJvb2xlYW4sXG4gIHZlcmlmaWNhdGlvbkRhdGE6IGFueVxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgLy8gUHJlcGFyZSB1cGRhdGUgZXhwcmVzc2lvbiBhbmQgYXR0cmlidXRlIHZhbHVlc1xuICAgIGxldCB1cGRhdGVFeHByZXNzaW9uID0gJ1NFVCB2ZXJpZmllZCA9IDp2ZXJpZmllZCc7XG4gICAgY29uc3QgZXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICc6dmVyaWZpZWQnOiB2ZXJpZmllZCxcbiAgICAgICc6bGFzdFVwZGF0ZWQnOiBEYXRlLm5vdygpXG4gICAgfTtcbiAgICBcbiAgICAvLyBBZGQgYWxsIHZlcmlmaWNhdGlvbiBkYXRhIHRvIHVwZGF0ZSBleHByZXNzaW9uXG4gICAgT2JqZWN0LmVudHJpZXModmVyaWZpY2F0aW9uRGF0YSkuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICB1cGRhdGVFeHByZXNzaW9uICs9IGAsICR7a2V5fSA9IDoke2tleX1gO1xuICAgICAgZXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlc1tgOiR7a2V5fWBdID0gdmFsdWU7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gQWRkIGxhc3RVcGRhdGVkIHRpbWVzdGFtcFxuICAgIHVwZGF0ZUV4cHJlc3Npb24gKz0gJywgbGFzdFVwZGF0ZWQgPSA6bGFzdFVwZGF0ZWQnO1xuICAgIFxuICAgIC8vIFVwZGF0ZSBEeW5hbW9EQlxuICAgIGNvbnN0IHVwZGF0ZUNvbW1hbmQgPSBuZXcgVXBkYXRlQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IFRBQkxFX05BTUUsXG4gICAgICBLZXk6IHsgU2VydmVySWQ6IHNlcnZlcklkIH0sXG4gICAgICBVcGRhdGVFeHByZXNzaW9uOiB1cGRhdGVFeHByZXNzaW9uLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczogZXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlcyxcbiAgICAgIFJldHVyblZhbHVlczogJ0FMTF9ORVcnXG4gICAgfSk7XG4gICAgXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQodXBkYXRlQ29tbWFuZCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgc2VydmVyIHZlcmlmaWNhdGlvbiBpbiBEeW5hbW9EQiBmb3IgJHtzZXJ2ZXJJZH06YCwgZXJyb3IpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufSAiXX0=