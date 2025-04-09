import { launchContainer, stopContainer, checkContainerStatus } from '../lib/aws/fargate';
import { 
  ensureLoadBalancer, 
  createTargetGroup, 
  createListener, 
  registerTarget, 
  checkTargetHealth 
} from '../lib/aws/load-balancer';

// Process arguments
const [, , image = 'nginx:latest', serverName = 'Test Server'] = process.argv;

async function runTest() {
  console.log('\n=== Starting Load Balancer Test ===');
  console.log(`Image: ${image}`);
  console.log(`Server Name: ${serverName}\n`);

  // Step 1: Create Load Balancer
  console.log('Step 1: Creating Load Balancer...');
  const lbResult = await ensureLoadBalancer();
  
  if (!lbResult.success) {
    console.error(`Failed to create load balancer: ${lbResult.error}`);
    return;
  }
  
  console.log(`Load Balancer DNS Name: ${lbResult.dnsName}`);
  
  // Step 2: Launch Fargate container
  console.log('\nStep 2: Launching container...');
  const launchResult = await launchContainer({
    image,
    serverName,
    containerPort: 80 // Using nginx's default port
  });
  
  if (!launchResult.success) {
    console.error(`Failed to launch container: ${launchResult.error}`);
    return;
  }
  
  const taskArn = launchResult.taskArn;
  console.log('Container launched successfully!');
  
  if (!launchResult.endpoint) {
    console.error('Failed to get container endpoint');
    return;
  }
  
  // Extract private IP from endpoint
  const privateIpMatch = launchResult.endpoint.match(/http:\/\/([^:]+):/);
  const privateIp = privateIpMatch ? privateIpMatch[1] : null;
  
  if (!privateIp) {
    console.error('Failed to extract private IP from endpoint');
    return;
  }
  
  console.log(`Container Private IP: ${privateIp}`);
  
  // Step 3: Create target group and register container
  console.log('\nStep 3: Setting up load balancer target group...');
  
  // We need VPC ID for this
  if (!process.env.AWS_VPC_ID) {
    console.error('AWS_VPC_ID environment variable not set');
    return;
  }
  
  const tgResult = await createTargetGroup({
    vpcId: process.env.AWS_VPC_ID,
    port: 80
  });
  
  if (!tgResult.success) {
    console.error(`Failed to create target group: ${tgResult.error}`);
    return;
  }
  
  // Create listener
  const listenerResult = await createListener({
    loadBalancerArn: lbResult.loadBalancerArn!,
    targetGroupArn: tgResult.targetGroupArn!,
    port: 80
  });
  
  if (!listenerResult.success) {
    console.error(`Failed to create listener: ${listenerResult.error}`);
    return;
  }
  
  // Register container with target group
  const registerResult = await registerTarget({
    targetGroupArn: tgResult.targetGroupArn!,
    privateIp,
    port: 80
  });
  
  if (!registerResult.success) {
    console.error(`Failed to register target: ${registerResult.error}`);
    return;
  }
  
  console.log('Container registered with load balancer');
  console.log(`Public endpoint: http://${lbResult.dnsName}`);
  console.log('\nNOTE: It may take a few minutes for the load balancer to become available and for the target to pass health checks');
  
  // Step 4: Container management
  console.log('\nStep 4: Container management');
  console.log('The container is now running behind the load balancer.');
  console.log('Press any key to stop it, or Ctrl+C to leave it running.');
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async () => {
    // Step 5: Cleanup
    console.log('\nStep 5: Stopping container...');
    
    if (taskArn) {
      const stopResult = await stopContainer(taskArn);
      
      if (stopResult.success) {
        console.log('Container stopped successfully!');
      } else {
        console.error(`Failed to stop container: ${stopResult.error}`);
      }
    }
    
    console.log('\n=== Load Balancer Test Complete ===\n');
    process.exit(0);
  });
}

runTest().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
}); 