import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Minimal stack for bootstrapping
class BootstrapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // No resources needed for bootstrapping
  }
}

const app = new cdk.App();
new BootstrapStack(app, 'BootstrapStack'); 