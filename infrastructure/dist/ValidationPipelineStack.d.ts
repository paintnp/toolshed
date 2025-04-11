import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface ValidationPipelineStackProps extends cdk.StackProps {
    vpcId?: string;
    subnetIds?: string[];
    securityGroupId?: string;
    dynamoDbTableName?: string;
}
export declare class ValidationPipelineStack extends cdk.Stack {
    readonly stateMachineArn: string;
    constructor(scope: Construct, id: string, props?: ValidationPipelineStackProps);
}
