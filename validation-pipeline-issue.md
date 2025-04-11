# ToolShed MCP Server Validation Pipeline Issue

## Problem Statement

The ToolShed MCP Server Validation Pipeline is failing to use the correct Docker image in its ECS tasks. While the pipeline successfully builds a new Docker image in CodeBuild, the ECS task continues to use a hardcoded placeholder image (`amazon/amazon-ecs-sample`) instead of the newly built image.

## System Architecture

The validation pipeline consists of several AWS services working together:

1. **AWS Step Functions** - Orchestrates the entire validation process
2. **AWS CodeBuild** - Builds the MCP server Docker image
3. **Amazon ECR** - Stores the built Docker images
4. **Amazon ECS (Fargate)** - Runs the MCP server container for validation
5. **AWS Lambda** - Performs validation checks on the running server

## Current Implementation

### CDK Stack Definition
File: `infrastructure/ValidationPipelineStack.ts`

The ECS task definition is created with a placeholder image:

```typescript
// 6. ECS Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(this, 'MCPServerTaskDef', {
  cpu: 256,
  memoryLimitMiB: 512,
  taskRole,
  executionRole,
});

// Container with placeholder image (will be overridden at runtime)
taskDefinition.addContainer('MCPServerContainer', {
  image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'), // Placeholder
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'mcp-server',
    logRetention: logs.RetentionDays.ONE_WEEK,
  }),
  portMappings: [
    {
      containerPort: 8000,
      hostPort: 8000,
      protocol: ecs.Protocol.TCP,
    },
  ],
  essential: true,
});
```

### Step Functions State Machine
The state machine attempts to override the container image at runtime:

```typescript
// 8.3 ECS Task
const runContainerTask = new tasks.EcsRunTask(this, 'RunMCPServerContainer', {
  cluster,
  taskDefinition,
  launchTarget: new tasks.EcsFargateLaunchTarget({
    platformVersion: ecs.FargatePlatformVersion.LATEST,
  }),
  assignPublicIp: true,
  securityGroups: [securityGroup],
  containerOverrides: [
    {
      containerDefinition: taskDefinition.defaultContainer!,
      // For dynamic image override at runtime, we'll use environment variables
      environment: [
        { name: 'IMAGE_URI', value: sfn.JsonPath.stringAt('$.imageDetails.imageUri') }
      ]
    }
  ],
  integrationPattern: sfn.IntegrationPattern.RUN_JOB,
  resultPath: '$.taskResult',
});
```

### CodeBuild Configuration
The CodeBuild project successfully builds and pushes the image to ECR:

```typescript
const buildProject = new codebuild.Project(this, 'MCPServerBuild', {
  projectName: 'ToolShed-MCP-Server-Build',
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      pre_build: {
        commands: [
          'echo Logging in to Amazon ECR...',
          'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
          'IMAGE_TAG=$(echo $CODEBUILD_BUILD_ID | cut -d ":" -f 2)'
        ]
      },
      build: {
        commands: [
          'echo Building the Docker image...',
          'docker buildx build --progress=plain -t $REPOSITORY_URI:$IMAGE_TAG .'
        ]
      },
      post_build: {
        commands: [
          'echo Pushing the Docker image...',
          'docker push $REPOSITORY_URI:$IMAGE_TAG',
          'docker push $REPOSITORY_URI:latest',
          'echo Writing image definition file...',
          'echo "{\"imageUri\":\"$REPOSITORY_URI:$IMAGE_TAG\",\"serverId\":\"$SERVER_ID\"}" > imageDefinition.json'
        ]
      }
    },
    artifacts: {
      files: ['imageDefinition.json']
    }
  })
});
```

## Observed Behavior

1. The CodeBuild step successfully builds and pushes the image to ECR:
   ```
   The push refers to repository [277502524328.dkr.ecr.us-east-1.amazonaws.com/toolshed-mcp-servers-v2]
   70bd9107b0f8: Pushed
   b336e209998f: Pushed
   ...
   ```

2. The ECS task launches but uses the wrong image:
   ```bash
   $ aws ecs describe-tasks --cluster ToolShed-Validation-Cluster --tasks 6b3919a6e9fe42c8855b1fd162f21666 | jq '.tasks[0].containers[0].image'
   "amazon/amazon-ecs-sample"
   ```

