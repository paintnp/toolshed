/**
 * Script to launch GitHub MCP Server with GitHub Container Registry authentication
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/github-mcp-with-auth.ts
 */

import { 
  ECSClient, 
  RunTaskCommand,
  RegisterTaskDefinitionCommand
} from "@aws-sdk/client-ecs";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";
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
const githubToken = process.env.GITHUB_TOKEN || '';

// Create clients
const ecsClient = new ECSClient({ region });
const secretsClient = new SecretsManagerClient({ region });

// Secret name for GitHub token
const secretName = `github-mcp-token-${Date.now().toString().slice(-6)}`;

async function ensureSecret() {
  // Create a secret to store GitHub token
  if (!githubToken) {
    throw new Error('GitHub token not found in environment variables');
  }
  
  console.log(`Creating AWS Secrets Manager secret for GitHub token: ${secretName}`);
  
  try {
    // Create a JSON structure for Docker authentication
    const authConfig = {
      "auths": {
        "ghcr.io": {
          "auth": Buffer.from(`x-access-token:${githubToken}`).toString('base64')
        }
      }
    };
    
    const createSecretCommand = new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify({
        username: 'x-access-token',
        password: githubToken
      })
    });
    
    const createResult = await secretsClient.send(createSecretCommand);
    console.log(`Secret created with ARN: ${createResult.ARN}`);
    
    return createResult.ARN;
  } catch (error) {
    console.error('Error creating secret:', error);
    throw error;
  }
}

async function main() {
  try {
    // First create the secret to store GitHub token
    const secretArn = await ensureSecret();
    
    const serverName = `github-mcp-auth-${Date.now().toString().slice(-6)}`;
    const containerName = `github-mcp-container-${Date.now().toString().slice(-6)}`;
    const image = 'ghcr.io/github/mcp-server:latest'; // GitHub's official MCP server
    
    console.log(`\n=== Launching GitHub MCP Server with Auth ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Container Name: ${containerName}`);
    console.log(`Image: ${image}`);
    console.log(`Secret ARN: ${secretArn}\n`);
    
    // Register a task definition with repository credentials
    console.log('Step 1: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `github-mcp-task-${Date.now().toString().slice(-6)}`,
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
          repositoryCredentials: {
            credentialsParameter: secretArn
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
    console.log(`\nTo delete the secret when done, run:`);
    console.log(`aws secretsmanager delete-secret --secret-id ${secretName} --region ${region} --force-delete-without-recovery`);
    
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