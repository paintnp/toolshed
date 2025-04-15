import { 
  ECSClient, 
  RunTaskCommand, 
  DescribeTasksCommand, 
  StopTaskCommand,
  TaskOverride,
  NetworkConfiguration,
  ContainerOverride,
  RegisterTaskDefinitionCommand,
  DescribeTaskDefinitionCommand,
  AssignPublicIp
} from "@aws-sdk/client-ecs";
import { 
  CloudWatchLogsClient, 
  CreateLogGroupCommand,
  DescribeLogGroupsCommand
} from "@aws-sdk/client-cloudwatch-logs";
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from "@aws-sdk/client-sfn";
import { ServerRecord } from '../db/dynamodb';
import { getNetworkConfig, getValidationConfig } from './config';

// Configuration defaults that will be overridden by fetched config
const DEFAULT_CONFIG = {
  taskDefinitionFamily: 'mcp-server-task',
  containerPort: 8000,  // Default port for MCP servers
  cpu: '512',  // 0.5 vCPU
  memory: '1024', // 1GB RAM
  assignPublicIp: AssignPublicIp.ENABLED as AssignPublicIp, // We need to connect to the server from outside
};

// Create ECS client with region from environment (will be the same as SSM client)
const ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Step Functions client
const sfnClient = new SFNClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Cached configuration to avoid repeated fetches
let cachedConfig: {
  cluster?: string;
  ecsClusterName?: string;
  subnets?: string[];
  securityGroups?: string[];
  executionRoleArn?: string;
  taskRoleArn?: string;
  stateMachineArn?: string;
} | null = null;

/**
 * Get the Fargate configuration - combines network and validation configs
 */
async function getFargateConfig() {
  if (cachedConfig) return cachedConfig;
  
  try {
    // Load network and validation config 
    const [networkConfig, validationConfig] = await Promise.all([
      getNetworkConfig(),
      getValidationConfig()
    ]);
    
    cachedConfig = {
      cluster: validationConfig.ecsClusterName,
      ecsClusterName: validationConfig.ecsClusterName,
      subnets: networkConfig.subnets,
      securityGroups: networkConfig.securityGroupId ? [networkConfig.securityGroupId] : [],
      executionRoleArn: process.env.AWS_EXECUTION_ROLE_ARN || '', // Still use env var for these roles
      taskRoleArn: process.env.AWS_TASK_ROLE_ARN || '',
      stateMachineArn: validationConfig.stateMachineArn
    };
    
    // Log the configuration
    console.log('Loaded Fargate configuration:', {
      cluster: cachedConfig.cluster,
      subnetCount: cachedConfig.subnets?.length || 0,
      securityGroupCount: cachedConfig.securityGroups?.length || 0,
      stateMachineArn: cachedConfig.stateMachineArn ? 'present' : 'missing'
    });
    
    return cachedConfig;
  } catch (error) {
    console.error('Error loading Fargate configuration:', error);
    
    // Fallback to environment variables as last resort
    return {
      cluster: process.env.AWS_ECS_CLUSTER || 'ToolShedCluster',
      ecsClusterName: process.env.AWS_ECS_CLUSTER || 'ToolShedCluster',
      subnets: process.env.AWS_SUBNETS ? process.env.AWS_SUBNETS.split(',') : [],
      securityGroups: process.env.AWS_SECURITY_GROUP_ID ? [process.env.AWS_SECURITY_GROUP_ID] : [],
      executionRoleArn: process.env.AWS_EXECUTION_ROLE_ARN || '',
      taskRoleArn: process.env.AWS_TASK_ROLE_ARN || '',
      stateMachineArn: process.env.VALIDATION_STATE_MACHINE_ARN || process.env.AWS_STATE_MACHINE_ARN || ''
    };
  }
}

/**
 * Wait for a task to reach a running state with adequate retries
 * 
 * @param {string} taskArn - The ARN of the task to wait for
 * @param {number} maxAttempts - Maximum number of retry attempts
 * @param {number} delayMs - Delay between retries in milliseconds 
 * @returns {Promise<{success: boolean, task?: any, error?: string}>}
 */
