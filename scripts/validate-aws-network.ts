#!/usr/bin/env ts-node

import { 
  EC2Client, 
  DescribeSubnetsCommand,
  DescribeRouteTablesCommand,
  DescribeInternetGatewaysCommand
} from "@aws-sdk/client-ec2";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Create EC2 client
const region = process.env.AWS_REGION || 'us-east-1';
console.log(`Using AWS region: ${region}`);
const ec2Client = new EC2Client({ region });

/**
 * Verify that a subnet is truly public
 * - Must have MapPublicIpOnLaunch enabled
 * - Must have a route table with a route to an Internet Gateway
 */
async function validateSubnetPublicAccess(subnetId: string) {
  try {
    // Step 1: Get subnet details
    const subnetResponse = await ec2Client.send(new DescribeSubnetsCommand({
      SubnetIds: [subnetId]
    }));
    
    if (!subnetResponse.Subnets || subnetResponse.Subnets.length === 0) {
      console.error(`❌ Subnet ${subnetId} not found`);
      return false;
    }
    
    const subnet = subnetResponse.Subnets[0];
    const vpcId = subnet.VpcId;
    
    // Step 2: Check if subnet assigns public IPs
    const assignsPublicIp = subnet.MapPublicIpOnLaunch || false;
    console.log(`Subnet ${subnetId} auto-assigns public IPs: ${assignsPublicIp ? '✅ Yes' : '❌ No'}`);
    
    // Step 3: Find subnet's route table
    const routeTableResponse = await ec2Client.send(new DescribeRouteTablesCommand({
      Filters: [
        {
          Name: 'association.subnet-id',
          Values: [subnetId]
        }
      ]
    }));
    
    // If no explicit route table association, find the main route table for the VPC
    let routeTables = routeTableResponse.RouteTables || [];
    if (routeTables.length === 0) {
      const mainRouteTableResponse = await ec2Client.send(new DescribeRouteTablesCommand({
        Filters: [
          {
            Name: 'vpc-id',
            Values: [vpcId as string]
          },
          {
            Name: 'association.main',
            Values: ['true']
          }
        ]
      }));
      routeTables = mainRouteTableResponse.RouteTables || [];
    }
    
    if (routeTables.length === 0) {
      console.error(`❌ No route table found for subnet ${subnetId}`);
      return false;
    }
    
    // Step 4: Check for route to internet gateway
    let hasIgwRoute = false;
    for (const routeTable of routeTables) {
      console.log(`Examining route table ${routeTable.RouteTableId}`);
      
      const routes = routeTable.Routes || [];
      for (const route of routes) {
        if (route.DestinationCidrBlock === '0.0.0.0/0' && route.GatewayId && route.GatewayId.startsWith('igw-')) {
          hasIgwRoute = true;
          console.log(`✅ Found route to internet gateway: ${route.GatewayId}`);
          break;
        }
      }
      
      if (hasIgwRoute) break;
    }
    
    if (!hasIgwRoute) {
      console.error(`❌ No route to internet gateway found for subnet ${subnetId}`);
    }
    
    // Step 5: Final verdict
    const isPublic = assignsPublicIp && hasIgwRoute;
    console.log(`Subnet ${subnetId} is${isPublic ? '' : ' not'} properly configured for public access`);
    
    return isPublic;
  } catch (error) {
    console.error(`Error validating subnet ${subnetId}:`, error);
    return false;
  }
}

/**
 * Main function to analyze AWS network configuration
 */
async function analyzeAwsNetwork() {
  try {
    console.log('=== AWS Network Configuration Analysis ===\n');
    
    // Get subnet IDs from environment variable
    const subnetIdsString = process.env.AWS_SUBNETS;
    if (!subnetIdsString) {
      console.error('❌ No subnets found in AWS_SUBNETS environment variable');
      return;
    }
    
    const subnetIds = subnetIdsString.split(',').map(id => id.trim());
    console.log(`Found ${subnetIds.length} subnets in AWS_SUBNETS: ${subnetIds.join(', ')}\n`);
    
    // Check VPC Internet Gateway availability
    const firstSubnetResponse = await ec2Client.send(new DescribeSubnetsCommand({
      SubnetIds: [subnetIds[0]]
    }));
    
    if (!firstSubnetResponse.Subnets || firstSubnetResponse.Subnets.length === 0) {
      console.error('❌ Could not retrieve subnet information');
      return;
    }
    
    const vpcId = firstSubnetResponse.Subnets[0].VpcId;
    console.log(`All subnets belong to VPC: ${vpcId}\n`);
    
    // Check if VPC has an internet gateway
    const igwResponse = await ec2Client.send(new DescribeInternetGatewaysCommand({
      Filters: [
        {
          Name: 'attachment.vpc-id',
          Values: [vpcId as string]
        }
      ]
    }));
    
    if (!igwResponse.InternetGateways || igwResponse.InternetGateways.length === 0) {
      console.error(`❌ No Internet Gateway attached to VPC ${vpcId}`);
      console.error('   Tasks will not be able to get public IPs without an Internet Gateway');
      return;
    }
    
    console.log(`✅ Found Internet Gateway: ${igwResponse.InternetGateways[0].InternetGatewayId}\n`);
    
    // Analyze each subnet
    console.log('Analyzing individual subnets:');
    console.log('----------------------------');
    
    const publicSubnets: string[] = [];
    for (const subnetId of subnetIds) {
      console.log(`\nAnalyzing subnet: ${subnetId}`);
      const isPublic = await validateSubnetPublicAccess(subnetId);
      if (isPublic) {
        publicSubnets.push(subnetId);
      }
    }
    
    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total subnets analyzed: ${subnetIds.length}`);
    console.log(`Public subnets found: ${publicSubnets.length}`);
    
    if (publicSubnets.length > 0) {
      console.log(`\n✅ The following subnets can be used for public Fargate tasks:`);
      console.log(publicSubnets.join(', '));
      
      // Recommend update to .env.local
      console.log(`\nRecommended AWS_SUBNETS setting for .env.local:`);
      console.log(`AWS_SUBNETS=${publicSubnets.join(',')}`);
    } else {
      console.error('\n❌ No public subnets found. Fargate tasks will not get public IPs.');
      console.error('   To use Fargate containers with public IPs, you need to:');
      console.error('   1. Ensure your VPC has an Internet Gateway');
      console.error('   2. Configure subnets to auto-assign public IPs');
      console.error('   3. Set up route tables with routes to the Internet Gateway');
    }
    
  } catch (error) {
    console.error('Error analyzing AWS network:', error);
  }
}

// Run the analysis
analyzeAwsNetwork(); 