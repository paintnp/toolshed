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

// Load environment variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Configuration with defaults that can be overridden
const DEFAULT_CONFIG = {
  cluster: process.env.AWS_ECS_CLUSTER || 'ToolShedCluster',
  region: process.env.AWS_REGION || 'us-east-1',
  subnets: process.env.AWS_SUBNETS ? process.env.AWS_SUBNETS.split(',') : [],
  securityGroups: process.env.AWS_SECURITY_GROUP_ID ? [process.env.AWS_SECURITY_GROUP_ID] : [],
  taskDefinitionFamily: process.env.AWS_TASK_DEFINITION_FAMILY || 'mcp-server-task',
  executionRoleArn: process.env.AWS_EXECUTION_ROLE_ARN || '',
  taskRoleArn: process.env.AWS_TASK_ROLE_ARN || '',
  containerPort: 8000,  // Default port for MCP servers
  cpu: '512',  // 0.5 vCPU
  memory: '1024', // 1GB RAM
  assignPublicIp: AssignPublicIp.ENABLED as AssignPublicIp, // We need to connect to the server from outside
};

// Create ECS client
const ecsClient = new ECSClient({ region: DEFAULT_CONFIG.region });

// CloudWatch Logs client
const logsClient = new CloudWatchLogsClient({ region: DEFAULT_CONFIG.region });

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
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Waiting for task to reach RUNNING state (attempt ${attempts}/${maxAttempts})...`);
    
    try {
      const describeTasksCommand = new DescribeTasksCommand({
        cluster: DEFAULT_CONFIG.cluster,
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
async function ensureTaskDefinition(
  image: string,
  containerName: string,
  containerPort: number
): Promise<string> {
  try {
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
      executionRoleArn: DEFAULT_CONFIG.executionRoleArn || undefined, // Make this optional
      taskRoleArn: DEFAULT_CONFIG.taskRoleArn || undefined, // Make this optional
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
                'awslogs-region': DEFAULT_CONFIG.region,
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
  try {
    // Validate required configuration
    if (!DEFAULT_CONFIG.subnets.length || !DEFAULT_CONFIG.securityGroups.length) {
      return {
        success: false,
        error: "Missing required AWS configuration: subnets or security groups not defined"
      };
    }

    // Print configuration for debugging
    console.log("AWS Configuration:");
    console.log(`Region: ${DEFAULT_CONFIG.region}`);
    console.log(`Cluster: ${DEFAULT_CONFIG.cluster}`);
    console.log(`Subnets: ${DEFAULT_CONFIG.subnets.join(', ')}`);
    console.log(`Security Groups: ${DEFAULT_CONFIG.securityGroups.join(', ')}`);
    console.log(`Task Definition Family: ${DEFAULT_CONFIG.taskDefinitionFamily}`);
    console.log(`Execution Role ARN: ${DEFAULT_CONFIG.executionRoleArn || 'Not specified'}`);

    // Set up container override configurations
    const containerName = `${options.serverName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-container`;
    const containerPort = options.containerPort || DEFAULT_CONFIG.containerPort;
    
    // Override the task definition family if provided
    if (options.taskDefinitionFamily) {
      DEFAULT_CONFIG.taskDefinitionFamily = options.taskDefinitionFamily;
    }

    // Create CloudWatch log group if logging is enabled
    const logGroupName = `/ecs/${DEFAULT_CONFIG.taskDefinitionFamily}`;
    if (process.env.AWS_DISABLE_LOGGING !== 'true') {
      const logGroupCreated = await ensureLogGroup(logGroupName);
      if (!logGroupCreated) {
        console.warn('Failed to create log group, continuing without logging');
      }
    }

    // Format environment variables for container
    const environment = options.environmentVariables || [];

    // Configure the network for the task
    const networkConfiguration: NetworkConfiguration = {
      awsvpcConfiguration: {
        subnets: DEFAULT_CONFIG.subnets,
        securityGroups: DEFAULT_CONFIG.securityGroups,
        assignPublicIp: 'ENABLED' as AssignPublicIp // Force assign public IP
      }
    };

    // Ensure we have a task definition for this container
    const taskDefinition = await ensureTaskDefinition(
      options.image,
      containerName,
      containerPort
    );

    // Configure the container overrides for environment variables
    const containerOverride: ContainerOverride = {
      name: containerName,
      environment
    };

    const overrides: TaskOverride = {
      containerOverrides: [containerOverride]
    };

    // Run the Fargate task
    const runTaskCommand = new RunTaskCommand({
      cluster: DEFAULT_CONFIG.cluster,
      taskDefinition: taskDefinition,
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration,
      overrides
    });

    console.log(`Launching container for ${options.serverName} with image ${options.image}`);
    const runTaskResult = await ecsClient.send(runTaskCommand);

    // Check if task was started
    if (!runTaskResult.tasks || runTaskResult.tasks.length === 0) {
      const failureReason = runTaskResult.failures && runTaskResult.failures.length > 0
        ? runTaskResult.failures[0].reason
        : 'Unknown reason';
      
      return {
        success: false,
        error: `Failed to start Fargate task: ${failureReason}`
      };
    }

    // Get task ARN
    const taskArn = runTaskResult.tasks[0].taskArn;
    if (!taskArn) {
      return {
        success: false,
        error: 'Task ARN not found in response'
      };
    }

    console.log(`Task started with ARN: ${taskArn}`);

    // Wait for task to become running
    const waitResult = await waitForTask(taskArn, 10, 5000);
    if (!waitResult.success) {
      return {
        success: false,
        error: waitResult.error,
        taskArn
      };
    }

    // Get public IP address from the task
    const task = waitResult.task;
    const attachments = task.attachments || [];
    
    console.log('Task attachments:', JSON.stringify(attachments, null, 2));
    
    const networkInterfaceAttachment = attachments.find((attachment: any) => 
      attachment.type === 'ElasticNetworkInterface'
    );

    if (!networkInterfaceAttachment || !networkInterfaceAttachment.details) {
      console.log('No network interface attachment found in task');
      return { 
        success: false, 
        error: 'Network interface details not found',
        taskArn 
      };
    }

    console.log('Network interface details:', JSON.stringify(networkInterfaceAttachment.details, null, 2));

    const publicIpDetail = networkInterfaceAttachment.details.find((detail: any) => 
      detail.name === 'publicIp'
    );

    if (!publicIpDetail || !publicIpDetail.value) {
      // If no public IP, try to get the private IP
      console.log('No public IP found, checking for private IP');
      console.log('NOTE: Even with assignPublicIp: ENABLED, your subnet configuration appears to be blocking public IPs');
      console.log('SOLUTION OPTIONS:');
      console.log('  1. Use an AWS Application Load Balancer (ALB) to expose your Fargate containers');
      console.log('  2. Configure your subnets to support public IPs in the AWS console');
      console.log('  3. Use VPC endpoints to access the container from within AWS');
      
      const privateIpDetail = networkInterfaceAttachment.details.find((detail: any) => 
        detail.name === 'privateIPv4Address'
      );
      
      if (privateIpDetail && privateIpDetail.value) {
        console.log(`Task running with private IP: ${privateIpDetail.value}. Note: This may not be accessible from the internet.`);
        
        // Return the private IP instead if we couldn't get a public IP
        // This allows for internal network access if applicable
        const privateEndpoint = `http://${privateIpDetail.value}:${containerPort}`;
        return { 
          success: true, 
          endpoint: privateEndpoint,
          taskArn,
          error: 'Warning: Using private IP address, may not be accessible from the internet'
        };
      }
      
      console.log('No private IP found either');
      return { 
        success: false, 
        error: 'No IP address found for task',
        taskArn 
      };
    }

    const publicIp = publicIpDetail.value;
    const endpoint = `http://${publicIp}:${containerPort}`;

    console.log(`Task running at endpoint: ${endpoint}`);
    
    return {
      success: true,
      endpoint,
      taskArn
    };
  } catch (error) {
    console.error('Error launching Fargate container:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
    const stopTaskCommand = new StopTaskCommand({
      cluster: DEFAULT_CONFIG.cluster,
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
    const describeTasksCommand = new DescribeTasksCommand({
      cluster: DEFAULT_CONFIG.cluster,
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