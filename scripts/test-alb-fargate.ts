/**
 * Test script for AWS Fargate container launcher with ALB integration
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/test-alb-fargate.ts [image] [server-name]
 */

import { launchContainer, stopContainer, checkContainerStatus } from '../lib/aws/fargate';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function main() {
  // Configuration
  const dockerImage = process.argv[2] || 'ghcr.io/mcp-community/reference-server';
  const serverName = process.argv[3] || 'test-mcp-server';

  console.log(`\n=== Starting Fargate ALB Test ===`);
  console.log(`Image: ${dockerImage}`);
  console.log(`Server Name: ${serverName}\n`);

  try {
    // Step 1: Launch container with ALB
    console.log('Step 1: Launching container with ALB...');
    const launchResult = await launchContainer({
      image: dockerImage,
      serverName,
    });

    if (!launchResult.success) {
      console.error(`Failed to launch container: ${launchResult.error}`);
      return;
    }

    console.log(`Container launched successfully!`);
    console.log(`Endpoint: ${launchResult.endpoint}`);
    console.log(`Task ARN: ${launchResult.taskArn}`);

    // Step 2: Wait for ALB health checks to pass
    console.log('\nStep 2: Waiting for service to become available (30 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Step 3: Test connectivity
    console.log('\nStep 3: Testing connectivity to endpoint...');
    try {
      const response = await axios.get(`${launchResult.endpoint}`, {
        timeout: 10000
      });
      
      console.log(`Connection successful! Status: ${response.status}`);
      console.log(`Server Response: ${JSON.stringify(response.data, null, 2).substring(0, 500)}...`);
    } catch (error) {
      console.error(`Connection failed:`, error);
    }

    // Step 4: Keep the task running for testing
    console.log('\nStep 4: Task will keep running for 5 minutes for testing...');
    console.log(`To stop manually, run: aws ecs stop-task --cluster ToolShedCluster --task ${launchResult.taskArn?.split('/').pop()}`);
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes

    // Step 5: Stop the container
    console.log('\nStep 5: Stopping container...');
    const stopResult = await stopContainer(launchResult.taskArn!);
    
    if (stopResult.success) {
      console.log('Container stopped successfully!');
    } else {
      console.error(`Failed to stop container: ${stopResult.error}`);
    }
  } catch (error) {
    console.error('Error in test script:', error);
  }
}

main().catch(console.error); 