3. The task definition shows the hardcoded image:
   ```bash
   $ aws ecs describe-task-definition --task-definition ValidationPipelineStackMCPServerTaskDef80539BDE | jq '.taskDefinition.containerDefinitions[0].image'
   "amazon/amazon-ecs-sample"
   ```

## Expected Behavior

The ECS task should use the newly built image from ECR (e.g., `277502524328.dkr.ecr.us-east-1.amazonaws.com/toolshed-mcp-servers-v2:latest`) instead of the placeholder image.

## Additional Context

1. **IAM Roles**: The ECS task execution role has proper permissions to pull from ECR:
   ```typescript
   repository.grantPull(executionRole);
   ```

2. **Security Groups**: The ECS task has proper network access:
   ```typescript
   securityGroup.addIngressRule(
     ec2.Peer.anyIpv4(),
     ec2.Port.tcp(8000),
     'Allow MCP server traffic'
   );
   ```

3. **Step Functions Input**: The state machine receives proper input parameters:
   - `repositoryName`
   - `originalRepositoryName`
   - `serverId`

## Implemented Solution

The problem was that container overrides in Step Functions ECS tasks are limited and don't allow directly overriding the container image. We implemented a dynamic task definition registration approach:

1. Removed the static task definition that was using a hardcoded placeholder image

2. Added a new state to the Step Functions workflow that dynamically registers an ECS task definition with the correct image:

```typescript
// 8.3 Register Dynamic Task Definition
const registerTask = new tasks.CallAwsService(this, 'RegisterValidationTaskDef', {
  service: 'ecs',
  action: 'registerTaskDefinition',
  parameters: {
    Family: 'ToolShedValidation',
    NetworkMode: 'awsvpc',
    RequiresCompatibilities: ['FARGATE'],
    Cpu: '256',
    Memory: '512',
    ExecutionRoleArn: executionRole.roleArn,
    TaskRoleArn: taskRole.roleArn,
    ContainerDefinitions: [{
      Name: 'MCPServerContainer',
      Image: sfn.JsonPath.stringAt('$.imageDetails.imageUri'),
      Essential: true,
      Memory: 512,
      LogConfiguration: {
        LogDriver: 'awslogs',
        Options: {
          'awslogs-group': `/ecs/ToolShedValidation`,
          'awslogs-region': this.region,
          'awslogs-stream-prefix': 'mcp-server'
        }
      },
      PortMappings: [
        {
          ContainerPort: 8000,
          HostPort: 8000,
          Protocol: 'tcp'
        }
      ]
    }]
  },
  resultPath: '$.registeredTask',
  iamResources: ['*']
});
```

3. Added a state to run the ECS task using the newly registered task definition:

```typescript
// 8.4 ECS Task - Run the task with the dynamic task definition
const runContainerTask = new tasks.CallAwsService(this, 'RunMCPServerContainer', {
  service: 'ecs',
  action: 'runTask',
  parameters: {
    Cluster: cluster.clusterArn,
    TaskDefinition: sfn.JsonPath.stringAt('$.registeredTask.taskDefinition.taskDefinitionArn'),
    NetworkConfiguration: {
      AwsvpcConfiguration: {
        Subnets: vpc.publicSubnets.map(subnet => subnet.subnetId),
        SecurityGroups: [securityGroup.securityGroupId],
        AssignPublicIp: 'ENABLED'
      }
    },
    LaunchType: 'FARGATE',
    PlatformVersion: 'LATEST'
  },
  iamResources: ['*'],
  integrationPattern: sfn.IntegrationPattern.REQUEST_RESPONSE,
  resultPath: '$.taskResult',
});
```

4. Added a wait state to allow the task to initialize:

```typescript
// 8.4.1 Add a wait state for the task to start up and get a public IP
const waitForTask = new sfn.Wait(this, 'WaitForTaskStartup', {
  time: sfn.WaitTime.duration(cdk.Duration.seconds(60))
});
```

5. Added a state to describe the running task for network information:

```typescript
// 8.4.2 Add a task to describe the running task
const describeTask = new tasks.CallAwsService(this, 'DescribeTask', {
  service: 'ecs',
  action: 'describeTasks',
  parameters: {
    Cluster: cluster.clusterArn,
    Tasks: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.taskResult.tasks[0].taskArn'))
  },
  iamResources: ['*'],
  resultPath: '$.taskDescription'
});
```

