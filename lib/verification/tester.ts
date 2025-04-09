import axios from 'axios';
import { launchContainer, stopContainer } from '../aws/fargate';

// Repository server metadata interface
export interface MCPRepository {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  url: string;
  stars: number;
  forks: number;
  topics: string[];
  lastUpdated: string;
  discoveredAt: number;
  verified: boolean;
  // Verification fields
  endpoint?: string;
  toolCount?: number;
  sampleTool?: string;
  sampleOutput?: string;
  sampleRunSuccess?: boolean;
  lastTested?: string;
  status?: string;
  taskArn?: string;
}

// Tool definition from an MCP server
interface MCPTool {
  name: string;
  description: string;
  inputSchema?: any;
}

// Map of known repositories to Docker images
const KNOWN_IMAGES: Record<string, string> = {
  'github/mcp-github': 'ghcr.io/github/mcp-server',
  'openai/mcp-reference': 'ghcr.io/openai/mcp-reference',
  // Add more mappings as needed
  '_default_': 'ghcr.io/mcp-community/reference-server' // Fallback image
};

/**
 * Get Docker image for a repository
 * 
 * @param {string} fullName - Repository full name
 * @returns {string} Docker image URI
 */
function getImageForRepo(fullName: string): string {
  return KNOWN_IMAGES[fullName] || KNOWN_IMAGES['_default_'];
}

/**
 * Test if an MCP server is accessible at the given endpoint
 * 
 * @param {string} endpoint - Server endpoint URL
 * @returns {Promise<boolean>} True if server is accessible
 */
async function testServerConnection(endpoint: string): Promise<boolean> {
  try {
    // Remove trailing slash if present
    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    
    // Try to connect to the server
    const response = await axios.get(`${cleanEndpoint}/`, {
      timeout: 5000 // 5 second timeout
    });
    
    return response.status === 200;
  } catch (error) {
    console.error(`Failed to connect to MCP server at ${endpoint}:`, error);
    return false;
  }
}

/**
 * List tools available from an MCP server
 * 
 * @param {string} endpoint - Server endpoint URL
 * @returns {Promise<MCPTool[] | null>} Array of tools or null if failed
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
 * 
 * @param {string} endpoint - Server endpoint URL
 * @param {string} toolName - Name of the tool to run
 * @param {any} input - Input parameters for the tool
 * @returns {Promise<{success: boolean, output?: any}>} Tool execution result
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
        console.log(`Endpoint ${executeEndpoint} failed, trying next...`);
      }
    }
    
    // If we get here, all endpoints failed
    console.error(`Failed to execute tool ${toolName} on MCP server at ${endpoint}`);
    return { success: false };
  } catch (error) {
    console.error(`Error executing tool ${toolName} on MCP server at ${endpoint}:`, error);
    return { success: false };
  }
}

/**
 * Verify an MCP server and update its metadata
 * 
 * @param {MCPRepository} server - Server metadata
 * @returns {Promise<MCPRepository>} Updated server metadata
 */
