import axios from 'axios';
import { launchContainer, stopContainer } from '../aws/fargate';
import { 
  saveServer, 
  updateServerVerification, 
  getServer, 
  ServerRecord 
} from '../db/dynamodb';
import { Octokit } from '@octokit/rest';

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
  tools?: MCPTool[];
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

// GitHub API client configuration
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'ToolShed-MCP-Verifier',
});

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
    
    console.log(`Starting connection tests to ${cleanEndpoint}/`);
    
    // Try to connect to the server with multiple retries
    let connected = false;
    let retries = 0;
    const maxRetries = 15; // Increased retries
    
    while (!connected && retries < maxRetries) {
      retries++;
      try {
        console.log(`Connection attempt ${retries}/${maxRetries} to ${cleanEndpoint}/`);
        const response = await axios.get(`${cleanEndpoint}/`, {
          timeout: 15000 // 15 second timeout (increased)
        });
        
        if (response.status === 200) {
          console.log(`Successfully connected to MCP server at ${cleanEndpoint}/`);
          connected = true;
          break;
        }
      } catch (error) {
        console.log(`Connection attempt ${retries} failed, waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between retries (increased)
      }
    }
    
    return connected;
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
 * Convert MCPRepository to a ServerRecord for DynamoDB
 * 
 * @param {MCPRepository} repo - Repository metadata
 * @returns {ServerRecord} Server record for DynamoDB
 */
function convertToServerRecord(repo: MCPRepository): ServerRecord {
  return {
    ServerId: repo.fullName,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description || '',
    language: repo.language || undefined,
    url: repo.url,
    stars: repo.stars,
    forks: repo.forks,
    topics: repo.topics,
    discoveredAt: repo.discoveredAt,
    verified: repo.verified,
    toolCount: repo.toolCount,
    tools: repo.tools as any[],
    lastTested: repo.lastTested ? new Date(repo.lastTested).getTime() : undefined,
    status: repo.status,
    endpoint: repo.endpoint
  };
}

/**
 * Verify an MCP server and update its metadata
 * 
 * @param {MCPRepository} server - Server metadata
 * @param {boolean} [saveToDb=true] - Whether to save results to DynamoDB
 * @returns {Promise<MCPRepository>} Updated server metadata
 */
export async function verifyServer(
  server: MCPRepository,
  saveToDb: boolean = true
): Promise<MCPRepository> {
  console.log(`Verifying MCP server: ${server.fullName}`);
  
  // Initialize verification fields
  const verifiedServer: MCPRepository = {
    ...server,
    verified: false,
    toolCount: 0,
    lastTested: new Date().toISOString()
  };
  
  try {
    // If saving to DB, check if server exists first
    if (saveToDb) {
      try {
        const existingServer = await getServer(server.fullName);
        if (existingServer) {
          console.log(`Server ${server.fullName} found in DynamoDB, using existing data`);
          // Merge existing data with current server
          verifiedServer.verified = existingServer.verified;
          verifiedServer.toolCount = existingServer.toolCount;
          verifiedServer.tools = existingServer.tools;
          verifiedServer.lastTested = existingServer.lastTested ? new Date(existingServer.lastTested).toISOString() : undefined;
          verifiedServer.status = existingServer.status;
          verifiedServer.endpoint = existingServer.endpoint;
        }
      } catch (dbError) {
        console.error(`Error checking server ${server.fullName} in DynamoDB:`, dbError);
      }
    }
    
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
        
        // Save to DynamoDB if enabled
        if (saveToDb) {
          try {
            await updateServerVerification(
              server.fullName,
              false,
              {
                status: verifiedServer.status,
                lastTested: Date.now()
              }
            );
          } catch (dbError) {
            console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
          }
        }
        
        return verifiedServer;
      }
      
      endpoint = launchResult.endpoint;
      taskArn = launchResult.taskArn || '';
      launchedContainer = true;
      
      verifiedServer.endpoint = endpoint;
      verifiedServer.taskArn = taskArn;
      
      console.log(`Container launched at ${endpoint}`);
      
      // ALBs take time to fully initialize, wait longer
      console.log('Waiting for ALB to initialize (120 seconds)...');
      await new Promise(resolve => setTimeout(resolve, 120000)); // Wait 2 minutes for ALB to fully initialize
    }
    
    // Test server connection
    const isConnected = await testServerConnection(endpoint);
    if (!isConnected) {
      verifiedServer.status = 'Failed to connect to server via ALB';
      
      if (launchedContainer && taskArn) {
        console.log(`Stopping failed task: ${taskArn}`);
        await stopContainer(taskArn);
      }
      
      // Save to DynamoDB if enabled
      if (saveToDb) {
        try {
          await updateServerVerification(
            server.fullName,
            false,
            {
              status: verifiedServer.status,
              lastTested: Date.now(),
              endpoint: verifiedServer.endpoint
            }
          );
        } catch (dbError) {
          console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
        }
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
      
      // Save to DynamoDB if enabled
      if (saveToDb) {
        try {
          await updateServerVerification(
            server.fullName,
            false,
            {
              status: verifiedServer.status,
              toolCount: 0,
              lastTested: Date.now(),
              endpoint: verifiedServer.endpoint
            }
          );
        } catch (dbError) {
          console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
        }
      }
      
      return verifiedServer;
    }
    
    verifiedServer.toolCount = tools.length;
    verifiedServer.tools = tools;
    
    if (tools.length === 0) {
      verifiedServer.status = 'No tools available';
      
      // Stop container if we launched it
      if (launchedContainer && taskArn) {
        await stopContainer(taskArn);
      }
      
      // Save to DynamoDB if enabled
      if (saveToDb) {
        try {
          await updateServerVerification(
            server.fullName,
            false,
            {
              status: verifiedServer.status,
              toolCount: 0,
              tools: [],
              lastTested: Date.now(),
              endpoint: verifiedServer.endpoint
            }
          );
        } catch (dbError) {
          console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
        }
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
    
    // Save to DynamoDB if enabled
    if (saveToDb) {
      try {
        await updateServerVerification(
          server.fullName,
          verifiedServer.verified,
          {
            status: verifiedServer.status,
            toolCount: tools.length,
            tools,
            lastTested: Date.now(),
            endpoint: verifiedServer.endpoint,
            sampleTool: sampleTool.name,
            sampleOutput: verifiedServer.sampleOutput,
            sampleRunSuccess: runResult.success
          }
        );
      } catch (dbError) {
        console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
      }
    }
    
    // Stop container if we launched it
    if (launchedContainer && taskArn) {
      console.log(`Stopping container: ${taskArn}`);
      await stopContainer(taskArn);
    }
    
    return verifiedServer;
  } catch (error) {
    console.error(`Error verifying server ${server.fullName}:`, error);
    
    verifiedServer.status = `Error during verification: ${error instanceof Error ? error.message : String(error)}`;
    
    // Save to DynamoDB if enabled
    if (saveToDb) {
      try {
        await updateServerVerification(
          server.fullName,
          false,
          {
            status: verifiedServer.status,
            lastTested: Date.now()
          }
        );
      } catch (dbError) {
        console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
      }
    }
    
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
 * @param {boolean} [saveToDb=true] - Whether to save results to DynamoDB
 * @returns {Promise<MCPRepository[]>} Updated server metadata
 */
export async function verifyServers(
  servers: MCPRepository[],
  saveToDb: boolean = true
): Promise<MCPRepository[]> {
  console.log(`Starting verification of ${servers.length} MCP servers...`);
  
  const verifiedServers: MCPRepository[] = [];
  
  // Process servers sequentially to avoid overloading AWS
  for (const server of servers) {
    try {
      const verifiedServer = await verifyServer(server, saveToDb);
      verifiedServers.push(verifiedServer);
    } catch (error) {
      console.error(`Error processing server ${server.fullName}:`, error);
      
      const errorServer: MCPRepository = {
        ...server,
        verified: false,
        status: `Error during verification: ${error instanceof Error ? error.message : String(error)}`,
        lastTested: new Date().toISOString()
      };
      
      verifiedServers.push(errorServer);
      
      // Save error to DynamoDB if enabled
      if (saveToDb) {
        try {
          await updateServerVerification(
            server.fullName,
            false,
            {
              status: errorServer.status,
              lastTested: Date.now()
            }
          );
        } catch (dbError) {
          console.error(`Error updating verification status for ${server.fullName} in DynamoDB:`, dbError);
        }
      }
    }
  }
  
  console.log(`Completed verification of ${servers.length} MCP servers.`);
  return verifiedServers;
}

/**
 * Manually verify an MCP server from a GitHub repository name
 * This function adapts the manual verification flow to use the existing verification pipeline
 * 
 * @param {string} repoFullName - Repository full name (e.g., "owner/repo")
 * @returns {Promise<{verified: boolean, repoFullName: string, message?: string, details?: any}>}
 */
export async function verifyMCPServerFromGitHub(repoFullName: string): Promise<{
  verified: boolean;
  repoFullName: string;
  message?: string;
  details?: any;
}> {
  try {
    // Check if server already exists and is verified
    const existingServer = await getServer(repoFullName);
    if (existingServer && existingServer.verified) {
      return {
        verified: true,
        repoFullName,
        message: 'Server already verified',
        details: existingServer
      };
    }

    // Step 1: Fetch repository info from GitHub
    const [owner, repo] = repoFullName.split('/');
    
    if (!owner || !repo) {
      return {
        verified: false,
        repoFullName,
        message: 'Invalid repository name format. Expected "owner/repo"'
      };
    }
    
    try {
      const repoResponse = await octokit.repos.get({
        owner,
        repo,
      });
      
      if (!repoResponse.data) {
        return {
          verified: false,
          repoFullName,
          message: 'Repository not found'
        };
      }
      
      const repoData = repoResponse.data;
      
      // Fetch repository topics
      const topicsResponse = await octokit.repos.getAllTopics({
        owner,
        repo,
      });
      
      // Create repository metadata object
      const repoMetadata: MCPRepository = {
        id: repoFullName,
        name: repoData.name,
        fullName: repoFullName,
        description: repoData.description,
        language: repoData.language,
        url: repoData.html_url,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        topics: topicsResponse.data.names || [],
        lastUpdated: repoData.updated_at,
        discoveredAt: Date.now(),
        verified: false
      };
      
      // Step 2: Verify the server using our existing pipeline
      console.log(`Verifying manually added server: ${repoFullName}`);
      const verificationResult = await verifyServer(repoMetadata, true);
      
      return {
        verified: verificationResult.verified,
        repoFullName,
        message: verificationResult.status,
        details: verificationResult
      };
    } catch (error) {
      console.error(`Error fetching repository data: ${error}`);
      return {
        verified: false,
        repoFullName,
        message: `Repository error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  } catch (error) {
    console.error(`Error in verification pipeline: ${error}`);
    return {
      verified: false,
      repoFullName,
      message: `Verification error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 