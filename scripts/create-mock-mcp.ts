/**
 * Script to set up a simple mock MCP server using nginx
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/create-mock-mcp.ts
 */

import { 
  ECSClient, 
  RunTaskCommand,
  RegisterTaskDefinitionCommand
} from "@aws-sdk/client-ecs";
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Settings
const region = process.env.AWS_REGION || 'us-east-1';
const cluster = process.env.AWS_ECS_CLUSTER || 'ToolShedCluster';
const subnets = process.env.AWS_SUBNETS ? process.env.AWS_SUBNETS.split(',') : [
  'subnet-07bc787a013cf5926',
  'subnet-0c0af47e04884bb80',
  'subnet-074535b0c6a340c11',
  'subnet-0e468f181287bbce4',
  'subnet-0792e0563b7a805cf',
  'subnet-0127f23858bc25529'
];
const securityGroups = process.env.AWS_SECURITY_GROUP_ID ? 
  [process.env.AWS_SECURITY_GROUP_ID] : ['sg-05aef5694ddf3eee3'];
const executionRoleArn = process.env.AWS_EXECUTION_ROLE_ARN || '';

// Create ECS client
const ecsClient = new ECSClient({ region });

async function main() {
  try {
    const serverName = `mock-mcp-server-${Date.now().toString().slice(-6)}`;
    const containerName = `mock-mcp-container-${Date.now().toString().slice(-6)}`;
    const image = 'nginx:latest'; // Using nginx as a base
    
    console.log(`\n=== Launching Mock MCP Server ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Container Name: ${containerName}`);
    console.log(`Image: ${image}\n`);
    
    // Custom nginx config with mock MCP endpoints
    const nginxConfig = `
server {
    listen 8000;
    
    location /tools {
        default_type application/json;
        return 200 '{"tools":[{"name":"echo","version":"1.0.0","description":"Echo back the input"}]}';
    }
    
    location /execute {
        default_type application/json;
        if ($request_method = 'POST') {
            return 200 '{"result":"This is a mock MCP server response"}';
        }
        return 405 '{"error":"Method not allowed"}';
    }
    
    location / {
        default_type text/html;
        return 200 '<html><body><h1>Mock MCP Server</h1><p>This is a mock implementation of the GitHub MCP server</p></body></html>';
    }
}
    `;
    
    // Command to update nginx config and reload
    const setupCommand = `echo '${nginxConfig.replace(/'/g, "'\\''")}' > /etc/nginx/conf.d/default.conf && nginx -s reload`;
    
    // Register a task definition
    console.log('Step 1: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `mock-mcp-task-${Date.now().toString().slice(-6)}`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '1024',  // 1 vCPU
      memory: '2048', // 2GB RAM
      executionRoleArn,
      containerDefinitions: [
        {
          name: containerName,
          image,
          essential: true,
          command: ["/bin/sh", "-c", setupCommand],
          portMappings: [
            {
              containerPort: 8000,
              hostPort: 8000,
              protocol: 'tcp'
            }
          ],
          healthCheck: {
            command: ["CMD-SHELL", "curl -f http://localhost:8000/tools || exit 1"],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 5
          },
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': 'ecs',
              'awslogs-region': region,
              'awslogs-stream-prefix': 'mcp'
            }
          }
        }
      ]
    });
    
    const taskDefResponse = await ecsClient.send(registerTaskDefCommand);
    if (!taskDefResponse.taskDefinition?.taskDefinitionArn) {
      throw new Error('Failed to register task definition');
    }
    
    const taskDefArn = taskDefResponse.taskDefinition.taskDefinitionArn;
    console.log(`Task definition registered: ${taskDefArn}`);
    
    // Run the task
    console.log('\nStep 2: Launching Fargate task...');
    const runTaskCommand = new RunTaskCommand({
      cluster,
      taskDefinition: taskDefArn,
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: 'ENABLED'
        }
      }
    });
    
    const runTaskResult = await ecsClient.send(runTaskCommand);
    
    if (!runTaskResult.tasks || runTaskResult.tasks.length === 0) {
      const failureReason = runTaskResult.failures && runTaskResult.failures.length > 0
        ? runTaskResult.failures[0].reason
        : 'Unknown reason';
      
      throw new Error(`Failed to start task: ${failureReason}`);
    }
    
    const taskArn = runTaskResult.tasks[0].taskArn;
    console.log(`Task started with ARN: ${taskArn}`);
    
    // Provide info to stop the task
    console.log('\nTo stop this task, run:');
    console.log(`aws ecs stop-task --cluster ${cluster} --task ${taskArn?.split('/').pop()}`);
    
    // Track the private IP
    if (runTaskResult.tasks[0].attachments && runTaskResult.tasks[0].attachments.length > 0) {
      console.log('\nTask network details:');
      console.log(JSON.stringify(runTaskResult.tasks[0].attachments, null, 2));
    }
    
    console.log('\nTask is running. To access this container, you need to:');
    console.log('1. Wait for the task to reach RUNNING state (usually 30-60 seconds)');
    console.log('2. Get the private IP address using:');
    console.log(`   aws ecs describe-tasks --cluster ${cluster} --tasks ${taskArn?.split('/').pop()}`);
    console.log('3. Set up an ALB or other routing mechanism to access the container');
    
  } catch (error) {
    console.error('ERROR:', error);
  }
}

main().catch(console.error); 