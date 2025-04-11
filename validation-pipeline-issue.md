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
      { name: 'IMAGE_URI', value: sfn.JsonPath.stringAt('$.imageDetails.imageUri') }
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

## Questions for Investigation

1. Is the container override in the Step Functions ECS task state properly configured to change the container image rather than just setting an environment variable?
2. Should we be using a different method to override the container image at runtime?
3. Is there a way to make the task definition more dynamic to avoid needing runtime overrides?
4. Are there any limitations or known issues with ECS task container overrides in Step Functions?

## Relevant Files

1. `infrastructure/ValidationPipelineStack.ts` - Main CDK stack definition
2. `monitor-logs.sh` - Script for monitoring pipeline execution
3. `lib/aws/fargate.ts` - Fargate configuration utilities
4. Generated CloudFormation template: `infrastructure/cdk.out/ValidationPipelineStack.template.json`

## Current Workaround

Currently, there is no workaround in place. The pipeline fails to properly validate MCP servers because it's running the wrong container image. 