// Import required AWS SDK modules
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

// Set up AWS region
const region = process.env.AWS_REGION || 'us-east-1';

// Create Step Functions client
const sfnClient = new SFNClient({ region });

// State machine ARN - replace with your actual ARN
const VALIDATION_STATE_MACHINE_ARN = process.env.VALIDATION_STATE_MACHINE_ARN || 
  'arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline';

/**
 * Start the validation pipeline for an MCP server using Step Functions
 */
async function startServerValidation(server) {
  try {
    // Sanitize repository name (replace slashes with hyphens)
    const sanitizedRepoName = server.fullName.replace(/\//g, '-');
    
    // Prepare input for state machine execution
    const input = {
      serverId: server.ServerId,
      repositoryName: sanitizedRepoName,
      originalRepositoryName: server.fullName
    };

    console.log(`Starting validation pipeline for server ${server.ServerId}`);
    console.log(`Using state machine: ${VALIDATION_STATE_MACHINE_ARN}`);
    console.log('Input:', JSON.stringify(input, null, 2));
    
    // Start the Step Function execution
    const startCommand = new StartExecutionCommand({
      stateMachineArn: VALIDATION_STATE_MACHINE_ARN,
      input: JSON.stringify(input),
      name: `Validation-${server.ServerId.replace(/[^a-zA-Z0-9-_]/g, '-')}-${Date.now()}`
    });

    const response = await sfnClient.send(startCommand);
    
    console.log(`Started execution: ${response.executionArn}`);
    return {
      success: true,
      executionArn: response.executionArn
    };
  } catch (error) {
    console.error('Error starting validation pipeline:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Create a server record for the GitHub MCP Server
const server = {
  ServerId: 'github-mcp-server',
  name: 'github-mcp-server',
  fullName: 'github/github-mcp-server',
  url: 'https://github.com/github/github-mcp-server',
  discoveredAt: Date.now(),
  verified: false
};

// Start validation and log the result
startServerValidation(server)
  .then(result => {
    console.log('Validation started:', result);
    if (result.executionArn) {
      console.log(`To check status: aws stepfunctions describe-execution --execution-arn "${result.executionArn}"`);
    }
  })
  .catch(error => {
    console.error('Validation failed:', error);
  });

/**
 * Function to trigger validation for a repository
 * 
 * @param {string} repositoryName - The repository name in the format "owner/repo"
 * @param {string} serverId - Optional server ID (defaults to the repository name with slashes replaced by hyphens)
 * @returns {Promise<object>} The Step Functions execution result
 */
async function triggerValidation(repositoryName, serverId = repositoryName.replace(/\//g, '-')) {
  // Prepare input for the state machine execution
  const input = {
    serverId,
    repositoryName: repositoryName.replace(/\//g, '-'),
    originalRepositoryName: repositoryName
  };
  
  console.log('Starting validation pipeline for server', serverId);
  console.log('Using state machine:', VALIDATION_STATE_MACHINE_ARN);
  console.log('Input:', JSON.stringify(input, null, 2));
  
  // Start the Step Function execution
  const startCommand = new StartExecutionCommand({
    stateMachineArn: VALIDATION_STATE_MACHINE_ARN,
    input: JSON.stringify(input),
    name: `Validation-${serverId.replace(/[^a-zA-Z0-9-_]/g, '-')}-${Date.now()}`
  });
  
  try {
    const response = await sfnClient.send(startCommand);
    console.log('Started execution:', response.executionArn);
    console.log('Validation started:', {
      success: true,
      executionArn: response.executionArn
    });
    
    console.log('To check status:', `aws stepfunctions describe-execution --execution-arn "${response.executionArn}"`);
    return response;
  } catch (error) {
    console.error('Error starting validation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Trigger validation for the GitHub MCP server
triggerValidation('github/github-mcp-server', 'github-mcp-server')
  .catch(console.error);

// Function to trigger validation for a non-existent repository
async function testFailure() {
  console.log('\n\nTESTING FAILURE CASE:');
  await triggerValidation('nonexistent/repo', 'nonexistent-repo');
}

// Wait 5 seconds and then trigger the failure case
setTimeout(testFailure, 5000); 