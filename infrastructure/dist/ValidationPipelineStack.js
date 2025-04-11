"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationPipelineStack = void 0;
const cdk = require("aws-cdk-lib");
const ecr = require("aws-cdk-lib/aws-ecr");
const codebuild = require("aws-cdk-lib/aws-codebuild");
const ecs = require("aws-cdk-lib/aws-ecs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const sfn = require("aws-cdk-lib/aws-stepfunctions");
const tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const logs = require("aws-cdk-lib/aws-logs");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const path = require("path");
class ValidationPipelineStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Get VPC from props or create a new one
        let vpc;
        if (props?.vpcId) {
            vpc = ec2.Vpc.fromVpcAttributes(this, 'ExistingVpc', {
                vpcId: props.vpcId,
                availabilityZones: ['us-east-1a', 'us-east-1b'], // Replace with your AZs
                publicSubnetIds: props.subnetIds,
            });
        }
        else {
            vpc = new ec2.Vpc(this, 'ValidationVpc', {
                maxAzs: 2,
                natGateways: 1,
            });
        }
        // Security group for ECS tasks
        let securityGroup;
        if (props?.securityGroupId) {
            securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedSecurityGroup', props.securityGroupId);
        }
        else {
            securityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
                vpc,
                description: 'Security group for MCP Server validation tasks',
                allowAllOutbound: true,
            });
            // Allow inbound traffic on port 8000 (typical MCP server port)
            securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8000), 'Allow MCP server traffic');
        }
        // 1. ECR Repository for MCP Server Images
        const repository = new ecr.Repository(this, 'MCPServerRepo', {
            repositoryName: 'toolshed-mcp-servers-v2',
            lifecycleRules: [
                {
                    description: 'Keep only the last 100 images',
                    maxImageCount: 100,
                    rulePriority: 1,
                },
            ],
        });
        // 2. GitHub Secret
        // We assume a GitHub token is stored in Secrets Manager
        const githubTokenSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GitHubToken', 'toolshed/github-token');
        // Docker Hub Secret
        const dockerHubSecret = secretsmanager.Secret.fromSecretNameV2(this, 'DockerHubCredentials', 'toolshed/dockerhub-credentials');
        // 3. CodeBuild Project
        const buildProject = new codebuild.Project(this, 'MCPServerBuild', {
            projectName: 'ToolShed-MCP-Server-Build',
            description: 'Builds Docker images for MCP servers',
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
                privileged: true, // Required for Docker builds
            },
            environmentVariables: {
                REPOSITORY_URI: {
                    value: repository.repositoryUri,
                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                },
                GITHUB_TOKEN: {
                    value: githubTokenSecret.secretArn,
                    type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
                },
                DOCKERHUB_USERNAME: {
                    value: `${dockerHubSecret.secretArn}:username`,
                    type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
                },
                DOCKERHUB_TOKEN: {
                    value: `${dockerHubSecret.secretArn}:token`,
                    type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
                },
                // Enable Docker BuildKit for advanced Docker features like --mount
                DOCKER_BUILDKIT: {
                    value: '1',
                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                },
            },
            // Replace external buildspec with inline definition
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
                            'echo Logging in to Docker Hub...',
                            'echo $DOCKERHUB_TOKEN | docker login -u $DOCKERHUB_USERNAME --password-stdin',
                            'REPO_URL=$(echo $CODEBUILD_INITIATOR | cut -d/ -f2)',
                            'REPO_NAME=$(echo $REPO_URL | cut -d@ -f1)',
                            'echo "Original repository name: $ORIGINAL_REPOSITORY_NAME"',
                            'TIMESTAMP=$(date +%Y%m%d%H%M%S)',
                            'echo "Create a sanitized image tag name (replace slashes with dashes)"',
                            'SANITIZED_REPO_NAME=$(echo $REPOSITORY_NAME | tr "/" "-")',
                            'echo "Use timestamp as fallback if CODEBUILD_RESOLVED_SOURCE_VERSION is empty"',
                            'SOURCE_VERSION=${CODEBUILD_RESOLVED_SOURCE_VERSION:-$TIMESTAMP}',
                            'echo "Important: Do not include a colon in IMAGE_TAG as it will be used in $REPOSITORY_URI:$IMAGE_TAG"',
                            'IMAGE_TAG="${SANITIZED_REPO_NAME}-${SOURCE_VERSION}"',
                            'echo "Using image tag: $IMAGE_TAG"'
                        ]
                    },
                    build: {
                        commands: [
                            'echo Cloning repository...',
                            'echo "Using repository name: $REPOSITORY_NAME"',
                            'echo "Using original repository name: $ORIGINAL_REPOSITORY_NAME"',
                            'echo "Using server ID: $SERVER_ID"',
                            'echo "Always use the ORIGINAL_REPOSITORY_NAME for git clone as it has the correct format with slashes"',
                            'echo "Cloning from: $ORIGINAL_REPOSITORY_NAME"',
                            'git clone "https://$GITHUB_TOKEN@github.com/$ORIGINAL_REPOSITORY_NAME.git" repo',
                            'cd repo',
                            'echo Building the Docker image...',
                            'echo "Docker image tag: $REPOSITORY_URI:$IMAGE_TAG"',
                            // Verify BuildKit is enabled
                            'echo "Enabling Docker BuildKit explicitly..."',
                            'export DOCKER_BUILDKIT=1',
                            'export DOCKER_BUILDX_EXPERIMENTAL=1',
                            // Use docker buildx build instead of plain docker build to ensure BuildKit usage
                            'docker buildx install || echo "Buildx already installed"',
                            'docker buildx create --use --name codebuild_builder || echo "Builder exists or couldn\'t be created"',
                            // Add a fallback strategy to modify the Dockerfile if it contains BuildKit-specific directives
                            'echo "Checking Dockerfile for BuildKit-specific directives..."',
                            'if grep -q "\\-\\-mount=type=cache" Dockerfile; then echo "BuildKit cache mount found, creating compatible version"; cp Dockerfile Dockerfile.original; sed "s/RUN --mount=type=cache/RUN/" Dockerfile > Dockerfile.nobuildkit; fi',
                            // Try with buildx first, then fallback to regular build if that fails, with further fallback to no-cache build and finally a build with modified Dockerfile
                            'docker buildx build --progress=plain -t $REPOSITORY_URI:$IMAGE_TAG . || (echo "Docker buildx build failed, trying legacy build without cache..."; docker build --no-cache -t $REPOSITORY_URI:$IMAGE_TAG . || (echo "Docker build failed, checking if we need to use modified Dockerfile..."; if [ -f Dockerfile.nobuildkit ]; then echo "Trying build with BuildKit-compatible Dockerfile"; docker build -f Dockerfile.nobuildkit -t $REPOSITORY_URI:$IMAGE_TAG . || (echo "All build attempts failed, showing Dockerfile"; cat Dockerfile; exit 1); else echo "No BuildKit directives found to modify. Build failed."; cat Dockerfile; exit 1; fi))',
                            'docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest'
                        ]
                    },
                    post_build: {
                        commands: [
                            'echo Pushing the Docker image...',
                            // Add error handling for the Docker push commands
                            'docker push $REPOSITORY_URI:$IMAGE_TAG || (echo "Docker push failed, verifying image exists..."; docker images; exit 1)',
                            'docker push $REPOSITORY_URI:latest || echo "Warning: Failed to push latest tag, but build ID tag was pushed successfully"',
                            'echo Writing image definition file...',
                            'echo "{\"imageUri\":\"$REPOSITORY_URI:$IMAGE_TAG\",\"serverId\":\"$SERVER_ID\"}" > imageDefinition.json'
                        ]
                    }
                },
                artifacts: {
                    files: ['imageDefinition.json']
                }
            }),
        });
        // Grant permissions to the CodeBuild project
        repository.grantPullPush(buildProject);
        // 4. ECS Cluster
        const cluster = new ecs.Cluster(this, 'ValidationCluster', {
            vpc,
            clusterName: 'ToolShed-Validation-Cluster',
        });
        // 5. ECS Task Role and Execution Role
        const taskRole = new iam.Role(this, 'MCPServerTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            roleName: 'ToolShed-Validation-MCP-Server-Task-Role',
            description: 'Role for MCP server tasks',
        });
        const executionRole = new iam.Role(this, 'MCPServerExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            roleName: 'ToolShed-Validation-MCP-Server-Execution-Role',
            description: 'Execution role for MCP server tasks',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        // Give the execution role permissions to pull from ECR
        repository.grantPull(executionRole);
        // 6. ECS Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'MCPServerTaskDef', {
            cpu: 256,
            memoryLimitMiB: 512,
            taskRole,
            executionRole,
        });
        // Container with base image from our ECR repository
        taskDefinition.addContainer('MCPServerContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
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
        // 7. Lambda Function for Validation
        const validationFunction = new lambda.Function(this, 'ValidationFunction', {
            functionName: 'ToolShed-MCP-Server-Validation',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, 'cdk/lambda')),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                DYNAMODB_TABLE: props?.dynamoDbTableName || 'ToolShedServers',
            },
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [securityGroup],
        });
        // Grant the Lambda function permissions to update DynamoDB
        validationFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:PutItem',
            ],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${props?.dynamoDbTableName || 'ToolShedServers'}`,
            ],
        }));
        // 8. Step Functions State Machine
        // 8.1 CodeBuild Task
        const buildTask = new tasks.CodeBuildStartBuild(this, 'BuildMCPServerImage', {
            project: buildProject,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            environmentVariablesOverride: {
                REPOSITORY_NAME: {
                    value: sfn.JsonPath.stringAt('$.repositoryName'),
                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                },
                ORIGINAL_REPOSITORY_NAME: {
                    value: sfn.JsonPath.stringAt('$.originalRepositoryName'),
                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                },
                SERVER_ID: {
                    value: sfn.JsonPath.stringAt('$.serverId'),
                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                }
            },
            resultPath: '$.buildResult',
        });
        // 8.2 Parse Build Output
        const parseImageUri = new sfn.Pass(this, 'ParseImageUri', {
            parameters: {
                imageUri: sfn.JsonPath.stringAt('$.buildResult.Build.Artifacts.Location'), // Will need post-processing
                serverId: sfn.JsonPath.stringAt('$.serverId'),
            },
            resultPath: '$.imageDetails',
        });
        // 8.3 ECS Task
        const runContainerTask = new tasks.EcsRunTask(this, 'RunMCPServerContainer', {
            cluster,
            taskDefinition,
            launchTarget: new tasks.EcsFargateLaunchTarget({
                platformVersion: ecs.FargatePlatformVersion.LATEST,
            }),
            assignPublicIp: true,
            securityGroups: [securityGroup],
            overrideTaskDefinitionProps: {
                containerDefinitions: [{
                        name: 'MCPServerContainer',
                        image: sfn.JsonPath.stringAt('$.imageDetails.imageUri')
                    }]
            },
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            resultPath: '$.taskResult',
        });
        // 8.4 Lambda Validation Task
        const validateTask = new tasks.LambdaInvoke(this, 'ValidateMCPServer', {
            lambdaFunction: validationFunction,
            payloadResponseOnly: true,
            payload: sfn.TaskInput.fromObject({
                serverId: sfn.JsonPath.stringAt('$.serverId'),
                endpoint: sfn.JsonPath.stringAt('$.taskResult.Attachments[0].Details[?(@.Name == "networkConfiguration")].Value.NetworkInterfaces[0].PublicIp'),
                taskArn: sfn.JsonPath.stringAt('$.taskResult.TaskArn'),
            }),
            resultPath: '$.validationResult',
        });
        // 8.5 Use a Lambda function to stop the task instead
        const stopTaskFunction = new lambda.Function(this, 'StopTaskFunction', {
            functionName: 'ToolShed-Stop-ECS-Task',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline(`
        const { ECSClient, StopTaskCommand } = require("@aws-sdk/client-ecs");
        
        exports.handler = async (event) => {
          const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
          
          try {
            const stopTaskCommand = new StopTaskCommand({
              cluster: process.env.CLUSTER_ARN,
              task: event.taskArn,
              reason: 'Stopped by Step Functions'
            });
            
            await ecsClient.send(stopTaskCommand);
            
            return { 
              success: true, 
              taskArn: event.taskArn 
            };
          } catch (error) {
            console.error('Error stopping task:', error);
            throw error;
          }
        }
      `),
            environment: {
                CLUSTER_ARN: cluster.clusterArn
            },
            timeout: cdk.Duration.seconds(30)
        });
        // Grant permission to stop tasks
        stopTaskFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ecs:StopTask'],
            resources: ['*']
        }));
        // Replace EcsRunTask with LambdaInvoke for cleanup
        const cleanupTask = new tasks.LambdaInvoke(this, 'StopMCPServerContainer', {
            lambdaFunction: stopTaskFunction,
            payload: sfn.TaskInput.fromObject({
                taskArn: sfn.JsonPath.stringAt('$.taskResult.TaskArn')
            }),
            resultPath: '$.cleanupResult'
        });
        // 8.6 Success and Failure States
        const successState = new sfn.Succeed(this, 'ValidationSucceeded');
        const failState = new sfn.Fail(this, 'ValidationFailed', {
            cause: 'MCP server validation failed',
            error: 'ServerValidationError',
        });
        // 8.7 Define Workflow
        const definition = buildTask
            .next(parseImageUri)
            .next(runContainerTask)
            .next(validateTask)
            .next(cleanupTask)
            .next(new sfn.Choice(this, 'CheckValidationResult')
            .when(sfn.Condition.booleanEquals('$.validationResult.body.verified', true), successState)
            .otherwise(failState));
        // 8.8 Create State Machine
        const stateMachine = new sfn.StateMachine(this, 'ValidationPipeline', {
            stateMachineName: 'ToolShed-MCP-Server-Validation-Pipeline',
            definition,
            timeout: cdk.Duration.minutes(30),
            tracingEnabled: true,
        });
        // Store the state machine ARN for output
        this.stateMachineArn = stateMachine.stateMachineArn;
        // 9. Outputs
        new cdk.CfnOutput(this, 'StateMachineArn', {
            value: stateMachine.stateMachineArn,
            description: 'ARN of the validation pipeline state machine',
            exportName: 'ToolShed-ValidationPipeline-StateMachineArn',
        });
        new cdk.CfnOutput(this, 'EcrRepositoryUri', {
            value: repository.repositoryUri,
            description: 'URI of the ECR repository for MCP server images',
            exportName: 'ToolShed-ValidationPipeline-EcrRepositoryUri',
        });
        new cdk.CfnOutput(this, 'EcsClusterName', {
            value: cluster.clusterName,
            description: 'Name of the ECS cluster for validation tasks',
            exportName: 'ToolShed-ValidationPipeline-EcsClusterName',
        });
    }
}
exports.ValidationPipelineStack = ValidationPipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVmFsaWRhdGlvblBpcGVsaW5lU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9WYWxpZGF0aW9uUGlwZWxpbmVTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLHVEQUF1RDtBQUN2RCwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQscURBQXFEO0FBQ3JELDZEQUE2RDtBQUM3RCw2Q0FBNkM7QUFDN0MsaUVBQWlFO0FBQ2pFLDZCQUE2QjtBQVM3QixNQUFhLHVCQUF3QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBR3BELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0M7UUFDNUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIseUNBQXlDO1FBQ3pDLElBQUksR0FBYSxDQUFDO1FBQ2xCLElBQUksS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDO1lBQ2pCLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7Z0JBQ25ELEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDbEIsaUJBQWlCLEVBQUUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDLEVBQUUsd0JBQXdCO2dCQUN6RSxlQUFlLEVBQUUsS0FBSyxDQUFDLFNBQVM7YUFDakMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQzthQUFNLENBQUM7WUFDTixHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7Z0JBQ3ZDLE1BQU0sRUFBRSxDQUFDO2dCQUNULFdBQVcsRUFBRSxDQUFDO2FBQ2YsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELCtCQUErQjtRQUMvQixJQUFJLGFBQWlDLENBQUM7UUFDdEMsSUFBSSxLQUFLLEVBQUUsZUFBZSxF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QUFLLEVBQUUsVUFBVSxDQUFDLGFBQWE7WUFDL0IsV0FBVyxFQUFFLGlEQUFpRDtZQUM5RCxVQUFVLEVBQUUsOENBQThDO1NBQzNELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxXQUFXO1lBQzFCLFdBQVcsRUFBRSw4Q0FBOEM7WUFDM0QsVUFBVSxFQUFFLDRDQUE0QztTQUN6RCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsYUQsMERBa2FDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgY29kZWJ1aWxkIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgc2ZuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCAqIGFzIHRhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGlvblBpcGVsaW5lU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjSWQ/OiBzdHJpbmc7XG4gIHN1Ym5ldElkcz86IHN0cmluZ1tdO1xuICBzZWN1cml0eUdyb3VwSWQ/OiBzdHJpbmc7XG4gIGR5bmFtb0RiVGFibGVOYW1lPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgVmFsaWRhdGlvblBpcGVsaW5lU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgc3RhdGVNYWNoaW5lQXJuOiBzdHJpbmc7XG4gIFxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFZhbGlkYXRpb25QaXBlbGluZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcbiAgICBcbiAgICAvLyBHZXQgVlBDIGZyb20gcHJvcHMgb3IgY3JlYXRlIGEgbmV3IG9uZVxuICAgIGxldCB2cGM6IGVjMi5JVnBjO1xuICAgIGlmIChwcm9wcz8udnBjSWQpIHtcbiAgICAgIHZwYyA9IGVjMi5WcGMuZnJvbVZwY0F0dHJpYnV0ZXModGhpcywgJ0V4aXN0aW5nVnBjJywge1xuICAgICAgICB2cGNJZDogcHJvcHMudnBjSWQsXG4gICAgICAgIGF2YWlsYWJpbGl0eVpvbmVzOiBbJ3VzLWVhc3QtMWEnLCAndXMtZWFzdC0xYiddLCAvLyBSZXBsYWNlIHdpdGggeW91ciBBWnNcbiAgICAgICAgcHVibGljU3VibmV0SWRzOiBwcm9wcy5zdWJuZXRJZHMsXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ1ZhbGlkYXRpb25WcGMnLCB7XG4gICAgICAgIG1heEF6czogMixcbiAgICAgICAgbmF0R2F0ZXdheXM6IDEsXG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gU2VjdXJpdHkgZ3JvdXAgZm9yIEVDUyB0YXNrc1xuICAgIGxldCBzZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG4gICAgaWYgKHByb3BzPy5zZWN1cml0eUdyb3VwSWQpIHtcbiAgICAgIHNlY3VyaXR5R3JvdXAgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKFxuICAgICAgICB0aGlzLCBcbiAgICAgICAgJ0ltcG9ydGVkU2VjdXJpdHlHcm91cCcsIFxuICAgICAgICBwcm9wcy5zZWN1cml0eUdyb3VwSWRcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0Vjc1NlY3VyaXR5R3JvdXAnLCB7XG4gICAgICAgIHZwYyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgTUNQIFNlcnZlciB2YWxpZGF0aW9uIHRhc2tzJyxcbiAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBBbGxvdyBpbmJvdW5kIHRyYWZmaWMgb24gcG9ydCA4MDAwICh0eXBpY2FsIE1DUCBzZXJ2ZXIgcG9ydClcbiAgICAgIHNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICAgIGVjMi5QZWVyLmFueUlwdjQoKSxcbiAgICAgICAgZWMyLlBvcnQudGNwKDgwMDApLFxuICAgICAgICAnQWxsb3cgTUNQIHNlcnZlciB0cmFmZmljJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyAxLiBFQ1IgUmVwb3NpdG9yeSBmb3IgTUNQIFNlcnZlciBJbWFnZXNcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdNQ1BTZXJ2ZXJSZXBvJywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6ICd0b29sc2hlZC1tY3Atc2VydmVycy12MicsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgZGVzY3JpcHRpb246ICdLZWVwIG9ubHkgdGhlIGxhc3QgMTAwIGltYWdlcycsXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMTAwLFxuICAgICAgICAgIHJ1bGVQcmlvcml0eTogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgXG4gICAgLy8gMi4gR2l0SHViIFNlY3JldFxuICAgIC8vIFdlIGFzc3VtZSBhIEdpdEh1YiB0b2tlbiBpcyBzdG9yZWQgaW4gU2VjcmV0cyBNYW5hZ2VyXG4gICAgY29uc3QgZ2l0aHViVG9rZW5TZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICAgIHRoaXMsXG4gICAgICAnR2l0SHViVG9rZW4nLFxuICAgICAgJ3Rvb2xzaGVkL2dpdGh1Yi10b2tlbidcbiAgICApO1xuICAgIFxuICAgIC8vIERvY2tlciBIdWIgU2VjcmV0XG4gICAgY29uc3QgZG9ja2VySHViU2VjcmV0ID0gc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIoXG4gICAgICB0aGlzLFxuICAgICAgJ0RvY2tlckh1YkNyZWRlbnRpYWxzJyxcbiAgICAgICd0b29sc2hlZC9kb2NrZXJodWItY3JlZGVudGlhbHMnXG4gICAgKTtcbiAgICBcbiAgICAvLyAzLiBDb2RlQnVpbGQgUHJvamVjdFxuICAgIGNvbnN0IGJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdCh0aGlzLCAnTUNQU2VydmVyQnVpbGQnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogJ1Rvb2xTaGVkLU1DUC1TZXJ2ZXItQnVpbGQnLFxuICAgICAgZGVzY3JpcHRpb246ICdCdWlsZHMgRG9ja2VyIGltYWdlcyBmb3IgTUNQIHNlcnZlcnMnLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl80LFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLCAvLyBSZXF1aXJlZCBmb3IgRG9ja2VyIGJ1aWxkc1xuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgIFJFUE9TSVRPUllfVVJJOiB7XG4gICAgICAgICAgdmFsdWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgIH0sXG4gICAgICAgIEdJVEhVQl9UT0tFTjoge1xuICAgICAgICAgIHZhbHVlOiBnaXRodWJUb2tlblNlY3JldC5zZWNyZXRBcm4sXG4gICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuU0VDUkVUU19NQU5BR0VSLFxuICAgICAgICB9LFxuICAgICAgICBET0NLRVJIVUJfVVNFUk5BTUU6IHtcbiAgICAgICAgICB2YWx1ZTogYCR7ZG9ja2VySHViU2VjcmV0LnNlY3JldEFybn06dXNlcm5hbWVgLFxuICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlNFQ1JFVFNfTUFOQUdFUixcbiAgICAgICAgfSxcbiAgICAgICAgRE9DS0VSSFVCX1RPS0VOOiB7XG4gICAgICAgICAgdmFsdWU6IGAke2RvY2tlckh1YlNlY3JldC5zZWNyZXRBcm59OnRva2VuYCxcbiAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5TRUNSRVRTX01BTkFHRVIsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEVuYWJsZSBEb2NrZXIgQnVpbGRLaXQgZm9yIGFkdmFuY2VkIERvY2tlciBmZWF0dXJlcyBsaWtlIC0tbW91bnRcbiAgICAgICAgRE9DS0VSX0JVSUxES0lUOiB7XG4gICAgICAgICAgdmFsdWU6ICcxJyxcbiAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gUmVwbGFjZSBleHRlcm5hbCBidWlsZHNwZWMgd2l0aCBpbmxpbmUgZGVmaW5pdGlvblxuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICAgICAgICB2ZXJzaW9uOiAnMC4yJyxcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgcHJlX2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBMb2dnaW5nIGluIHRvIEFtYXpvbiBFQ1IuLi4nLFxuICAgICAgICAgICAgICAnYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gJEFXU19ERUZBVUxUX1JFR0lPTiB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICRSRVBPU0lUT1JZX1VSSScsXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gRG9ja2VyIEh1Yi4uLicsXG4gICAgICAgICAgICAgICdlY2hvICRET0NLRVJIVUJfVE9LRU4gfCBkb2NrZXIgbG9naW4gLXUgJERPQ0tFUkhVQl9VU0VSTkFNRSAtLXBhc3N3b3JkLXN0ZGluJyxcbiAgICAgICAgICAgICAgJ1JFUE9fVVJMPSQoZWNobyAkQ09ERUJVSUxEX0lOSVRJQVRPUiB8IGN1dCAtZC8gLWYyKScsXG4gICAgICAgICAgICAgICdSRVBPX05BTUU9JChlY2hvICRSRVBPX1VSTCB8IGN1dCAtZEAgLWYxKScsXG4gICAgICAgICAgICAgICdlY2hvIFwiT3JpZ2luYWwgcmVwb3NpdG9yeSBuYW1lOiAkT1JJR0lOQUxfUkVQT1NJVE9SWV9OQU1FXCInLFxuICAgICAgICAgICAgICAnVElNRVNUQU1QPSQoZGF0ZSArJVklbSVkJUglTSVTKScsXG4gICAgICAgICAgICAgICdlY2hvIFwiQ3JlYXRlIGEgc2FuaXRpemVkIGltYWdlIHRhZyBuYW1lIChyZXBsYWNlIHNsYXNoZXMgd2l0aCBkYXNoZXMpXCInLFxuICAgICAgICAgICAgICAnU0FOSVRJWkVEX1JFUE9fTkFNRT0kKGVjaG8gJFJFUE9TSVRPUllfTkFNRSB8IHRyIFwiL1wiIFwiLVwiKScsXG4gICAgICAgICAgICAgICdlY2hvIFwiVXNlIHRpbWVzdGFtcCBhcyBmYWxsYmFjayBpZiBDT0RFQlVJTERfUkVTT0xWRURfU09VUkNFX1ZFUlNJT04gaXMgZW1wdHlcIicsXG4gICAgICAgICAgICAgICdTT1VSQ0VfVkVSU0lPTj0ke0NPREVCVUlMRF9SRVNPTFZFRF9TT1VSQ0VfVkVSU0lPTjotJFRJTUVTVEFNUH0nLFxuICAgICAgICAgICAgICAnZWNobyBcIkltcG9ydGFudDogRG8gbm90IGluY2x1ZGUgYSBjb2xvbiBpbiBJTUFHRV9UQUcgYXMgaXQgd2lsbCBiZSB1c2VkIGluICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHXCInLFxuICAgICAgICAgICAgICAnSU1BR0VfVEFHPVwiJHtTQU5JVElaRURfUkVQT19OQU1FfS0ke1NPVVJDRV9WRVJTSU9OfVwiJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCJVc2luZyBpbWFnZSB0YWc6ICRJTUFHRV9UQUdcIidcbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBDbG9uaW5nIHJlcG9zaXRvcnkuLi4nLFxuICAgICAgICAgICAgICAnZWNobyBcIlVzaW5nIHJlcG9zaXRvcnkgbmFtZTogJFJFUE9TSVRPUllfTkFNRVwiJyxcbiAgICAgICAgICAgICAgJ2VjaG8gXCJVc2luZyBvcmlnaW5hbCByZXBvc2l0b3J5IG5hbWU6ICRPUklHSU5BTF9SRVBPU0lUT1JZX05BTUVcIicsXG4gICAgICAgICAgICAgICdlY2hvIFwiVXNpbmcgc2VydmVyIElEOiAkU0VSVkVSX0lEXCInLFxuICAgICAgICAgICAgICAnZWNobyBcIkFsd2F5cyB1c2UgdGhlIE9SSUdJTkFMX1JFUE9TSVRPUllfTkFNRSBmb3IgZ2l0IGNsb25lIGFzIGl0IGhhcyB0aGUgY29ycmVjdCBmb3JtYXQgd2l0aCBzbGFzaGVzXCInLFxuICAgICAgICAgICAgICAnZWNobyBcIkNsb25pbmcgZnJvbTogJE9SSUdJTkFMX1JFUE9TSVRPUllfTkFNRVwiJyxcbiAgICAgICAgICAgICAgJ2dpdCBjbG9uZSBcImh0dHBzOi8vJEdJVEhVQl9UT0tFTkBnaXRodWIuY29tLyRPUklHSU5BTF9SRVBPU0lUT1JZX05BTUUuZ2l0XCIgcmVwbycsXG4gICAgICAgICAgICAgICdjZCByZXBvJyxcbiAgICAgICAgICAgICAgJ2VjaG8gQnVpbGRpbmcgdGhlIERvY2tlciBpbWFnZS4uLicsXG4gICAgICAgICAgICAgICdlY2hvIFwiRG9ja2VyIGltYWdlIHRhZzogJFJFUE9TSVRPUllfVVJJOiRJTUFHRV9UQUdcIicsXG4gICAgICAgICAgICAgIC8vIFZlcmlmeSBCdWlsZEtpdCBpcyBlbmFibGVkXG4gICAgICAgICAgICAgICdlY2hvIFwiRW5hYmxpbmcgRG9ja2VyIEJ1aWxkS2l0IGV4cGxpY2l0bHkuLi5cIicsXG4gICAgICAgICAgICAgICdleHBvcnQgRE9DS0VSX0JVSUxES0lUPTEnLFxuICAgICAgICAgICAgICAnZXhwb3J0IERPQ0tFUl9CVUlMRFhfRVhQRVJJTUVOVEFMPTEnLFxuICAgICAgICAgICAgICAvLyBVc2UgZG9ja2VyIGJ1aWxkeCBidWlsZCBpbnN0ZWFkIG9mIHBsYWluIGRvY2tlciBidWlsZCB0byBlbnN1cmUgQnVpbGRLaXQgdXNhZ2VcbiAgICAgICAgICAgICAgJ2RvY2tlciBidWlsZHggaW5zdGFsbCB8fCBlY2hvIFwiQnVpbGR4IGFscmVhZHkgaW5zdGFsbGVkXCInLFxuICAgICAgICAgICAgICAnZG9ja2VyIGJ1aWxkeCBjcmVhdGUgLS11c2UgLS1uYW1lIGNvZGVidWlsZF9idWlsZGVyIHx8IGVjaG8gXCJCdWlsZGVyIGV4aXN0cyBvciBjb3VsZG5cXCd0IGJlIGNyZWF0ZWRcIicsXG4gICAgICAgICAgICAgIC8vIEFkZCBhIGZhbGxiYWNrIHN0cmF0ZWd5IHRvIG1vZGlmeSB0aGUgRG9ja2VyZmlsZSBpZiBpdCBjb250YWlucyBCdWlsZEtpdC1zcGVjaWZpYyBkaXJlY3RpdmVzXG4gICAgICAgICAgICAgICdlY2hvIFwiQ2hlY2tpbmcgRG9ja2VyZmlsZSBmb3IgQnVpbGRLaXQtc3BlY2lmaWMgZGlyZWN0aXZlcy4uLlwiJyxcbiAgICAgICAgICAgICAgJ2lmIGdyZXAgLXEgXCJcXFxcLVxcXFwtbW91bnQ9dHlwZT1jYWNoZVwiIERvY2tlcmZpbGU7IHRoZW4gZWNobyBcIkJ1aWxkS2l0IGNhY2hlIG1vdW50IGZvdW5kLCBjcmVhdGluZyBjb21wYXRpYmxlIHZlcnNpb25cIjsgY3AgRG9ja2VyZmlsZSBEb2NrZXJmaWxlLm9yaWdpbmFsOyBzZWQgXCJzL1JVTiAtLW1vdW50PXR5cGU9Y2FjaGUvUlVOL1wiIERvY2tlcmZpbGUgPiBEb2NrZXJmaWxlLm5vYnVpbGRraXQ7IGZpJyxcbiAgICAgICAgICAgICAgLy8gVHJ5IHdpdGggYnVpbGR4IGZpcnN0LCB0aGVuIGZhbGxiYWNrIHRvIHJlZ3VsYXIgYnVpbGQgaWYgdGhhdCBmYWlscywgd2l0aCBmdXJ0aGVyIGZhbGxiYWNrIHRvIG5vLWNhY2hlIGJ1aWxkIGFuZCBmaW5hbGx5IGEgYnVpbGQgd2l0aCBtb2RpZmllZCBEb2NrZXJmaWxlXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGR4IGJ1aWxkIC0tcHJvZ3Jlc3M9cGxhaW4gLXQgJFJFUE9TSVRPUllfVVJJOiRJTUFHRV9UQUcgLiB8fCAoZWNobyBcIkRvY2tlciBidWlsZHggYnVpbGQgZmFpbGVkLCB0cnlpbmcgbGVnYWN5IGJ1aWxkIHdpdGhvdXQgY2FjaGUuLi5cIjsgZG9ja2VyIGJ1aWxkIC0tbm8tY2FjaGUgLXQgJFJFUE9TSVRPUllfVVJJOiRJTUFHRV9UQUcgLiB8fCAoZWNobyBcIkRvY2tlciBidWlsZCBmYWlsZWQsIGNoZWNraW5nIGlmIHdlIG5lZWQgdG8gdXNlIG1vZGlmaWVkIERvY2tlcmZpbGUuLi5cIjsgaWYgWyAtZiBEb2NrZXJmaWxlLm5vYnVpbGRraXQgXTsgdGhlbiBlY2hvIFwiVHJ5aW5nIGJ1aWxkIHdpdGggQnVpbGRLaXQtY29tcGF0aWJsZSBEb2NrZXJmaWxlXCI7IGRvY2tlciBidWlsZCAtZiBEb2NrZXJmaWxlLm5vYnVpbGRraXQgLXQgJFJFUE9TSVRPUllfVVJJOiRJTUFHRV9UQUcgLiB8fCAoZWNobyBcIkFsbCBidWlsZCBhdHRlbXB0cyBmYWlsZWQsIHNob3dpbmcgRG9ja2VyZmlsZVwiOyBjYXQgRG9ja2VyZmlsZTsgZXhpdCAxKTsgZWxzZSBlY2hvIFwiTm8gQnVpbGRLaXQgZGlyZWN0aXZlcyBmb3VuZCB0byBtb2RpZnkuIEJ1aWxkIGZhaWxlZC5cIjsgY2F0IERvY2tlcmZpbGU7IGV4aXQgMTsgZmkpKScsXG4gICAgICAgICAgICAgICdkb2NrZXIgdGFnICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHICRSRVBPU0lUT1JZX1VSSTpsYXRlc3QnXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAvLyBBZGQgZXJyb3IgaGFuZGxpbmcgZm9yIHRoZSBEb2NrZXIgcHVzaCBjb21tYW5kc1xuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJFJFUE9TSVRPUllfVVJJOiRJTUFHRV9UQUcgfHwgKGVjaG8gXCJEb2NrZXIgcHVzaCBmYWlsZWQsIHZlcmlmeWluZyBpbWFnZSBleGlzdHMuLi5cIjsgZG9ja2VyIGltYWdlczsgZXhpdCAxKScsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0IHx8IGVjaG8gXCJXYXJuaW5nOiBGYWlsZWQgdG8gcHVzaCBsYXRlc3QgdGFnLCBidXQgYnVpbGQgSUQgdGFnIHdhcyBwdXNoZWQgc3VjY2Vzc2Z1bGx5XCInLFxuICAgICAgICAgICAgICAnZWNobyBXcml0aW5nIGltYWdlIGRlZmluaXRpb24gZmlsZS4uLicsXG4gICAgICAgICAgICAgICdlY2hvIFwie1xcXCJpbWFnZVVyaVxcXCI6XFxcIiRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHXFxcIixcXFwic2VydmVySWRcXFwiOlxcXCIkU0VSVkVSX0lEXFxcIn1cIiA+IGltYWdlRGVmaW5pdGlvbi5qc29uJ1xuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgYXJ0aWZhY3RzOiB7XG4gICAgICAgICAgZmlsZXM6IFsnaW1hZ2VEZWZpbml0aW9uLmpzb24nXVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB0aGUgQ29kZUJ1aWxkIHByb2plY3RcbiAgICByZXBvc2l0b3J5LmdyYW50UHVsbFB1c2goYnVpbGRQcm9qZWN0KTtcbiAgICBcbiAgICAvLyA0LiBFQ1MgQ2x1c3RlclxuICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgJ1ZhbGlkYXRpb25DbHVzdGVyJywge1xuICAgICAgdnBjLFxuICAgICAgY2x1c3Rlck5hbWU6ICdUb29sU2hlZC1WYWxpZGF0aW9uLUNsdXN0ZXInLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIDUuIEVDUyBUYXNrIFJvbGUgYW5kIEV4ZWN1dGlvbiBSb2xlXG4gICAgY29uc3QgdGFza1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ01DUFNlcnZlclRhc2tSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogJ1Rvb2xTaGVkLVZhbGlkYXRpb24tTUNQLVNlcnZlci1UYXNrLVJvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGZvciBNQ1Agc2VydmVyIHRhc2tzJyxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdNQ1BTZXJ2ZXJFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogJ1Rvb2xTaGVkLVZhbGlkYXRpb24tTUNQLVNlcnZlci1FeGVjdXRpb24tUm9sZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0V4ZWN1dGlvbiByb2xlIGZvciBNQ1Agc2VydmVyIHRhc2tzJyxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeScpLFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBHaXZlIHRoZSBleGVjdXRpb24gcm9sZSBwZXJtaXNzaW9ucyB0byBwdWxsIGZyb20gRUNSXG4gICAgcmVwb3NpdG9yeS5ncmFudFB1bGwoZXhlY3V0aW9uUm9sZSk7XG4gICAgXG4gICAgLy8gNi4gRUNTIFRhc2sgRGVmaW5pdGlvblxuICAgIGNvbnN0IHRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ01DUFNlcnZlclRhc2tEZWYnLCB7XG4gICAgICBjcHU6IDI1NixcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICB0YXNrUm9sZSxcbiAgICAgIGV4ZWN1dGlvblJvbGUsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ29udGFpbmVyIHdpdGggYmFzZSBpbWFnZSBmcm9tIG91ciBFQ1IgcmVwb3NpdG9yeVxuICAgIHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignTUNQU2VydmVyQ29udGFpbmVyJywge1xuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShyZXBvc2l0b3J5LCAnbGF0ZXN0JyksXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnbWNwLXNlcnZlcicsXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgfSksXG4gICAgICBwb3J0TWFwcGluZ3M6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNvbnRhaW5lclBvcnQ6IDgwMDAsXG4gICAgICAgICAgaG9zdFBvcnQ6IDgwMDAsXG4gICAgICAgICAgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZXNzZW50aWFsOiB0cnVlLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIDcuIExhbWJkYSBGdW5jdGlvbiBmb3IgVmFsaWRhdGlvblxuICAgIGNvbnN0IHZhbGlkYXRpb25GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZhbGlkYXRpb25GdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1Rvb2xTaGVkLU1DUC1TZXJ2ZXItVmFsaWRhdGlvbicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnY2RrL2xhbWJkYScpKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHByb3BzPy5keW5hbW9EYlRhYmxlTmFtZSB8fCAnVG9vbFNoZWRTZXJ2ZXJzJyxcbiAgICAgIH0sXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICB9LFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZWN1cml0eUdyb3VwXSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBHcmFudCB0aGUgTGFtYmRhIGZ1bmN0aW9uIHBlcm1pc3Npb25zIHRvIHVwZGF0ZSBEeW5hbW9EQlxuICAgIHZhbGlkYXRpb25GdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXG4gICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlLyR7cHJvcHM/LmR5bmFtb0RiVGFibGVOYW1lIHx8ICdUb29sU2hlZFNlcnZlcnMnfWAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgICk7XG4gICAgXG4gICAgLy8gOC4gU3RlcCBGdW5jdGlvbnMgU3RhdGUgTWFjaGluZVxuICAgIFxuICAgIC8vIDguMSBDb2RlQnVpbGQgVGFza1xuICAgIGNvbnN0IGJ1aWxkVGFzayA9IG5ldyB0YXNrcy5Db2RlQnVpbGRTdGFydEJ1aWxkKHRoaXMsICdCdWlsZE1DUFNlcnZlckltYWdlJywge1xuICAgICAgcHJvamVjdDogYnVpbGRQcm9qZWN0LFxuICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0IsXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlc092ZXJyaWRlOiB7XG4gICAgICAgIFJFUE9TSVRPUllfTkFNRToge1xuICAgICAgICAgIHZhbHVlOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQucmVwb3NpdG9yeU5hbWUnKSxcbiAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgIH0sXG4gICAgICAgIE9SSUdJTkFMX1JFUE9TSVRPUllfTkFNRToge1xuICAgICAgICAgIHZhbHVlOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQub3JpZ2luYWxSZXBvc2l0b3J5TmFtZScpLFxuICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgfSxcbiAgICAgICAgU0VSVkVSX0lEOiB7XG4gICAgICAgICAgdmFsdWU6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5zZXJ2ZXJJZCcpLFxuICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlc3VsdFBhdGg6ICckLmJ1aWxkUmVzdWx0JyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyA4LjIgUGFyc2UgQnVpbGQgT3V0cHV0XG4gICAgY29uc3QgcGFyc2VJbWFnZVVyaSA9IG5ldyBzZm4uUGFzcyh0aGlzLCAnUGFyc2VJbWFnZVVyaScsIHtcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgaW1hZ2VVcmk6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5idWlsZFJlc3VsdC5CdWlsZC5BcnRpZmFjdHMuTG9jYXRpb24nKSwgLy8gV2lsbCBuZWVkIHBvc3QtcHJvY2Vzc2luZ1xuICAgICAgICBzZXJ2ZXJJZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLnNlcnZlcklkJyksXG4gICAgICB9LFxuICAgICAgcmVzdWx0UGF0aDogJyQuaW1hZ2VEZXRhaWxzJyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyA4LjMgRUNTIFRhc2tcbiAgICBjb25zdCBydW5Db250YWluZXJUYXNrID0gbmV3IHRhc2tzLkVjc1J1blRhc2sodGhpcywgJ1J1bk1DUFNlcnZlckNvbnRhaW5lcicsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbixcbiAgICAgIGxhdW5jaFRhcmdldDogbmV3IHRhc2tzLkVjc0ZhcmdhdGVMYXVuY2hUYXJnZXQoe1xuICAgICAgICBwbGF0Zm9ybVZlcnNpb246IGVjcy5GYXJnYXRlUGxhdGZvcm1WZXJzaW9uLkxBVEVTVCxcbiAgICAgIH0pLFxuICAgICAgYXNzaWduUHVibGljSXA6IHRydWUsXG4gICAgICBzZWN1cml0eUdyb3VwczogW3NlY3VyaXR5R3JvdXBdLFxuICAgICAgb3ZlcnJpZGVUYXNrRGVmaW5pdGlvblByb3BzOiB7XG4gICAgICAgIGNvbnRhaW5lckRlZmluaXRpb25zOiBbe1xuICAgICAgICAgIG5hbWU6ICdNQ1BTZXJ2ZXJDb250YWluZXInLFxuICAgICAgICAgIGltYWdlOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuaW1hZ2VEZXRhaWxzLmltYWdlVXJpJylcbiAgICAgICAgfV1cbiAgICAgIH0sXG4gICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHNmbi5JbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQixcbiAgICAgIHJlc3VsdFBhdGg6ICckLnRhc2tSZXN1bHQnLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIDguNCBMYW1iZGEgVmFsaWRhdGlvbiBUYXNrXG4gICAgY29uc3QgdmFsaWRhdGVUYXNrID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnVmFsaWRhdGVNQ1BTZXJ2ZXInLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogdmFsaWRhdGlvbkZ1bmN0aW9uLFxuICAgICAgcGF5bG9hZFJlc3BvbnNlT25seTogdHJ1ZSxcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHNlcnZlcklkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuc2VydmVySWQnKSxcbiAgICAgICAgZW5kcG9pbnQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC50YXNrUmVzdWx0LkF0dGFjaG1lbnRzWzBdLkRldGFpbHNbPyhALk5hbWUgPT0gXCJuZXR3b3JrQ29uZmlndXJhdGlvblwiKV0uVmFsdWUuTmV0d29ya0ludGVyZmFjZXNbMF0uUHVibGljSXAnKSxcbiAgICAgICAgdGFza0Fybjogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLnRhc2tSZXN1bHQuVGFza0FybicpLFxuICAgICAgfSksXG4gICAgICByZXN1bHRQYXRoOiAnJC52YWxpZGF0aW9uUmVzdWx0JyxcbiAgICB9KTtcbiAgICBcbiAgICAvLyA4LjUgVXNlIGEgTGFtYmRhIGZ1bmN0aW9uIHRvIHN0b3AgdGhlIHRhc2sgaW5zdGVhZFxuICAgIGNvbnN0IHN0b3BUYXNrRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdG9wVGFza0Z1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnVG9vbFNoZWQtU3RvcC1FQ1MtVGFzaycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuICAgICAgICBjb25zdCB7IEVDU0NsaWVudCwgU3RvcFRhc2tDb21tYW5kIH0gPSByZXF1aXJlKFwiQGF3cy1zZGsvY2xpZW50LWVjc1wiKTtcbiAgICAgICAgXG4gICAgICAgIGV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVjc0NsaWVudCA9IG5ldyBFQ1NDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG4gICAgICAgICAgXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHN0b3BUYXNrQ29tbWFuZCA9IG5ldyBTdG9wVGFza0NvbW1hbmQoe1xuICAgICAgICAgICAgICBjbHVzdGVyOiBwcm9jZXNzLmVudi5DTFVTVEVSX0FSTixcbiAgICAgICAgICAgICAgdGFzazogZXZlbnQudGFza0FybixcbiAgICAgICAgICAgICAgcmVhc29uOiAnU3RvcHBlZCBieSBTdGVwIEZ1bmN0aW9ucydcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhd2FpdCBlY3NDbGllbnQuc2VuZChzdG9wVGFza0NvbW1hbmQpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4geyBcbiAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSwgXG4gICAgICAgICAgICAgIHRhc2tBcm46IGV2ZW50LnRhc2tBcm4gXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzdG9wcGluZyB0YXNrOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgYCksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBDTFVTVEVSX0FSTjogY2x1c3Rlci5jbHVzdGVyQXJuXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApXG4gICAgfSk7XG4gICAgXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbiB0byBzdG9wIHRhc2tzXG4gICAgc3RvcFRhc2tGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnZWNzOlN0b3BUYXNrJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ11cbiAgICAgIH0pXG4gICAgKTtcbiAgICBcbiAgICAvLyBSZXBsYWNlIEVjc1J1blRhc2sgd2l0aCBMYW1iZGFJbnZva2UgZm9yIGNsZWFudXBcbiAgICBjb25zdCBjbGVhbnVwVGFzayA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3BNQ1BTZXJ2ZXJDb250YWluZXInLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogc3RvcFRhc2tGdW5jdGlvbixcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIHRhc2tBcm46IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC50YXNrUmVzdWx0LlRhc2tBcm4nKVxuICAgICAgfSksXG4gICAgICByZXN1bHRQYXRoOiAnJC5jbGVhbnVwUmVzdWx0J1xuICAgIH0pO1xuICAgIFxuICAgIC8vIDguNiBTdWNjZXNzIGFuZCBGYWlsdXJlIFN0YXRlc1xuICAgIGNvbnN0IHN1Y2Nlc3NTdGF0ZSA9IG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnVmFsaWRhdGlvblN1Y2NlZWRlZCcpO1xuICAgIGNvbnN0IGZhaWxTdGF0ZSA9IG5ldyBzZm4uRmFpbCh0aGlzLCAnVmFsaWRhdGlvbkZhaWxlZCcsIHtcbiAgICAgIGNhdXNlOiAnTUNQIHNlcnZlciB2YWxpZGF0aW9uIGZhaWxlZCcsXG4gICAgICBlcnJvcjogJ1NlcnZlclZhbGlkYXRpb25FcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gOC43IERlZmluZSBXb3JrZmxvd1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSBidWlsZFRhc2tcbiAgICAgIC5uZXh0KHBhcnNlSW1hZ2VVcmkpXG4gICAgICAubmV4dChydW5Db250YWluZXJUYXNrKVxuICAgICAgLm5leHQodmFsaWRhdGVUYXNrKVxuICAgICAgLm5leHQoY2xlYW51cFRhc2spXG4gICAgICAubmV4dChuZXcgc2ZuLkNob2ljZSh0aGlzLCAnQ2hlY2tWYWxpZGF0aW9uUmVzdWx0JylcbiAgICAgICAgLndoZW4oc2ZuLkNvbmRpdGlvbi5ib29sZWFuRXF1YWxzKCckLnZhbGlkYXRpb25SZXN1bHQuYm9keS52ZXJpZmllZCcsIHRydWUpLCBzdWNjZXNzU3RhdGUpXG4gICAgICAgIC5vdGhlcndpc2UoZmFpbFN0YXRlKVxuICAgICAgKTtcbiAgICBcbiAgICAvLyA4LjggQ3JlYXRlIFN0YXRlIE1hY2hpbmVcbiAgICBjb25zdCBzdGF0ZU1hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZSh0aGlzLCAnVmFsaWRhdGlvblBpcGVsaW5lJywge1xuICAgICAgc3RhdGVNYWNoaW5lTmFtZTogJ1Rvb2xTaGVkLU1DUC1TZXJ2ZXItVmFsaWRhdGlvbi1QaXBlbGluZScsXG4gICAgICBkZWZpbml0aW9uLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMzApLFxuICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gU3RvcmUgdGhlIHN0YXRlIG1hY2hpbmUgQVJOIGZvciBvdXRwdXRcbiAgICB0aGlzLnN0YXRlTWFjaGluZUFybiA9IHN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm47XG4gICAgXG4gICAgLy8gOS4gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTdGF0ZU1hY2hpbmVBcm4nLCB7XG4gICAgICB2YWx1ZTogc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSB2YWxpZGF0aW9uIHBpcGVsaW5lIHN0YXRlIG1hY2hpbmUnLFxuICAgICAgZXhwb3J0TmFtZTogJ1Rvb2xTaGVkLVZhbGlkYXRpb25QaXBlbGluZS1TdGF0ZU1hY2hpbmVBcm4nLFxuICAgIH0pO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFY3JSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJJIG9mIHRoZSBFQ1IgcmVwb3NpdG9yeSBmb3IgTUNQIHNlcnZlciBpbWFnZXMnLFxuICAgICAgZXhwb3J0TmFtZTogJ1Rvb2xTaGVkLVZhbGlkYXRpb25QaXBlbGluZS1FY3JSZXBvc2l0b3J5VXJpJyxcbiAgICB9KTtcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRWNzQ2x1c3Rlck5hbWUnLCB7XG4gICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgRUNTIGNsdXN0ZXIgZm9yIHZhbGlkYXRpb24gdGFza3MnLFxuICAgICAgZXhwb3J0TmFtZTogJ1Rvb2xTaGVkLVZhbGlkYXRpb25QaXBlbGluZS1FY3NDbHVzdGVyTmFtZScsXG4gICAgfSk7XG4gIH1cbn0iXX0=