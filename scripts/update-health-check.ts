/**
 * Script to update health check settings for an existing target group
 * 
 * Usage:
 *   AWS_REGION=us-east-1 npx ts-node -P scripts/tsconfig.json scripts/update-health-check.ts <targetGroupArn>
 */

import { 
  ElasticLoadBalancingV2Client, 
  ModifyTargetGroupCommand,
  DescribeTargetHealthCommand
} from "@aws-sdk/client-elastic-load-balancing-v2";
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Settings
const region = process.env.AWS_REGION || 'us-east-1';

// Create ELB client
const elbClient = new ElasticLoadBalancingV2Client({ region });

async function main() {
  try {
    // Get command-line arguments
    const targetGroupArn = process.argv[2];
    
    if (!targetGroupArn) {
      console.error('ERROR: Target Group ARN is required');
      console.error('Usage: AWS_REGION=us-east-1 npx ts-node -P scripts/tsconfig.json scripts/update-health-check.ts <targetGroupArn>');
      process.exit(1);
    }
    
    console.log(`\n=== Updating Health Check Settings ===`);
    console.log(`Target Group ARN: ${targetGroupArn}`);
    
    // Step 1: Update the target group's health check settings
    console.log('\nStep 1: Updating health check settings...');
    
    const modifyTargetGroupCommand = new ModifyTargetGroupCommand({
      TargetGroupArn: targetGroupArn,
      HealthCheckPath: '/tools',            // GitHub MCP server /tools endpoint
      HealthCheckIntervalSeconds: 30,       // Check every 30 seconds
      HealthCheckTimeoutSeconds: 10,        // 10 second timeout
      HealthyThresholdCount: 2,             // Only need 2 successful checks
      UnhealthyThresholdCount: 5,           // Need 5 failures to be unhealthy
      Matcher: {
        HttpCode: '200-499'                 // Accept any HTTP status code within AWS limits
      }
    });
    
    await elbClient.send(modifyTargetGroupCommand);
    console.log('Health check settings updated successfully');
    
    // Step 2: Monitor target health
    console.log('\nStep 2: Monitoring target health (this may take a few minutes)...');
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
    
    // Final status
    if (isHealthy) {
      console.log('\nTarget is now healthy! The ALB should be working correctly.');
    } else {
      console.log('\nTarget is still unhealthy after multiple checks. You may need to:');
      console.log('1. Check if the MCP server is running correctly');
      console.log('2. Verify the port settings (default 8000)');
      console.log('3. Try a different health check path (e.g., /, /tools, /v1/tools)');
    }
    
  } catch (error) {
    console.error('ERROR:', error);
  }
}

main().catch(console.error); 