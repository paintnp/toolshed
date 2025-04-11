/**
 * Script to deploy the official GitHub MCP Server on ECS
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/deploy-github-mcp.ts
 */

import { 
  ECSClient, 
  RunTaskCommand,
  RegisterTaskDefinitionCommand
} from "@aws-sdk/client-ecs";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand
} from "@aws-sdk/client-secrets-manager";
import dotenv from 'dotenv';
import { execSync } from 'child_process';
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
const githubToken = process.env.GITHUB_TOKEN || '';

// Create clients
const ecsClient = new ECSClient({ region });
const secretsClient = new SecretsManagerClient({ region });

// Function to test GitHub Container Registry authentication
async function testGitHubAuth(): Promise<boolean> {
  console.log('\nTesting GitHub Container Registry authentication...');
  
  if (!githubToken) {
    console.error('Error: GITHUB_TOKEN not found in .env.local');
    return false;
  }
  
  try {
    // Create a temporary file to store the token
    const tmpTokenFile = path.join(os.tmpdir(), `github-token-${Date.now()}.txt`);
    fs.writeFileSync(tmpTokenFile, githubToken, 'utf8');
    
    console.log('Attempting to login to GitHub Container Registry...');
    
    try {
      // Login to GitHub Container Registry
      const loginOutput = execSync(
        `cat ${tmpTokenFile} | docker login ghcr.io -u x-access-token --password-stdin`,
        { stdio: 'pipe' }
      ).toString();
      
      console.log('Login successful!');
      
      // Check if we can access ghcr.io/github/github-mcp-server image
      console.log('Checking if we can access the github-mcp-server image...');
      
      try {
        execSync('docker manifest inspect ghcr.io/github/github-mcp-server:latest', { stdio: 'pipe' });
        console.log('Success! We can access the GitHub MCP server image.');
        
        // Cleanup
        fs.unlinkSync(tmpTokenFile);
        return true;
      } catch (error: any) {
        console.error('Could not access the image. Permission issues or the image does not exist.');
        console.error('Error:', error.message);
        return false;
      }
    } catch (loginError: any) {
      console.error('Failed to login to GitHub Container Registry:', loginError.message);
      return false;
    } finally {
      if (fs.existsSync(tmpTokenFile)) {
        fs.unlinkSync(tmpTokenFile);
      }
    }
  } catch (error: any) {
    console.error('Error during authentication test:', error.message);
    return false;
  }
}

// Function to store the GitHub token in Secrets Manager
async function storeGitHubTokenInSecretManager(secretName: string): Promise<string | null> {
  console.log(`\nStoring GitHub token in AWS Secrets Manager as ${secretName}...`);
  
  try {
    // Check if secret already exists
    try {
      await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
      
      // If we get here, secret exists, so update it
      console.log('Secret already exists. Updating...');
      const updateResponse = await secretsClient.send(new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: JSON.stringify({ githubToken })
      }));
      
      console.log('Secret updated successfully!');
      return updateResponse.ARN || null;
    } catch (error) {
      // Secret doesn't exist, create a new one
      console.log('Creating new secret...');
      const createResponse = await secretsClient.send(new CreateSecretCommand({
        Name: secretName,
        SecretString: JSON.stringify({ githubToken })
      }));
      
      console.log('Secret created successfully!');
      return createResponse.ARN || null;
    }
  } catch (error: any) {
    console.error('Error storing token in Secrets Manager:', error.message);
    return null;
  }
}

async function main() {
  try {
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN not found in environment variables');
    }
    
    const serverName = `github-mcp-server-${Date.now().toString().slice(-6)}`;
    const secretName = `github-token-${Date.now().toString().slice(-6)}`;

    console.log(`\n=== Deploying Official GitHub MCP Server ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Transport Mode: SSE (Server-Sent Events)`);
    
    // Test GitHub authentication
    const authSuccess = await testGitHubAuth();
    if (!authSuccess) {
      throw new Error('GitHub authentication failed. Please check your token and permissions.');
    }
    
    // Store GitHub token in Secrets Manager
    const secretArn = await storeGitHubTokenInSecretManager(secretName);
    if (!secretArn) {
      throw new Error('Failed to store GitHub token in Secrets Manager');
    }
    
    // Register a task definition
    console.log('\nStep 3: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `github-mcp-task-${Date.now().toString().slice(-6)}`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '512',  // 0.5 vCPU
      memory: '1024', // 1GB RAM
      executionRoleArn,
      containerDefinitions: [
        {
          name: serverName,
          image: 'ghcr.io/github/github-mcp-server:latest', // GitHub's official MCP server
          essential: true,
          repositoryCredentials: {
            credentialsParameter: secretArn // Reference to the Secret we created
          },
          environment: [
            { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: githubToken },
            { name: 'PORT', value: '8000' },
            { name: 'TRANSPORT', value: 'sse' }
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
    console.log('\nStep 4: Launching Fargate task...');
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
    
    // Delete secret when done (optional - commenting out for safety)
    // await secretsClient.send(new DeleteSecretCommand({
    //   SecretId: secretName,
    //   ForceDeleteWithoutRecovery: true
    // }));
    
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