async function waitForTask(
  taskArn: string,
  maxAttempts: number = 10,
  delayMs: number = 5000
): Promise<{
  success: boolean;
  task?: any;
  error?: string;
}> {
  let attempts = 0;
  const config = await getFargateConfig();
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Waiting for task to reach RUNNING state (attempt ${attempts}/${maxAttempts})...`);
    
    try {
      const describeTasksCommand = new DescribeTasksCommand({
        cluster: config.cluster,
        tasks: [taskArn]
      });
      
      const taskDetails = await ecsClient.send(describeTasksCommand);
      
      if (!taskDetails.tasks || taskDetails.tasks.length === 0) {
        console.log('No task details returned yet');
        
        if (attempts === maxAttempts) {
          return { 
            success: false, 
            error: 'Task not found after maximum attempts' 
          };
        }
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      const task = taskDetails.tasks[0];
      const status = task.lastStatus || 'UNKNOWN';
      
      console.log(`Task status: ${status}`);
      
      if (status === 'RUNNING') {
        return { success: true, task };
      } else if (status === 'STOPPED') {
        const stoppedReason = task.stoppedReason || 'Unknown reason';
        return { 
          success: false, 
          error: `Task stopped: ${stoppedReason}` 
        };
      } else if (status === 'FAILED') {
        const failedReason = task.stoppedReason || 'Unknown reason';
        return { 
          success: false, 
          error: `Task failed: ${failedReason}` 
        };
      }
      
      if (attempts === maxAttempts) {
        return { 
          success: false, 
          error: `Task did not reach RUNNING state after ${maxAttempts} attempts. Last status: ${status}` 
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error('Error checking task status:', error);
      
      if (attempts === maxAttempts) {
        return { 
          success: false, 
          error: `Error checking task status: ${error instanceof Error ? error.message : String(error)}` 
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return { 
    success: false, 
    error: 'Maximum attempts reached without task entering RUNNING state' 
  };
}

/**
 * Ensure a task definition exists for the given image
 * 
 * @param {string} image - Docker image URI
 * @param {string} containerName - Name for the container 
 * @param {number} containerPort - Port the container exposes
 * @returns {Promise<string>} - Task definition ARN or family:revision
 */
export async function ensureTaskDefinition(
  image: string,
  containerName: string,
  containerPort: number
): Promise<string> {
  try {
    const config = await getFargateConfig();
    
    // Try to describe the task definition
    const describeTaskDefCommand = new DescribeTaskDefinitionCommand({
      taskDefinition: DEFAULT_CONFIG.taskDefinitionFamily
    });
    
    try {
      // Check if task definition already exists
      const existingTaskDef = await ecsClient.send(describeTaskDefCommand);
      if (existingTaskDef.taskDefinition) {
        console.log(`Using existing task definition: ${DEFAULT_CONFIG.taskDefinitionFamily}:${existingTaskDef.taskDefinition.revision}`);
        return `${DEFAULT_CONFIG.taskDefinitionFamily}:${existingTaskDef.taskDefinition.revision}`;
      }
    } catch (error) {
      // Task definition doesn't exist, we'll create it below
      console.log(`Task definition ${DEFAULT_CONFIG.taskDefinitionFamily} not found, creating it...`);
    }

    // Create the task definition
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: DEFAULT_CONFIG.taskDefinitionFamily,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: DEFAULT_CONFIG.cpu,
      memory: DEFAULT_CONFIG.memory,
      executionRoleArn: config.executionRoleArn || undefined, // Make this optional
      taskRoleArn: config.taskRoleArn || undefined, // Make this optional
      containerDefinitions: [
        {
          name: containerName,
          image: image,
          essential: true,
          portMappings: [
            {
              containerPort: containerPort,
              hostPort: containerPort,
              protocol: 'tcp'
            }
          ],
          // Make CloudWatch logging optional - only add if log group exists or create it
          // Using environment variable to control logging
          ...(process.env.AWS_DISABLE_LOGGING === 'true' ? {} : {
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/${DEFAULT_CONFIG.taskDefinitionFamily}`,
                'awslogs-region': process.env.AWS_REGION || 'us-east-1',
                'awslogs-stream-prefix': 'ecs',
                'awslogs-create-group': 'true'  // Auto-create the log group if it doesn't exist
              }
            }
          })
        }
      ]
    });

    const response = await ecsClient.send(registerTaskDefCommand);
    const taskDefArn = response.taskDefinition?.taskDefinitionArn;
    
    if (!taskDefArn) {
      throw new Error('Failed to register task definition: no ARN returned');
    }
    
    console.log(`Registered new task definition: ${taskDefArn}`);
    return taskDefArn;
  } catch (error) {
    console.error('Error ensuring task definition:', error);
    throw new Error(`Failed to ensure task definition: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Ensure the CloudWatch log group exists
 * 
 * @param {string} logGroupName - Name of the log group
 * @returns {Promise<boolean>} - Whether the log group exists or was created
 */
async function ensureLogGroup(logGroupName: string): Promise<boolean> {
  try {
    // Check if log group exists
    const describeLogGroupsCommand = new DescribeLogGroupsCommand({
      logGroupNamePrefix: logGroupName
    });
    
    const logGroups = await logsClient.send(describeLogGroupsCommand);
    const logGroupExists = logGroups.logGroups?.some((group: { logGroupName?: string }) => 
      group.logGroupName === logGroupName
    );
    
    if (logGroupExists) {
      console.log(`Log group ${logGroupName} already exists`);
      return true;
    }
    
    // Create log group if it doesn't exist
    console.log(`Creating log group ${logGroupName}...`);
    const createLogGroupCommand = new CreateLogGroupCommand({
      logGroupName
    });
    
    await logsClient.send(createLogGroupCommand);
    console.log(`Created log group ${logGroupName}`);
    return true;
  } catch (error) {
    console.error('Error ensuring log group exists:', error);
    return false;
  }
}

/**
 * Start the validation pipeline for an MCP server using Step Functions
 * 
 * @param {ServerRecord} server - The server record to validate
 * @returns {Promise<{success: boolean, executionArn?: string, error?: string}>}
 */
export async function startServerValidation(
  server: ServerRecord
): Promise<{
  success: boolean;
  executionArn?: string;
  error?: string;
}> {
  try {
    const config = await getFargateConfig();
    
    // Check if we're in development mode without proper config
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    // Validate required configuration
    if (!config.stateMachineArn) {
      // In development, provide a helpful message but don't fail hard
      if (isDevelopment) {
        console.warn("Development environment: State Machine ARN is not defined");
        return {
          success: true,
          executionArn: `dev-mock-execution-arn-${Date.now()}`,
          error: "Running in development mode without AWS configuration"
        };
      }
      
      return {
        success: false,
        error: "Missing required configuration: State Machine ARN is not defined in SSM or environment variables"
      };
    }

    // Prepare input for the state machine execution
    // Replace slashes with hyphens in the repositoryName to ensure a valid Docker tag
    const sanitizedRepoName = server.fullName.replace(/\//g, '-');
    
    const input = {
      serverId: server.ServerId,
      repositoryName: sanitizedRepoName,
      originalRepositoryName: server.fullName  // Pass the original repository name for Git clone
    };

    console.log(`Starting validation pipeline for server ${server.ServerId}`);
    console.log(`Using state machine: ${config.stateMachineArn}`);
    
    // In development mode with placeholder ARN, return mock success
    if (isDevelopment && config.stateMachineArn.includes('123ABC')) {
      console.warn("Development environment: Using placeholder State Machine ARN");
      return {
        success: true,
        executionArn: `dev-mock-execution-arn-${Date.now()}`,
        error: "Running in development mode with placeholder ARN"
      };
    }
    
    // Start the Step Function execution
    const startCommand = new StartExecutionCommand({
      stateMachineArn: config.stateMachineArn,
      input: JSON.stringify(input),
      name: `Validation-${server.ServerId.replace(/[^a-zA-Z0-9-_]/g, '-')}-${Date.now()}`
    });

    const response = await sfnClient.send(startCommand);
    
    console.log(`Started Step Functions execution: ${response.executionArn}`);
    
    // Return the execution ARN as the job identifier
    return {
      success: true,
      executionArn: response.executionArn
    };
  } catch (error) {
    console.error('Error starting server validation pipeline:', error);
    
    // In development mode, provide a more helpful response
    if (process.env.NODE_ENV === 'development') {
      return {
        success: true,
        executionArn: `dev-mock-execution-arn-${Date.now()}`,
        error: `Development mode: AWS error occurred: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check the status of a validation pipeline execution
 * 
 * @param {string} executionArn - The ARN of the Step Functions execution
 * @returns {Promise<{status: string, success: boolean, output?: any, error?: string}>}
 */
export async function getValidationStatus(
  executionArn: string
): Promise<{
  status: string;
  success: boolean;
  output?: any;
  error?: string;
}> {
  try {
    const describeCommand = new DescribeExecutionCommand({
      executionArn
    });

    const execution = await sfnClient.send(describeCommand);
    
    // Determine if the execution was successful
    const isSuccess = execution.status === 'SUCCEEDED';
    
    // Parse output if available
    let output = undefined;
    if (execution.output) {
      try {
        output = JSON.parse(execution.output);
      } catch (e) {
        console.warn('Failed to parse execution output:', e);
      }
    }
    
    return {
      status: execution.status || 'UNKNOWN',
      success: isSuccess,
      output,
      error: execution.error
    };
  } catch (error) {
    console.error('Error checking validation pipeline status:', error);
    return {
      status: 'ERROR',
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Launch a container in AWS Fargate
 * 
 * @param {object} options - Container launch options
 * @param {string} options.image - Docker image URI to run
 * @param {string} options.serverName - Name of the MCP server
 * @param {string} options.taskDefinitionFamily - Optional custom task definition family
 * @param {number} options.containerPort - Optional custom container port
 * @param {string[]} options.environmentVariables - Optional environment variables
 * @returns {Promise<{success: boolean, endpoint?: string, taskArn?: string, error?: string}>}
 */
export async function launchContainer(options: {
  image: string;
  serverName: string;
  taskDefinitionFamily?: string;
  containerPort?: number;
  environmentVariables?: Array<{ name: string; value: string }>;
}): Promise<{
  success: boolean;
  endpoint?: string;
  taskArn?: string;
  error?: string;
}> {
  console.warn('launchContainer is deprecated. Use startServerValidation instead.');
  console.warn('This function now delegates to the Step Functions validation pipeline.');
  
  // Create a minimal server record from the options
  const server: ServerRecord = {
    ServerId: options.serverName,
    name: options.serverName,
    fullName: options.serverName,
    url: '',
    discoveredAt: Date.now(),
    verified: false
  };
  
  const result = await startServerValidation(server);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error
    };
  }
  
  // Return a mock response that's compatible with the old API
  return {
    success: true,
    endpoint: 'Validation in progress via Step Functions. Endpoint will be updated in DynamoDB when ready.',
    taskArn: result.executionArn // Use the execution ARN as a task identifier
  };
}

/**
 * Stop a running Fargate task
 * 
 * @param {string} taskArn - The ARN of the task to stop
 * @param {string} reason - Optional reason for stopping the task
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function stopContainer(
  taskArn: string, 
  reason: string = 'Task no longer needed'
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const config = await getFargateConfig();
    const stopTaskCommand = new StopTaskCommand({
      cluster: config.cluster,
      task: taskArn,
      reason
    });

    await ecsClient.send(stopTaskCommand);
    console.log(`Stopped task: ${taskArn}`);
    
    return { success: true };
  } catch (error) {
    console.error('Error stopping Fargate task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if a Fargate task is still running
 * 
 * @param {string} taskArn - The ARN of the task to check
 * @returns {Promise<{running: boolean, status?: string, error?: string}>}
 */
export async function checkContainerStatus(
  taskArn: string
): Promise<{
  running: boolean;
  status?: string;
  error?: string;
}> {
  try {
    // Check if this is a Step Functions execution ARN instead of an ECS task ARN
    if (taskArn.includes(':states:') && taskArn.includes(':execution:')) {
      return {
        running: false,
        status: 'PENDING',
        error: 'Cannot check Step Functions execution as a Fargate task. Use getValidationStatus instead.'
      };
    }

    // Enhanced validation for task ARN format
    // Valid formats:
    // - arn:aws:ecs:<region>:<account>:task/<cluster-name>/<task-id> (36 or 32 chars)
    if (!taskArn || typeof taskArn !== 'string') {
      return {
        running: false,
        status: 'INVALID',
        error: 'Missing or invalid task ARN'
      };
    }

    // Check for correct ARN format
    if (!taskArn.startsWith('arn:aws:ecs:')) {
      return {
        running: false,
        status: 'INVALID',
        error: 'Not a valid ECS task ARN'
      };
    }

    // Extract task ID from the end of the ARN and validate its format
    const taskIdMatch = taskArn.match(/\/([a-f0-9]{32}|[a-f0-9-]{36})$/);
    if (!taskIdMatch) {
      console.error(`Invalid task ID format in ARN: ${taskArn}`);
      return {
        running: false,
        status: 'INVALID',
        error: 'Invalid task ID format. Expected 32 or 36 character ID.'
      };
    }

    const config = await getFargateConfig();
    const describeTasksCommand = new DescribeTasksCommand({
      cluster: config.cluster,
      tasks: [taskArn]
    });

    const taskDetails = await ecsClient.send(describeTasksCommand);

    if (!taskDetails.tasks || taskDetails.tasks.length === 0) {
      return {
        running: false,
        error: 'Task not found'
      };
    }

    const task = taskDetails.tasks[0];
    const status = task.lastStatus || 'UNKNOWN';
    
    return {
      running: status === 'RUNNING',
      status
    };
  } catch (error) {
    console.error('Error checking Fargate task status:', error);
    return {
      running: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 