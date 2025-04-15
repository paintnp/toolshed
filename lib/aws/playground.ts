import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
  RegisterTaskDefinitionCommand,
  DescribeTaskDefinitionCommand,
  NetworkConfiguration,
  AssignPublicIp
} from "@aws-sdk/client-ecs";
import { EC2Client, DescribeNetworkInterfacesCommand } from "@aws-sdk/client-ec2";
import { getPlaygroundConfig } from './config';

// Configure ECS client
const ecsClient = new ECSClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Configure EC2 client for looking up ENI details
const ec2Client = new EC2Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Default values for task configuration
const DEFAULT_CONFIG = {
  taskDefinitionFamily: 'toolshed-playground',
  containerPort: 8000,  // Default port for MCP servers
  cpu: '1024',  // 1 vCPU for better performance
  memory: '2048', // 2GB RAM
  assignPublicIp: AssignPublicIp.ENABLED as AssignPublicIp, // We need to connect to the server from outside
};

/**
 * Register or update a task definition for the playground
 * 
 * @param {string} image - Docker image URI to use
 * @param {string} containerName - Name for the container
 * @param {number} containerPort - Port the container exposes
 * @returns {Promise<string>} Task definition ARN or family:revision
 */
export async function registerPlaygroundTaskDefinition(
  image: string,
  containerName: string = 'mcp-server',
  containerPort: number = DEFAULT_CONFIG.containerPort
): Promise<string> {
  try {
    // Load configuration from SSM or environment variables
    const playgroundConfig = await getPlaygroundConfig();
    
    // Validate required configuration
    if (!playgroundConfig.executionRoleArn) {
      throw new Error(
        'Missing executionRoleArn in playground configuration. ' +
        'This is required for Fargate tasks with awslogs. ' + 
        'Please check your environment variables (AWS_EXECUTION_ROLE_ARN) or SSM parameters (/toolshed/playground/executionRoleArn).'
      );
    }

    // Create a unique task definition family name for this specific image URI
    // This ensures we don't have caching issues with different servers
    const baseFamily = DEFAULT_CONFIG.taskDefinitionFamily;
    const imageHash = Buffer.from(image).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    const family = `${baseFamily}-${imageHash}`;
    
    console.log(`Creating unique task definition family for image: ${family}`);
    
    // Determine if this is a semgrep MCP server based on the image URI
    const isSemgrepMcp = image.toLowerCase().includes('semgrep');
    
    // Configure container definition based on the server type
    let containerDefinition: any = {
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
      logConfiguration: {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': `/ecs/ToolshedPlayground`,
          'awslogs-region': process.env.AWS_REGION || 'us-east-1',
          'awslogs-stream-prefix': 'playground',
          'awslogs-create-group': 'true'  // Auto-create the log group if it doesn't exist
        }
      }
    };
    
    // Add server-specific configuration
    if (isSemgrepMcp) {
      console.log('Detected Semgrep MCP server, adding SSE transport parameter');
      containerDefinition.command = ["-t", "sse"];
    }
    
    // Create the task definition - we don't reuse task definitions to avoid caching issues
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: DEFAULT_CONFIG.cpu,
      memory: DEFAULT_CONFIG.memory,
      executionRoleArn: playgroundConfig.executionRoleArn,
      containerDefinitions: [containerDefinition]
    });

    const response = await ecsClient.send(registerTaskDefCommand);
    const taskDefArn = response.taskDefinition?.taskDefinitionArn;
    
    if (!taskDefArn) {
      throw new Error('Failed to register task definition: no ARN returned');
    }
    
    console.log(`Registered new task definition: ${taskDefArn}`);
    return taskDefArn;
  } catch (error) {
    console.error('Error registering playground task definition:', error);
    throw new Error(`Failed to register playground task definition: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Launch a playground environment
 * 
 * @param {string} image - Docker image URI to run
 * @param {string} serverId - ID of the server
 * @returns {Promise<{ success: boolean, taskArn?: string, error?: string }>}
 */
export async function launchPlayground(
  image: string,
  serverId: string
): Promise<{ 
  success: boolean, 
  taskArn?: string, 
  error?: string 
}> {
  try {
    // Load configuration from SSM or environment variables
    const playgroundConfig = await getPlaygroundConfig();
    
    // Validate that we have all required configuration
    const missingConfig = [];
    if (!playgroundConfig.subnets.length) missingConfig.push('subnets');
    if (!playgroundConfig.securityGroupId) missingConfig.push('securityGroupId');
    if (!playgroundConfig.executionRoleArn) missingConfig.push('executionRoleArn');
    if (!playgroundConfig.cluster) missingConfig.push('cluster');
    
    if (missingConfig.length > 0) {
      const errorMsg = `Playground configuration is incomplete. Missing: ${missingConfig.join(', ')}. Check your environment variables or SSM parameters.`;
      console.error(errorMsg, playgroundConfig);
      return {
        success: false,
        error: errorMsg
      };
    }
    
    // Register task definition
    const containerName = 'mcp-server';
    const taskDefinitionArn = await registerPlaygroundTaskDefinition(
      image,
      containerName,
      DEFAULT_CONFIG.containerPort
    );
    
    // Create network configuration for the task using loaded config
    const networkConfiguration: NetworkConfiguration = {
      awsvpcConfiguration: {
        subnets: playgroundConfig.subnets,
        securityGroups: [playgroundConfig.securityGroupId],
        assignPublicIp: DEFAULT_CONFIG.assignPublicIp
      }
    };
    
    // Launch the ECS task with the image
    const runTaskCommand = new RunTaskCommand({
      cluster: playgroundConfig.cluster,
      taskDefinition: taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration,
      startedBy: `toolshed-playground-${serverId}`,
      // Tag the task for easier identification
      tags: [
        {
          key: 'ServerID',
          value: serverId
        },
        {
          key: 'Environment',
          value: 'Playground'
        }
      ]
    });
    
    // Send the command to ECS
    const runTaskResult = await ecsClient.send(runTaskCommand);
    
    // Check for failures
    if (!runTaskResult.tasks || runTaskResult.tasks.length === 0) {
      const failures = runTaskResult.failures || [];
      return {
        success: false,
        error: failures.length > 0 
          ? `Failed to launch task: ${failures[0].reason}` 
          : 'Failed to launch task: Unknown reason'
      };
    }
    
    // Get the task ARN
    const task = runTaskResult.tasks[0];
    const taskArn = task.taskArn;
    
    if (!taskArn) {
      return {
        success: false,
        error: 'Task ARN not found in response'
      };
    }
    
    return {
      success: true,
      taskArn
    };
  } catch (error) {
    console.error('Error launching playground:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Stop a playground environment
 * 
 * @param {string} taskArn - The ARN of the task to stop
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function stopPlayground(
  taskArn: string
): Promise<{ 
  success: boolean, 
  error?: string 
}> {
  try {
    // Load configuration from SSM or environment variables
    const playgroundConfig = await getPlaygroundConfig();
    
    // Stop the task
    const stopTaskCommand = new StopTaskCommand({
      cluster: playgroundConfig.cluster,
      task: taskArn,
      reason: 'Playground session stopped by user'
    });
    
    await ecsClient.send(stopTaskCommand);
    
    return { 
      success: true 
    };
  } catch (error) {
    console.error('Error stopping playground:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get the status of a playground environment
 * 
 * @param {string} taskArn - The ARN of the task to check
 * @returns {Promise<{ success: boolean, status?: string, endpoint?: string, error?: string, isPrivateEndpoint?: boolean }>}
 */
export async function getPlaygroundStatus(
  taskArn: string
): Promise<{ 
  success: boolean, 
  status?: string, 
  endpoint?: string, 
  error?: string,
  isPrivateEndpoint?: boolean
}> {
  try {
    // Load configuration from SSM or environment variables
    const playgroundConfig = await getPlaygroundConfig();
    
    console.log(`Getting status for task ${taskArn} in cluster ${playgroundConfig.cluster}`);
    
    // Get task details from ECS
    const describeTasksCommand = new DescribeTasksCommand({
      cluster: playgroundConfig.cluster,
      tasks: [taskArn]
    });
    
    const taskDetails = await ecsClient.send(describeTasksCommand);
    
    // Check for failures or missing tasks
    if (!taskDetails.tasks || taskDetails.tasks.length === 0) {
      if (taskDetails.failures && taskDetails.failures.length > 0) {
        console.error(`Task check failed: ${JSON.stringify(taskDetails.failures)}`);
        return {
          success: false,
          status: 'FAILED',
          error: taskDetails.failures[0].reason || 'Task failed'
        };
      }
      console.error('Task not found in ECS response');
      return {
        success: false,
        status: 'NOT_FOUND',
        error: 'Task not found'
      };
    }
    
    // Extract relevant information from the task
    const task = taskDetails.tasks[0];
    console.log(`Task details: ${JSON.stringify(task, null, 2)}`);
    
    const status = task.lastStatus || 'UNKNOWN';
    const isRunning = status === 'RUNNING';
    
    console.log(`Task status: ${status}, isRunning: ${isRunning}`);
    
    // Handle different task states
    if (status === 'STOPPED') {
      console.warn(`Task stopped with reason: ${task.stoppedReason}`);
      return {
        success: false,
        status,
        error: task.stoppedReason || 'Task stopped'
      };
    }
    
    // If task is running, extract connection information
    let endpoint = undefined;
    let isPrivateEndpoint = false;
    
    if (isRunning && task.attachments) {
      console.log(`Task has ${task.attachments.length} attachment(s)`);
      
      const networkAttachment = task.attachments.find(attachment => 
        attachment.type === 'ElasticNetworkInterface'
      );
      
      if (networkAttachment) {
        console.log(`Found network attachment: ${JSON.stringify(networkAttachment)}`);
        
        if (networkAttachment.details) {
          console.log(`Network attachment has ${networkAttachment.details.length} detail(s)`);
          
          // Get the ENI ID to look up in EC2
          const networkInterfaceIdDetail = networkAttachment.details.find(detail => 
            detail.name === 'networkInterfaceId'
          );
          
          if (networkInterfaceIdDetail && networkInterfaceIdDetail.value) {
            const eniId = networkInterfaceIdDetail.value;
            console.log(`Found ENI ID: ${eniId}, querying EC2 for public IP`);
            
            // Query EC2 API for the ENI details to get the public IP
            try {
              const describeNetworkInterfacesCommand = new DescribeNetworkInterfacesCommand({
                NetworkInterfaceIds: [eniId]
              });
              
              const eniDetails = await ec2Client.send(describeNetworkInterfacesCommand);
              
              if (eniDetails.NetworkInterfaces && eniDetails.NetworkInterfaces.length > 0) {
                const eni = eniDetails.NetworkInterfaces[0];
                console.log(`ENI details: ${JSON.stringify(eni, null, 2)}`);
                
                if (eni.Association && eni.Association.PublicIp) {
                  const publicIp = eni.Association.PublicIp;
                  console.log(`Found public IP from EC2 API: ${publicIp}`);
                  endpoint = `http://${publicIp}:${DEFAULT_CONFIG.containerPort}`;
                } else {
                  console.warn('EC2 API returned ENI details, but no public IP was found');
                  
                  // Fallback to private IP only if no public IP is available
                  const privateIpDetail = networkAttachment.details.find(detail => 
                    detail.name === 'privateIPv4Address'
                  );
                  
                  if (privateIpDetail && privateIpDetail.value) {
                    console.log(`Falling back to private IP: ${privateIpDetail.value}`);
                    endpoint = `http://${privateIpDetail.value}:${DEFAULT_CONFIG.containerPort}`;
                    isPrivateEndpoint = true;
                  }
                }
              } else {
                console.warn('EC2 API did not return any network interfaces');
              }
            } catch (ec2Error) {
              console.error('Error querying EC2 API for ENI details:', ec2Error);
              
              // Fallback to private IP in case of EC2 API error
              const privateIpDetail = networkAttachment.details.find(detail => 
                detail.name === 'privateIPv4Address'
              );
              
              if (privateIpDetail && privateIpDetail.value) {
                console.log(`Falling back to private IP due to EC2 API error: ${privateIpDetail.value}`);
                endpoint = `http://${privateIpDetail.value}:${DEFAULT_CONFIG.containerPort}`;
                isPrivateEndpoint = true;
              }
            }
          } else {
            console.warn('No network interface ID found in attachment details');
            // Log all details for debugging
            console.log('All network details:', JSON.stringify(networkAttachment.details));
          }
        } else {
          console.warn('Network attachment has no details');
        }
      } else {
        console.warn('No ElasticNetworkInterface attachment found');
      }
    }
    
    console.log(`Endpoint determined: ${endpoint || 'none'} (private: ${isPrivateEndpoint})`);
    
    return {
      success: isRunning,
      status,
      endpoint,
      isPrivateEndpoint
    };
  } catch (error) {
    console.error('Error getting playground status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 