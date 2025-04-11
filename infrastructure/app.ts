#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import { ValidationPipelineStack } from './ValidationPipelineStack';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Create CDK app
const app = new cdk.App();

// Deploy the validation pipeline stack
new ValidationPipelineStack(app, 'ValidationPipelineStack', {
  // If env variables are present, use them to configure the stack
  vpcId: process.env.AWS_VPC_ID,
  subnetIds: process.env.AWS_SUBNETS?.split(','),
  securityGroupId: process.env.AWS_SECURITY_GROUP_ID,
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME || 'ToolShedServers',
  
  // Set environment for deployment
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: 'us-east-1',
  },
  
  // Add tags
  tags: {
    Project: 'ToolShed',
    Component: 'ValidationPipeline',
  },
});

// Synthesize the CloudFormation template
app.synth(); 