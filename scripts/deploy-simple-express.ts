/**
 * Script to deploy a simple Express server on ECS
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/deploy-simple-express.ts
 */

import { 
  ECSClient, 
  RunTaskCommand,
  RegisterTaskDefinitionCommand
} from "@aws-sdk/client-ecs";
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

// Create clients
const ecsClient = new ECSClient({ region });

async function main() {
  try {
    const serverName = `simple-express-${Date.now().toString().slice(-6)}`;
    const containerName = `simple-express-${Date.now().toString().slice(-6)}`;
    
    console.log(`\n=== Deploying Simple Express Server ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Container Name: ${containerName}`);
    
    // Register a task definition
    console.log('\nStep 1: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `simple-express-task-${Date.now().toString().slice(-6)}`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '512',  // 0.5 vCPU
      memory: '1024', // 1GB RAM
      executionRoleArn,
      containerDefinitions: [
        {
          name: containerName,
          image: 'node:18-alpine',
          essential: true,
          command: [
            "/bin/sh", 
            "-c", 
            "cd /tmp && echo 'const express = require(\"express\"); const app = express(); const PORT = process.env.PORT || 8000; app.get(\"/\", (req, res) => { res.json({ hello: \"world\" }); }); app.get(\"/tools\", (req, res) => { res.json({ tools: [{ name: \"echo\", description: \"Echo back a message\", parameters: { message: { type: \"string\", description: \"Message to echo\", required: true } } }] }); }); app.post(\"/execute\", (req, res) => { const { tool, params = {} } = req.body; if (tool === \"echo\") { res.json({ result: params.message }); } else { res.status(400).json({ error: \"Unknown tool\" }); } }); app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });' > server.js && npm init -y && npm install --no-save express && node server.js"
          ],
          environment: [
            { name: 'PORT', value: '8000' }
          ],
          portMappings: [
            {
              containerPort: 8000,
              hostPort: 8000,
              protocol: 'tcp'
            }
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': 'ecs',
              'awslogs-region': region,
              'awslogs-stream-prefix': 'express'
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
    const taskId = taskArn?.split('/').pop();
    console.log(`Task started with ARN: ${taskArn}`);
    
    // Provide info to stop the task
    console.log('\nTo stop this task, run:');
    console.log(`aws ecs stop-task --cluster ${cluster} --task ${taskId} --region ${region}`);
    
    // Track the private IP
    if (runTaskResult.tasks[0].attachments && runTaskResult.tasks[0].attachments.length > 0) {
      console.log('\nTask network details:');
      console.log(JSON.stringify(runTaskResult.tasks[0].attachments, null, 2));
    }
    
    console.log('\nTask is running. To access this container, you need to:');
    console.log('1. Wait for the task to reach RUNNING state (usually 30-60 seconds)');
    console.log('2. Get the private IP address using:');
    console.log(`   aws ecs describe-tasks --cluster ${cluster} --tasks ${taskId} --region ${region}`);
    console.log('3. Set up an ALB or other routing mechanism to access the container');
    console.log('\nAfter getting the private IP, you can set up an ALB using:');
    console.log(`   npx ts-node -P scripts/tsconfig.json scripts/setup-alb-for-mcp.ts <privateIP> 8000`);
    
  } catch (error: any) {
    console.error('ERROR:', error.message);
  }
}

main().catch(console.error); 