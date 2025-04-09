/**
 * Test script for AWS Fargate container launcher
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/test-fargate.ts
 */

import { launchContainer, stopContainer, checkContainerStatus } from '../lib/aws/fargate';

async function main() {
  // Configuration
  const dockerImage = process.argv[2] || 'nginx:latest'; // Use nginx as a simple test image
  const serverName = process.argv[3] || 'Test Server';

  console.log(`\n=== Starting Fargate Test ===`);
  console.log(`Image: ${dockerImage}`);
  console.log(`Server Name: ${serverName}\n`);

  try {
    // Step 1: Launch container
    console.log('Step 1: Launching container...');
    const launchResult = await launchContainer({
      image: dockerImage,
      serverName: serverName,
    });

    if (!launchResult.success) {
      console.error(`Failed to launch container: ${launchResult.error}`);
      return;
    }

    console.log(`Container launched successfully!`);
    console.log(`Endpoint: ${launchResult.endpoint}`);
    console.log(`Task ARN: ${launchResult.taskArn}`);

    // Step 2: Check status after launch
    if (launchResult.taskArn) {
      console.log('\nStep 2: Checking container status...');
      const statusResult = await checkContainerStatus(launchResult.taskArn);
      
      if (statusResult.error) {
        console.error(`Failed to check container status: ${statusResult.error}`);
      } else {
        console.log(`Container status: ${statusResult.status}`);
        console.log(`Running: ${statusResult.running}`);
      }

      // Step 3: Prompt to stop the container
      console.log('\nStep 3: Container management');
      console.log('The container is now running. Press any key to stop it, or Ctrl+C to leave it running.');
      
      // Wait for user input
      await new Promise<void>((resolve) => {
        process.stdin.setRawMode!(true);
        process.stdin.resume();
        process.stdin.once('data', () => {
          process.stdin.setRawMode!(false);
          process.stdin.pause();
          resolve();
        });
      });

      // Step 4: Stop the container
      console.log('\nStep 4: Stopping container...');
      const stopResult = await stopContainer(launchResult.taskArn);
      
      if (!stopResult.success) {
        console.error(`Failed to stop container: ${stopResult.error}`);
      } else {
        console.log('Container stopped successfully!');
      }
    }

    console.log('\n=== Fargate Test Complete ===\n');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
main().catch(console.error); 