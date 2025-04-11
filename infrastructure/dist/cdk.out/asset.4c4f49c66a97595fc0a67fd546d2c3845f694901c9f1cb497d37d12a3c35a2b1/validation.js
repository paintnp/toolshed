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
            sampleToolResult = await runSampleTool(endpoint, sampleTool);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsaWRhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2Nkay5vdXQvYXNzZXQuNGM0ZjQ5YzY2YTk3NTk1ZmMwYTY3ZmQ1NDZkMmMzODQ1ZjY5NDkwMWM5ZjFjYjQ5N2QzN2QxMmEzYzM1YTJiMS92YWxpZGF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDhEQUEwRDtBQUMxRCx3REFBOEU7QUFDOUUsaUNBQTBCO0FBRTFCLHdCQUF3QjtBQUN4QixNQUFNLFNBQVMsR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ3pFLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN6RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsSUFBSSxpQkFBaUIsQ0FBQztBQVNuRTs7R0FFRztBQUNJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUFVLEVBQWdCLEVBQUU7SUFDeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvRCxJQUFJLENBQUM7UUFDSCxxQ0FBcUM7UUFDckMsTUFBTSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlDLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLHFFQUFxRSxDQUFDLENBQUM7UUFDekYsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLFFBQVEsZ0JBQWdCLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFekUseUJBQXlCO1FBQ3pCLE1BQU0sV0FBVyxHQUFH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QUFDLEdBQUcsS0FBSyxDQUFDO1FBQy9DLENBQUMsQ0FBQyxDQUFDO1FBRUgsNEJBQTRCO1FBQzVCLGdCQUFnQixJQUFJLDhCQUE4QixDQUFDO1FBRW5ELGtCQUFrQjtRQUNsQixNQUFNLGFBQWEsR0FBRyxJQUFJLDRCQUFhLENBQUM7WUFDdEMsU0FBUyxFQUFFLFVBQVU7WUFDckIsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtZQUMzQixnQkFBZ0IsRUFBRSxnQkFBZ0I7WUFDbEMseUJBQXlCLEVBQUUseUJBQXlCO1lBQ3BELFlBQVksRUFBRSxTQUFTO1NBQ3hCLENBQUMsQ0FBQztRQUVILE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNwQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxzREFBc0QsUUFBUSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDeEYsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFVwZGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcblxuLy8gRHluYW1vREIgY2xpZW50IHNldHVwXG5jb25zdCBkZGJDbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZGRiQ2xpZW50KTtcbmNvbnN0IFRBQkxFX05BTUUgPSBwcm9jZXNzLmVudi5EWU5BTU9EQl9UQUJMRSB8fCAnVG9vbFNoZWRTZXJ2ZXJzJztcblxuLy8gSW50ZXJmYWNlIGZvciBNQ1AgdG9vbFxuaW50ZXJmYWNlIE1DUFRvb2wge1xuICBuYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGlucHV0U2NoZW1hPzogYW55O1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbiBNQ1Agc2VydmVyIGVuZHBvaW50IGFuZCB1cGRhdGVzIER5bmFtb0RCIHdpdGggcmVzdWx0c1xuICovXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogYW55KTogUHJvbWlzZTxhbnk+ID0+IHtcbiAgY29uc29sZS5sb2coJ0V2ZW50IHJlY2VpdmVkOicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG4gIFxuICB0cnkge1xuICAgIC8vIEV4dHJhY3QgaW5mb3JtYXRpb24gZnJvbSB0aGUgZXZlbnRcbiAgICBjb25zdCB7IHNlcnZlcklkLCBlbmRwb2ludCwgdGFza0FybiB9ID0gZXZlbnQ7XG4gICAgXG4gICAgaWYgKCFzZXJ2ZXJJZCB8fCAhZW5kcG9pbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXJzOiBzZXJ2ZXJJZCBhbmQgZW5kcG9pbnQgbXVzdCBiZSBwcm92aWRlZCcpO1xuICAgIH1cbiAgICBcbiAgICBjb25zb2xlLmxvZyhgVmFsaWRhdGluZyBNQ1Agc2VydmVyICR7c2VydmVySWR9IGF0IGVuZHBvaW50ICR7ZW5kcG9pbnR9YCk7XG4gICAgXG4gICAgLy8gVGVzdCBzZXJ2ZXIgY29ubmVjdGlvblxuICAgIGNvbnN0IGlzQ29ubmVjdGVkID0gYXdhaXQgdGVzdFNlcnZlckNvbm5lY3Rpb24oZW5kcG9pbnQpO1xuICAgIGlmICghaXNDb25uZWN0ZWQpIHtcbiAgICAgIGF3YWl0IHVwZGF0ZVNlcnZlclZlcmlmaWNhdGlvbihzZXJ2ZXJJZCwgZmFsc2UsIHtcbiAgICAgICAgc3RhdHVzOiAnQ29ubmVjdGlvbiBmYWlsZWQnLFxuICAgICAgICBsYXN0VGVzdGVkOiBEYXRlLm5vdygpLFxuICAgICAgICB0YXNrQXJuLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB2ZXJpZmllZDogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogJ0ZhaWxlZCB0byBjb25uZWN0IHRvIHNlcnZlcicsXG4gICAgICAgICAgc2VydmVySWRcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gTGlzdCB0b29sc1xuICAgIGNvbnN0IHRvb2xzID0gYXdhaXQgbGlzdFNlcnZlclRvb2xzKGVuZHBvaW50KTtcbiAgICBpZiAoIXRvb2xzIHx8IHRvb2xzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKHNlcnZlcklkLCBmYWxzZSwge1xuICAgICAgICBzdGF0dXM6ICdObyB0b29scyBmb3VuZCcsXG4gICAgICAgIGxhc3RUZXN0ZWQ6IERhdGUubm93KCksXG4gICAgICAgIHRhc2tBcm4sXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHZlcmlmaWVkOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiAnTm8gdG9vbHMgZm91bmQgb24gc2VydmVyJyxcbiAgICAgICAgICBzZXJ2ZXJJZFxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBUcnkgYSBzYW1wbGUgdG9vbCBpZiBhdmFpbGFibGVcbiAgICBsZXQgc2FtcGxlVG9vbFJlc3VsdCA9IHsgc3VjY2VzczogZmFsc2UsIG91dHB1dDogbnVsbCB9O1xuICAgIGlmICh0b29scy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzYW1wbGVUb29sID0gdG9vbHNbMF0ubmFtZTtcbiAgICAgIHNhbXBsZVRvb2xSZXN1bHQgPSBhd2FpdCBydW5TYW1wbGVUb29sKGVuZHBvaW50LCBzYW1wbGVUb29sKTtcbiAgICB9XG4gICAgXG4gICAgLy8gVXBkYXRlIER5bmFtb0RCIHdpdGggdmVyaWZpY2F0aW9uIHJlc3VsdHNcbiAgICBhd2FpdCB1cGRhdGVTZXJ2ZXJWZXJpZmljYXRpb24oc2VydmVySWQsIHRydWUsIHtcbiAgICAgIHRvb2xDb3VudDogdG9vbHMubGVuZ3RoLFxuICAgICAgdG9vbHMsXG4gICAgICBzdGF0dXM6ICdWZXJpZmllZCcsXG4gICAgICBsYXN0VGVzdGVkOiBEYXRlLm5vdygpLFxuICAgICAgZW5kcG9pbnQsXG4gICAgICB0YXNrQXJuLFxuICAgICAgc2FtcGxlVG9vbDogdG9vbHMubGVuZ3RoID4gMCA/IHRvb2xzWzBdLm5hbWUgOiAnJyxcbiAgICAgIHNhbXBsZU91dHB1dDogc2FtcGxlVG9vbFJlc3VsdC5vdXRwdXQgPyBKU09OLnN0cmluZ2lmeShzYW1wbGVUb29sUmVzdWx0Lm91dHB1dCkuc3Vic3RyaW5nKDAsIDEwMDApIDogJycsXG4gICAgICBzYW1wbGVSdW5TdWNjZXNzOiBzYW1wbGVUb29sUmVzdWx0LnN1Y2Nlc3NcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keToge1xuICAgICAgICB2ZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgbWVzc2FnZTogJ1NlcnZlciB2ZXJpZmllZCBzdWNjZXNzZnVsbHknLFxuICAgICAgICBzZXJ2ZXJJZCxcbiAgICAgICAgdG9vbENvdW50OiB0b29scy5sZW5ndGhcbiAgICAgIH1cbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHZhbGlkYXRpbmcgc2VydmVyOicsIGVycm9yKTtcbiAgICBcbiAgICAvLyBBdHRlbXB0IHRvIHVwZGF0ZSBEeW5hbW9EQiB3aXRoIGVycm9yXG4gICAgaWYgKGV2ZW50LnNlcnZlcklkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB1cGRhdGVTZXJ2ZXJWZXJpZmljYXRpb24oZXZlbnQuc2VydmVySWQsIGZhbHNlLCB7XG4gICAgICAgICAgc3RhdHVzOiBgRXJyb3I6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgbGFzdFRlc3RlZDogRGF0ZS5ub3coKSxcbiAgICAgICAgICB0YXNrQXJuOiBldmVudC50YXNrQXJuXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZGJFcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gdXBkYXRlIER5bmFtb0RCIHdpdGggZXJyb3I6JywgZGJFcnJvcik7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICBib2R5OiB7XG4gICAgICAgIHZlcmlmaWVkOiBmYWxzZSxcbiAgICAgICAgbWVzc2FnZTogYEVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgICBzZXJ2ZXJJZDogZXZlbnQuc2VydmVySWRcbiAgICAgIH1cbiAgICB9O1xuICB9XG59O1xuXG4vKipcbiAqIFRlc3QgaWYgYW4gTUNQIHNlcnZlciBpcyBhY2Nlc3NpYmxlIGF0IHRoZSBnaXZlbiBlbmRwb2ludFxuICovXG5hc3luYyBmdW5jdGlvbiB0ZXN0U2VydmVyQ29ubmVjdGlvbihlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgLy8gUmVtb3ZlIHRyYWlsaW5nIHNsYXNoIGlmIHByZXNlbnRcbiAgICBjb25zdCBjbGVhbkVuZHBvaW50ID0gZW5kcG9pbnQuZW5kc1dpdGgoJy8nKSA/IGVuZHBvaW50LnNsaWNlKDAsIC0xKSA6IGVuZHBvaW50O1xuICAgIFxuICAgIGNvbnNvbGUubG9nKGBUZXN0aW5nIGNvbm5lY3Rpb24gdG8gJHtjbGVhbkVuZHBvaW50fS9gKTtcbiAgICBcbiAgICAvLyBUcnkgdG8gY29ubmVjdCB0byB0aGUgc2VydmVyXG4gICAgbGV0IHJldHJpZXMgPSAwO1xuICAgIGNvbnN0IG1heFJldHJpZXMgPSA1O1xuICAgIFxuICAgIHdoaWxlIChyZXRyaWVzIDwgbWF4UmV0cmllcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoYCR7Y2xlYW5FbmRwb2ludH0vYCwge1xuICAgICAgICAgIHRpbWVvdXQ6IDUwMDAgLy8gNSBzZWNvbmQgdGltZW91dFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDIwMCkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBTdWNjZXNzZnVsbHkgY29ubmVjdGVkIHRvIE1DUCBzZXJ2ZXIgYXQgJHtjbGVhbkVuZHBvaW50fS9gKTtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3Rpb24gYXR0ZW1wdCAke3JldHJpZXMgKyAxfSBmYWlsZWQsIHJldHJ5aW5nLi4uYCk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIHJldHJpZXMrKztcbiAgICAgIGlmIChyZXRyaWVzIDwgbWF4UmV0cmllcykge1xuICAgICAgICAvLyBXYWl0IGJlZm9yZSByZXRyeVxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMzAwMCkpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gY29ubmVjdCB0byBNQ1Agc2VydmVyIGF0ICR7ZW5kcG9pbnR9IGFmdGVyICR7bWF4UmV0cmllc30gYXR0ZW1wdHNgKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgRXJyb3IgdGVzdGluZyBjb25uZWN0aW9uIHRvICR7ZW5kcG9pbnR9OmAsIGVycm9yKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBMaXN0IHRvb2xzIGF2YWlsYWJsZSBmcm9tIGFuIE1DUCBzZXJ2ZXJcbiAqL1xuYXN5bmMgZnVuY3Rpb24gbGlzdFNlcnZlclRvb2xzKGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPE1DUFRvb2xbXSB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICAvLyBSZW1vdmUgdHJhaWxpbmcgc2xhc2ggaWYgcHJlc2VudFxuICAgIGNvbnN0IGNsZWFuRW5kcG9pbnQgPSBlbmRwb2ludC5lbmRzV2l0aCgnLycpID8gZW5kcG9pbnQuc2xpY2UoMCwgLTEpIDogZW5kcG9pbnQ7XG4gICAgXG4gICAgLy8gVHJ5IGNvbW1vbiBlbmRwb2ludHMgZm9yIHRvb2wgbGlzdGluZ1xuICAgIGNvbnN0IGVuZHBvaW50cyA9IFtcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L3Rvb2xzYCxcbiAgICAgIGAke2NsZWFuRW5kcG9pbnR9L2xpc3RUb29sc2AsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS92MS90b29sc2AsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS9hcGkvdG9vbHNgXG4gICAgXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IHRvb2xzRW5kcG9pbnQgb2YgZW5kcG9pbnRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldCh0b29sc0VuZHBvaW50LCB7XG4gICAgICAgICAgdGltZW91dDogNTAwMCAvLyA1IHNlY29uZCB0aW1lb3V0XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gMjAwICYmIHJlc3BvbnNlLmRhdGEpIHtcbiAgICAgICAgICAvLyBDaGVjayBpZiByZXNwb25zZSBjb250YWlucyB0b29scyBhcnJheSBkaXJlY3RseSBvciBuZXN0ZWRcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNwb25zZS5kYXRhKSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGE7XG4gICAgICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS5kYXRhLnRvb2xzICYmIEFycmF5LmlzQXJyYXkocmVzcG9uc2UuZGF0YS50b29scykpIHtcbiAgICAgICAgICAgIHJldHVybiByZXNwb25zZS5kYXRhLnRvb2xzO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQ29udGludWUgdG8gbmV4dCBlbmRwb2ludCBvbiBmYWlsdXJlXG4gICAgICAgIGNvbnNvbGUubG9nKGBFbmRwb2ludCAke3Rvb2xzRW5kcG9pbnR9IGZhaWxlZCwgdHJ5aW5nIG5leHQuLi5gKTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gSWYgd2UgZ2V0IGhlcmUsIGFsbCBlbmRwb2ludHMgZmFpbGVkXG4gICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGxpc3QgdG9vbHMgZnJvbSBNQ1Agc2VydmVyIGF0ICR7ZW5kcG9pbnR9YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgRXJyb3IgbGlzdGluZyB0b29scyBmcm9tIE1DUCBzZXJ2ZXIgYXQgJHtlbmRwb2ludH06YCwgZXJyb3IpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUnVuIGEgc2FtcGxlIHRvb2wgb24gYW4gTUNQIHNlcnZlclxuICovXG5hc3luYyBmdW5jdGlvbiBydW5TYW1wbGVUb29sKFxuICBlbmRwb2ludDogc3RyaW5nLFxuICB0b29sTmFtZTogc3RyaW5nLFxuICBpbnB1dDogYW55ID0ge31cbik6IFByb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIG91dHB1dD86IGFueX0+IHtcbiAgdHJ5IHtcbiAgICAvLyBSZW1vdmUgdHJhaWxpbmcgc2xhc2ggaWYgcHJlc2VudFxuICAgIGNvbnN0IGNsZWFuRW5kcG9pbnQgPSBlbmRwb2ludC5lbmRzV2l0aCgnLycpID8gZW5kcG9pbnQuc2xpY2UoMCwgLTEpIDogZW5kcG9pbnQ7XG4gICAgXG4gICAgLy8gVHJ5IGNvbW1vbiBlbmRwb2ludHMgZm9yIHRvb2wgZXhlY3V0aW9uXG4gICAgY29uc3QgZW5kcG9pbnRzID0gW1xuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vZXhlY3V0ZWAsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS9ydW5gLFxuICAgICAgYCR7Y2xlYW5FbmRwb2ludH0vdjEvZXhlY3V0ZWAsXG4gICAgICBgJHtjbGVhbkVuZHBvaW50fS9hcGkvZXhlY3V0ZWBcbiAgICBdO1xuICAgIFxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICB0b29sOiB0b29sTmFtZSxcbiAgICAgIGlucHV0OiBpbnB1dFxuICAgIH07XG4gICAgXG4gICAgZm9yIChjb25zdCBleGVjdXRlRW5kcG9pbnQgb2YgZW5kcG9pbnRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLnBvc3QoZXhlY3V0ZUVuZHBvaW50LCBwYXlsb2FkLCB7XG4gICAgICAgICAgdGltZW91dDogMTAwMDAgLy8gMTAgc2Vjb25kIHRpbWVvdXRcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID49IDIwMCAmJiByZXNwb25zZS5zdGF0dXMgPCAzMDApIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIG91dHB1dDogcmVzcG9uc2UuZGF0YVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENvbnRpbnVlIHRvIG5leHQgZW5kcG9pbnQgb24gZmFpbHVyZVxuICAgICAgICBjb25zb2xlLmxvZyhgRXhlY3V0ZSBlbmRwb2ludCAke2V4ZWN1dGVFbmRwb2ludH0gZmFpbGVkLCB0cnlpbmcgbmV4dC4uLmApO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBJZiB3ZSBnZXQgaGVyZSwgYWxsIGVuZHBvaW50cyBmYWlsZWRcbiAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gcnVuIHRvb2wgJHt0b29sTmFtZX0gb24gTUNQIHNlcnZlciBhdCAke2VuZHBvaW50fWApO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgRXJyb3IgcnVubmluZyB0b29sICR7dG9vbE5hbWV9IG9uIE1DUCBzZXJ2ZXIgYXQgJHtlbmRwb2ludH06YCwgZXJyb3IpO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07XG4gIH1cbn1cblxuLyoqXG4gKiBVcGRhdGUgc2VydmVyIHZlcmlmaWNhdGlvbiBzdGF0dXMgaW4gRHluYW1vREJcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdXBkYXRlU2VydmVyVmVyaWZpY2F0aW9uKFxuICBzZXJ2ZXJJZDogc3RyaW5nLFxuICB2ZXJpZmllZDogYm9vbGVhbixcbiAgdmVyaWZpY2F0aW9uRGF0YTogYW55XG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICAvLyBQcmVwYXJlIHVwZGF0ZSBleHByZXNzaW9uIGFuZCBhdHRyaWJ1dGUgdmFsdWVzXG4gICAgbGV0IHVwZGF0ZUV4cHJlc3Npb24gPSAnU0VUIHZlcmlmaWVkID0gOnZlcmlmaWVkJztcbiAgICBjb25zdCBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgJzp2ZXJpZmllZCc6IHZlcmlmaWVkLFxuICAgICAgJzpsYXN0VXBkYXRlZCc6IERhdGUubm93KClcbiAgICB9O1xuICAgIFxuICAgIC8vIEFkZCBhbGwgdmVyaWZpY2F0aW9uIGRhdGEgdG8gdXBkYXRlIGV4cHJlc3Npb25cbiAgICBPYmplY3QuZW50cmllcyh2ZXJpZmljYXRpb25EYXRhKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgIHVwZGF0ZUV4cHJlc3Npb24gKz0gYCwgJHtrZXl9ID0gOiR7a2V5fWA7XG4gICAgICBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzW2A6JHtrZXl9YF0gPSB2YWx1ZTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGQgbGFzdFVwZGF0ZWQgdGltZXN0YW1wXG4gICAgdXBkYXRlRXhwcmVzc2lvbiArPSAnLCBsYXN0VXBkYXRlZCA9IDpsYXN0VXBkYXRlZCc7XG4gICAgXG4gICAgLy8gVXBkYXRlIER5bmFtb0RCXG4gICAgY29uc3QgdXBkYXRlQ29tbWFuZCA9IG5ldyBVcGRhdGVDb21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogVEFCTEVfTkFNRSxcbiAgICAgIEtleTogeyBTZXJ2ZXJJZDogc2VydmVySWQgfSxcbiAgICAgIFVwZGF0ZUV4cHJlc3Npb246IHVwZGF0ZUV4cHJlc3Npb24sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzLFxuICAgICAgUmV0dXJuVmFsdWVzOiAnQUxMX05FVydcbiAgICB9KTtcbiAgICBcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZCh1cGRhdGVDb21tYW5kKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciB1cGRhdGluZyBzZXJ2ZXIgdmVyaWZpY2F0aW9uIGluIER5bmFtb0RCIGZvciAke3NlcnZlcklkfTpgLCBlcnJvcik7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59ICJdfQ==