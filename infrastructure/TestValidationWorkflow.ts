import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Creates a test state machine that skips the build step to directly test:
 * 1. Register task definition
 * 2. Run ECS task
 * 3. Wait for task startup
 * 4. Get task details
 * 5. Call validation Lambda
 * 6. Cleanup
 */
export class TestValidationWorkflow extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing roles
    const taskRole = iam.Role.fromRoleName(this, 'ImportedTaskRole', 'ToolShed-Validation-MCP-Server-Task-Role');
    const executionRole = iam.Role.fromRoleName(this, 'ImportedExecutionRole', 'ToolShed-Validation-MCP-Server-Execution-Role');
    
    // Import the cluster
    const cluster = {
      clusterArn: cdk.Fn.importValue('ValidationPipelineStack:ClusterArn')
    };
    
    // Get the security group ID and subnets from the outputs
    const securityGroupId = cdk.Fn.importValue('ValidationPipelineStack:SecurityGroupId');
    const publicSubnet1 = cdk.Fn.importValue('ValidationPipelineStack:PublicSubnet1');
    const publicSubnet2 = cdk.Fn.importValue('ValidationPipelineStack:PublicSubnet2');

    // Step 1: Register Task Definition
    const registerTask = new tasks.CallAwsService(this, 'RegisterValidationTaskDef', {
      service: 'ecs',
      action: 'registerTaskDefinition',
      parameters: {
        Family: 'ToolShedTestValidation',
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
        Cpu: '256',
        Memory: '512',
        ExecutionRoleArn: executionRole.roleArn,
        TaskRoleArn: taskRole.roleArn,
        ContainerDefinitions: [{
          Name: 'TestContainer',
          Image: sfn.JsonPath.stringAt('$.imageUri'),
          Essential: true,
          Memory: 512,
          LogConfiguration: {
            LogDriver: 'awslogs',
            Options: {
              'awslogs-group': `/ecs/ToolShedTestValidation`,
              'awslogs-region': this.region,
              'awslogs-stream-prefix': 'test-container'
            }
          },
          PortMappings: [
            {
              ContainerPort: 80,
              HostPort: 80,
              Protocol: 'tcp'
            }
          ]
        }]
      },
      resultPath: '$.registeredTask',
      iamResources: ['*']
    });

    // Step 2: Run Task
    const runTask = new tasks.CallAwsService(this, 'RunValidationTask', {
      service: 'ecs',
      action: 'runTask',
      parameters: {
        Cluster: cluster.clusterArn,
        TaskDefinition: sfn.JsonPath.stringAt('$.registeredTask.taskDefinition.taskDefinitionArn'),
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            Subnets: [publicSubnet1, publicSubnet2],
            SecurityGroups: [securityGroupId],
            AssignPublicIp: 'ENABLED'
          }
        },
        LaunchType: 'FARGATE',
        PlatformVersion: 'LATEST'
      },
      iamResources: ['*'],
      integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
      resultPath: '$.runResult',
    });

    // Step 3: Wait for task to start up
    const waitForTask = new sfn.Wait(this, 'WaitForTaskStartup', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60))
    });

    // Step 4: Describe the task to get details
    const describeTask = new tasks.CallAwsService(this, 'DescribeTask', {
      service: 'ecs',
      action: 'describeTasks',
      parameters: {
        Cluster: cluster.clusterArn,
        Tasks: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.runResult.tasks[0].taskArn'))
      },
      iamResources: ['*'],
      resultPath: '$.taskDescription'
    });

    // Step 5: Dummy Validation (log the results to CloudWatch)
    const validateTask = new sfn.Pass(this, 'ValidateTask', {
      parameters: {
        validation: {
          taskArn: sfn.JsonPath.stringAt('$.taskDescription.tasks[0].taskArn'),
          status: sfn.JsonPath.stringAt('$.taskDescription.tasks[0].lastStatus'),
          containerImage: sfn.JsonPath.stringAt('$.taskDescription.tasks[0].containers[0].image'),
          taskDefinition: sfn.JsonPath.stringAt('$.taskDescription.tasks[0].taskDefinitionArn')
        }
      },
      resultPath: '$.validationResult'
    });

    // Step 6: Cleanup (stop the task)
    const cleanupTask = new tasks.CallAwsService(this, 'StopTask', {
      service: 'ecs',
      action: 'stopTask',
      parameters: {
        Cluster: cluster.clusterArn,
        Task: sfn.JsonPath.stringAt('$.taskDescription.tasks[0].taskArn'),
        Reason: 'Test completed'
      },
      iamResources: ['*'],
      resultPath: '$.cleanupResult'
    });

    // Success state
    const successState = new sfn.Succeed(this, 'ValidationSucceeded', {
      comment: 'Validation completed successfully'
    });

    // Define the workflow
    const definition = registerTask
      .next(runTask)
      .next(waitForTask)
      .next(describeTask)
      .next(validateTask)
      .next(cleanupTask)
      .next(successState);

    // Create the state machine
    this.stateMachine = new sfn.StateMachine(this, 'TestValidationWorkflow', {
      definition,
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: true,
    });

    // Grant the state machine permission to pass IAM roles
    this.stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          executionRole.roleArn,
          taskRole.roleArn
        ]
      })
    );

    // Export the state machine ARN
    new cdk.CfnOutput(this, 'TestStateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'ARN of the test validation workflow state machine',
      exportName: 'TestValidationWorkflowStateMachineArn',
    });
  }
} 