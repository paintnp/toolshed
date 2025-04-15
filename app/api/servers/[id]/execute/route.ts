import { NextResponse } from "next/server";
import { getServer } from "@/lib/db/dynamodb";
import axios from "axios";
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { getPlaygroundConfig } from "@/lib/aws/config";

// Ensure route is not cached
export const dynamic = "force-dynamic";

// Create ECS client
const ecsClient = new ECSClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

export async function POST(request: Request, context: { params: { id: string } }) {
  const serverId = context.params.id;

  try {
    // Get server from DynamoDB
    const server = await getServer(serverId);
    
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    // Check if server has a taskArn (running in playground)
    if (!server.taskArn) {
      return NextResponse.json(
        { success: false, error: "Server is not running in playground mode" },
        { status: 400 }
      );
    }

    // Parse the request body
    const body = await request.json();
    const { command } = body;

    // Validate required fields
    if (!command) {
      return NextResponse.json(
        { success: false, error: "Command is required" },
        { status: 400 }
      );
    }

    // Get the container's network information from ECS
    const playgroundConfig = await getPlaygroundConfig();
    
    // Get task details from ECS
    const describeTasksCommand = new DescribeTasksCommand({
      cluster: playgroundConfig.cluster || "default",
      tasks: [server.taskArn]
    });
    
    const taskDetails = await ecsClient.send(describeTasksCommand);
    
    // Check for failures or missing tasks
    if (!taskDetails.tasks || taskDetails.tasks.length === 0) {
      return NextResponse.json(
        { success: false, error: "Task not found or not running" },
        { status: 404 }
      );
    }
    
    // Extract relevant information from the task
    const task = taskDetails.tasks[0];
    const status = task.lastStatus || 'UNKNOWN';
    
    if (status !== 'RUNNING') {
      return NextResponse.json(
        { success: false, error: `Task is not running. Current status: ${status}` },
        { status: 400 }
      );
    }

    // Find the private IP for direct AWS network access or public IP for external access
    let containerEndpoint;
    const containerPort = process.env.MCP_SERVER_PORT || '8000';
    
    if (task.attachments) {
      const networkAttachment = task.attachments.find(attachment => 
        attachment.type === 'ElasticNetworkInterface'
      );
      
      if (networkAttachment && networkAttachment.details) {
        // Try private IP first for internal network communication
        const privateIpDetail = networkAttachment.details.find(detail => 
          detail.name === 'privateIPv4Address'
        );
        
        if (privateIpDetail && privateIpDetail.value) {
          containerEndpoint = `http://${privateIpDetail.value}:${containerPort}`;
          console.log(`Using private IP endpoint: ${containerEndpoint}`);
        } else {
          // Fall back to public IP if available
          const publicIpDetail = networkAttachment.details.find(detail => 
            detail.name === 'publicIp'
          );
          
          if (publicIpDetail && publicIpDetail.value) {
            containerEndpoint = `http://${publicIpDetail.value}:${containerPort}`;
            console.log(`Using public IP endpoint: ${containerEndpoint}`);
          }
        }
      }
    }
    
    if (!containerEndpoint) {
      return NextResponse.json(
        { success: false, error: "Failed to determine container endpoint" },
        { status: 500 }
      );
    }

    // Parse command to extract tool name and parameters
    const commandParts = parseCommand(command);
    const toolName = commandParts.tool;
    const params = commandParts.params;
    
    console.log(`Executing tool: ${toolName} with params:`, params);

    try {
      // Try multiple endpoint patterns
      // First, try the SSE endpoint with JSON-RPC which is the preferred MCP protocol
      const sseEndpoint = `${containerEndpoint}/sse`;
      
      try {
        console.log(`Trying SSE endpoint: ${sseEndpoint}`);
        
        // Prepare a standard JSONRPC request
        const rpcRequest = {
          jsonrpc: "2.0",
          id: `request-${Date.now()}`,
          method: toolName,
          params: params
        };
        
        // Execute via JSONRPC
        const response = await axios.post(sseEndpoint, rpcRequest, {
          timeout: 30000, // 30s timeout for longer operations
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log("SSE response:", response.data);
        
        // Format the response in a readable way
        let formattedResult;
        if (response.data.result !== undefined) {
          formattedResult = response.data.result;
        } else {
          formattedResult = response.data;
        }
        
        return NextResponse.json({
          success: true,
          output: typeof formattedResult === 'object' 
            ? JSON.stringify(formattedResult, null, 2) 
            : String(formattedResult)
        });
      } catch (sseError) {
        console.error("Error with SSE endpoint:", sseError);
        
        // Fall back to traditional endpoints
        const executeEndpoints = [
          `${containerEndpoint}/execute`,
          `${containerEndpoint}/run`,
          `${containerEndpoint}/v1/execute`,
          `${containerEndpoint}/api/execute`
        ];
        
        let response = null;
        let error = null;
        
        // Payload for standard MCP HTTP API
        const payload = {
          tool: toolName,
          input: params
        };
        
        // Try each endpoint until one works
        for (const executeEndpoint of executeEndpoints) {
          try {
            console.log(`Trying endpoint: ${executeEndpoint}`);
            response = await axios.post(executeEndpoint, payload, {
              timeout: 30000, // 30s timeout for longer operations
              headers: {
                'Content-Type': 'application/json'
              }
            });
            
            if (response.status >= 200 && response.status < 300) {
              break;
            }
          } catch (e) {
            error = e;
            console.log(`Execute endpoint ${executeEndpoint} failed, trying next...`);
          }
        }
        
        if (!response) {
          throw new Error(`Failed to execute command: ${error?.message || 'All endpoints failed'}`);
        }
        
        // Format the response in a readable way
        return NextResponse.json({
          success: true,
          output: typeof response.data === 'object' 
            ? JSON.stringify(response.data, null, 2) 
            : String(response.data)
        });
      }
    } catch (error) {
      console.error("Error executing command on MCP server:", error);
      return NextResponse.json(
        { 
          success: false, 
          error: error instanceof Error ? error.message : "Failed to execute command on MCP server" 
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error executing tool:", error);
    return NextResponse.json(
      { success: false, error: "Invalid request format" },
      { status: 400 }
    );
  }
}

// Helper function to parse the command and extract parameters
function parseCommand(command: string) {
  // Match a function call pattern: functionName(param1="value", param2=123)
  const funcCallMatch = command.match(/^(\w+)\s*\((.*)\)$/);
  
  if (funcCallMatch) {
    const tool = funcCallMatch[1];
    const paramString = funcCallMatch[2];
    const params: Record<string, any> = {};
    
    // Parse named parameters with proper string and number handling
    // This regex handles quoted strings, numbers, and booleans
    const paramRegex = /(\w+)\s*=\s*(?:"([^"]*)"|(true|false|\d+(?:\.\d+)?)|'([^']*)'|([^,)]+))/g;
    let match;
    
    while ((match = paramRegex.exec(paramString)) !== null) {
      const paramName = match[1];
      // Check which capture group has the value (string in quotes, boolean/number, string in single quotes, or bare value)
      const value = match[2] !== undefined ? match[2] : 
                    match[3] !== undefined ? (match[3] === 'true' ? true : 
                                             match[3] === 'false' ? false : 
                                             Number(match[3])) :
                    match[4] !== undefined ? match[4] :
                    match[5];
      params[paramName] = value;
    }
    
    return { tool, params };
  }
  
  // Simple case: just a tool name
  if (/^\w+$/.test(command)) {
    return { tool: command, params: {} };
  }
  
  // Fallback: unknown format, pass as a "command" parameter
  return { tool: "execute", params: { command } };
} 