export async function verifyServer(server: MCPRepository): Promise<MCPRepository> {
  console.log(`Verifying MCP server: ${server.fullName}`);
  
  // Initialize verification fields
  const verifiedServer: MCPRepository = {
    ...server,
    verified: false,
    toolCount: 0,
    lastTested: new Date().toISOString()
  };
  
  try {
    let endpoint = '';
    let taskArn = '';
    let launchedContainer = false;
    
    // Check if server has a known endpoint
    if (server.endpoint) {
      console.log(`Using provided endpoint: ${server.endpoint}`);
      endpoint = server.endpoint;
    } else {
      // Launch container for testing
      console.log(`No endpoint provided, launching container for ${server.fullName}`);
      
      const image = getImageForRepo(server.fullName);
      console.log(`Using image: ${image}`);
      
      const serverName = `mcp-tester-${server.fullName.replace('/', '-')}`;
      
      const launchResult = await launchContainer({
        image,
        serverName,
        containerPort: 8000
      });
      
      if (!launchResult.success || !launchResult.endpoint) {
        verifiedServer.status = `Failed to launch container: ${launchResult.error || 'Unknown error'}`;
        return verifiedServer;
      }
      
      endpoint = launchResult.endpoint;
      taskArn = launchResult.taskArn || '';
      launchedContainer = true;
      
      verifiedServer.endpoint = endpoint;
      verifiedServer.taskArn = taskArn;
      
      console.log(`Container launched at ${endpoint}`);
      
      // Wait for container to start properly
      console.log('Waiting 5 seconds for container to initialize...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Test server connection
    const isConnected = await testServerConnection(endpoint);
    if (!isConnected) {
      verifiedServer.status = 'Failed to connect to server';
      
      // Stop container if we launched it
      if (launchedContainer && taskArn) {
        await stopContainer(taskArn);
      }
      
      return verifiedServer;
    }
    
    // List tools
    const tools = await listServerTools(endpoint);
    if (!tools) {
      verifiedServer.status = 'Failed to list tools';
      verifiedServer.toolCount = 0;
      
      // Stop container if we launched it
      if (launchedContainer && taskArn) {
        await stopContainer(taskArn);
      }
      
      return verifiedServer;
    }
    
    verifiedServer.toolCount = tools.length;
    
    if (tools.length === 0) {
      verifiedServer.status = 'No tools available';
      
      // Stop container if we launched it
      if (launchedContainer && taskArn) {
        await stopContainer(taskArn);
      }
      
      return verifiedServer;
    }
    
    // Select a sample tool
    const sampleTool = tools[0];
    verifiedServer.sampleTool = sampleTool.name;
    
    // Run the sample tool
    console.log(`Running sample tool: ${sampleTool.name}`);
    const runResult = await runSampleTool(endpoint, sampleTool.name);
    
    verifiedServer.sampleRunSuccess = runResult.success;
    if (runResult.output) {
      // Limit output size
      verifiedServer.sampleOutput = JSON.stringify(runResult.output).slice(0, 500);
    }
    
    // Mark as verified if tool execution succeeded
    verifiedServer.verified = runResult.success;
    verifiedServer.status = runResult.success ? 'OK' : 'Tool execution failed';
    
    // Stop container if we launched it
    if (launchedContainer && taskArn) {
      console.log(`Stopping container: ${taskArn}`);
      await stopContainer(taskArn);
    }
    
    return verifiedServer;
  } catch (error) {
    console.error(`Error verifying server ${server.fullName}:`, error);
    
    verifiedServer.status = `Error during verification: ${error instanceof Error ? error.message : String(error)}`;
    
    // Stop container if task ARN is available
    if (verifiedServer.taskArn) {
      try {
        await stopContainer(verifiedServer.taskArn);
      } catch (stopError) {
        console.error(`Error stopping container:`, stopError);
      }
    }
    
    return verifiedServer;
  }
}

/**
 * Verify multiple MCP servers
 * 
 * @param {MCPRepository[]} servers - Array of server metadata
 * @returns {Promise<MCPRepository[]>} Updated server metadata
 */
export async function verifyServers(servers: MCPRepository[]): Promise<MCPRepository[]> {
  console.log(`Starting verification of ${servers.length} MCP servers...`);
  
  const verifiedServers: MCPRepository[] = [];
  
  // Process servers sequentially to avoid overloading AWS
  for (const server of servers) {
    try {
      const verifiedServer = await verifyServer(server);
      verifiedServers.push(verifiedServer);
    } catch (error) {
      console.error(`Error processing server ${server.fullName}:`, error);
      verifiedServers.push({
        ...server,
        verified: false,
        status: `Error during verification: ${error instanceof Error ? error.message : String(error)}`,
        lastTested: new Date().toISOString()
      });
    }
  }
  
  console.log(`Completed verification of ${servers.length} MCP servers.`);
  return verifiedServers;
} 