6. Updated the validation task to use the task information:

```typescript
// 8.5 Lambda Validation Task
const validateTask = new tasks.LambdaInvoke(this, 'ValidateMCPServer', {
  lambdaFunction: validationFunction,
  payloadResponseOnly: true,
  payload: sfn.TaskInput.fromObject({
    serverId: sfn.JsonPath.stringAt('$.serverId'),
    endpoint: sfn.JsonPath.stringAt('$.taskDescription.Tasks[0].Attachments[0].Details[?(@.Name == "networkConfiguration")].Value.NetworkInterfaces[0].PublicIp'),
    taskArn: sfn.JsonPath.stringAt('$.taskDescription.Tasks[0].TaskArn'),
  }),
  resultPath: '$.validationResult',
});
```

7. Created a dedicated IAM role for the state machine with all required permissions:

```typescript
// Create the state machine role with proper permissions
const stateMachineRole = new iam.Role(this, 'ValidationPipelineRole', {
  assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
  description: 'Role for MCP Server Validation Pipeline State Machine',
});

// Add permissions to register task definitions, run tasks, and pass roles
stateMachineRole.addToPolicy(
  new iam.PolicyStatement({
    actions: [
      'ecs:RegisterTaskDefinition',
      'ecs:RunTask',
      'ecs:DescribeTasks',
      'ecs:StopTask',
      'iam:PassRole'
    ],
    resources: ['*']
  })
);

// Add permission to invoke Lambda functions
stateMachineRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [
      validationFunction.functionArn,
      stopTaskFunction.functionArn
    ]
  })
);

// Add permissions to use CodeBuild
stateMachineRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
    resources: [buildProject.projectArn]
  })
);
```

8. Updated the workflow definition to link all states in sequence and use the new role:

```typescript
// Define the workflow
const definition = buildTask
  .next(parseImageUri)
  .next(registerTask)     // Register dynamic task definition
  .next(runContainerTask) // Run the ECS task with new task definition
  .next(waitForTask)      // Wait for the task to initialize
  .next(describeTask)     // Get task details including networking info
  .next(validateTask)     // Validate the MCP server
  .next(cleanupTask)      // Stop the task
  .next(new sfn.Choice(this, 'CheckValidationResult')
    .when(sfn.Condition.booleanEquals('$.validationResult.body.verified', true), successState)
    .otherwise(failState)
  );

// Create the state machine with the role and definition
const stateMachine = new sfn.StateMachine(this, 'ValidationPipeline', {
  stateMachineName: 'ToolShed-MCP-Server-Validation-Pipeline',
  definition,
  timeout: cdk.Duration.minutes(30),
  tracingEnabled: true,
  role: stateMachineRole
});
```

This solution ensures that the task definition is created dynamically with the correct image URI from the build process, rather than using a static task definition with a placeholder image.

## Testing Results

We successfully tested the solution by:

1. Deploying the updated CDK stack
2. Running the workflow with a specific image URI
3. Confirming that a new task definition was registered with the provided image
4. Verifying that an ECS task was started with that task definition
5. Checking that the Lambda validator received the correct task information

Our manual tests showed that:
1. The task definition was registered correctly
2. The ECS task launched successfully with the specified image
3. The validation step received the correct task information

This confirms our approach is working correctly, and the pipeline now properly registers a dynamic task definition and runs it with the specified image.

## Benefits of the Final Solution

1. **Completely dynamic task definition** - No hardcoded placeholder image
2. **Proper IAM roles and permissions** - State machine has explicit permissions to manage ECS tasks
3. **Better auditability** - Each run creates a new task definition revision
4. **More robust workflow** - Added wait states and task description steps
5. **Simplified architecture** - Removed static task definition and container
6. **Better control** - All task parameters can be customized at runtime

## Relevant Files

1. `infrastructure/ValidationPipelineStack.ts` - Main CDK stack definition
2. `infrastructure/cdk/lambda/index.js` - Lambda validation function
3. `infrastructure/test_specific_step.sh` - Script for testing individual steps
4. Generated CloudFormation template: `infrastructure/cdk.out/ValidationPipelineStack.template.json` 