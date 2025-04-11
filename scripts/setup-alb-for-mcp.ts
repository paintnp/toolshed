/**
 * Script to set up an Application Load Balancer (ALB) for a running MCP server
 * 
 * Usage:
 *   AWS_REGION=us-east-1 npx ts-node -P scripts/tsconfig.json scripts/setup-alb-for-mcp.ts <privateIP> <port>
 */

import { 
  ElasticLoadBalancingV2Client, 
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  CreateListenerCommand,
  RegisterTargetsCommand,
  DescribeTargetHealthCommand
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { EC2Client, DescribeSubnetsCommand } from "@aws-sdk/client-ec2";
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Settings
const region = process.env.AWS_REGION || 'us-east-1';
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

// Create clients
const elbClient = new ElasticLoadBalancingV2Client({ region });
const ec2Client = new EC2Client({ region });

async function main() {
  try {
    // Get command-line arguments
    const privateIp = process.argv[2];
    const port = parseInt(process.argv[3] || '8000');
    
    if (!privateIp) {
      console.error('ERROR: Private IP address is required');
      console.error('Usage: npx ts-node -P scripts/tsconfig.json scripts/setup-alb-for-mcp.ts <privateIP> [port=8000]');
      process.exit(1);
    }
    
    console.log(`\n=== Setting up ALB for MCP Server ===`);
    console.log(`Target IP: ${privateIp}`);
    console.log(`Target Port: ${port}\n`);
    
    // Create a unique name for the ALB and target group
    const timestamp = Date.now().toString().slice(-6);
    const albName = `mcp-alb-${timestamp}`;
    const targetGroupName = `mcp-tg-${timestamp}`;
    
    // Step 1: Get VPC ID from subnets
    console.log('Step 1: Getting VPC ID from subnets...');
    const describeSubnetsCommand = new DescribeSubnetsCommand({
      SubnetIds: subnets
    });
    
    const subnetsResponse = await ec2Client.send(describeSubnetsCommand);
    if (!subnetsResponse.Subnets || subnetsResponse.Subnets.length === 0) {
      throw new Error('No subnets found');
    }
    
    const vpcId = subnetsResponse.Subnets[0].VpcId;
    if (!vpcId) {
      throw new Error('VPC ID not found');
    }
    
    console.log(`Found VPC ID: ${vpcId}`);
    
    // Step 2: Create target group
    console.log('\nStep 2: Creating target group...');
    const createTargetGroupCommand = new CreateTargetGroupCommand({
      Name: targetGroupName,
      Protocol: 'HTTP',
      Port: port,
      VpcId: vpcId,
      TargetType: 'ip',
      HealthCheckProtocol: 'HTTP',
      HealthCheckPath: '/',
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 10,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 5,
      Matcher: {
        HttpCode: '200-499'
      }
    });
    
    const targetGroupResult = await elbClient.send(createTargetGroupCommand);
    
    if (!targetGroupResult.TargetGroups || targetGroupResult.TargetGroups.length === 0) {
      throw new Error('Failed to create target group');
    }
    
    const targetGroupArn = targetGroupResult.TargetGroups[0].TargetGroupArn;
    console.log(`Created target group: ${targetGroupName} with ARN: ${targetGroupArn}`);
    
    // Step 3: Create ALB
    console.log('\nStep 3: Creating ALB...');
    const createLoadBalancerCommand = new CreateLoadBalancerCommand({
      Name: albName,
      Subnets: subnets,
      SecurityGroups: securityGroups,
      Scheme: 'internet-facing',
      Type: 'application',
      IpAddressType: 'ipv4'
    });
    
    const albResult = await elbClient.send(createLoadBalancerCommand);
    
    if (!albResult.LoadBalancers || albResult.LoadBalancers.length === 0) {
      throw new Error('Failed to create ALB');
    }
    
    const alb = albResult.LoadBalancers[0];
    console.log(`Created ALB: ${albName} with ARN: ${alb.LoadBalancerArn}`);
    console.log(`ALB DNS Name: ${alb.DNSName}`);
    
    // Step 4: Create listener
    console.log('\nStep 4: Creating listener...');
    const createListenerCommand = new CreateListenerCommand({
      LoadBalancerArn: alb.LoadBalancerArn,
      Protocol: 'HTTP',
      Port: 80,
      DefaultActions: [
        {
          Type: 'forward',
          TargetGroupArn: targetGroupArn
        }
      ]
    });
    
    await elbClient.send(createListenerCommand);
    console.log(`Created listener for ALB: ${albName}`);
    
    // Step 5: Register target
    console.log('\nStep 5: Registering target...');
    const registerTargetsCommand = new RegisterTargetsCommand({
      TargetGroupArn: targetGroupArn,
      Targets: [
        {
          Id: privateIp,
          Port: port
        }
      ]
    });
    
    await elbClient.send(registerTargetsCommand);
    console.log(`Registered target: ${privateIp}:${port}`);
    
    // Step 6: Monitor target health
    console.log('\nStep 6: Monitoring target health (this may take a few minutes)...');
    let isHealthy = false;
    let attempts = 0;
    const maxAttempts = 20;
    
    while (!isHealthy && attempts < maxAttempts) {
      attempts++;
      
      console.log(`Health check attempt ${attempts}/${maxAttempts}...`);
      
      const targetHealthCommand = new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroupArn
      });
      
      const healthResult = await elbClient.send(targetHealthCommand);
      
      if (healthResult.TargetHealthDescriptions && healthResult.TargetHealthDescriptions.length > 0) {
        const health = healthResult.TargetHealthDescriptions[0];
        const state = health.TargetHealth?.State;
        const reason = health.TargetHealth?.Reason;
        const desc = health.TargetHealth?.Description;
        
        console.log(`Health state: ${state}, reason: ${reason}, description: ${desc}`);
        
        if (state === 'healthy') {
          isHealthy = true;
          break;
        }
      }
      
      if (!isHealthy) {
        console.log('Waiting 15 seconds before next check...');
        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds
      }
    }
    
    // Final instructions
    console.log('\n=== ALB Setup Complete ===');
    console.log(`ALB DNS Name: ${alb.DNSName}`);
    console.log(`You can access your MCP server at: http://${alb.DNSName}`);
    console.log('\nNote: It may take a few minutes for DNS to propagate and health checks to pass.');
    console.log('If the server is not immediately accessible, please wait and try again.');
    console.log('\nThe MCP server should expose endpoints like:');
    console.log(`  - http://${alb.DNSName}/tools - List available tools`);
    console.log(`  - http://${alb.DNSName}/execute - Execute a tool`);
    
  } catch (error) {
    console.error('ERROR:', error);
  }
}

main().catch(console.error); 