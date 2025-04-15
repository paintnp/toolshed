import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';

export interface ValidationPipelineStackProps extends cdk.StackProps {
  vpcId?: string;
  subnetIds?: string[];
  securityGroupId?: string;
  dynamoDbTableName?: string;
}

export class ValidationPipelineStack extends cdk.Stack {
  public readonly stateMachineArn: string;
  
  constructor(scope: Construct, id: string, props?: ValidationPipelineStackProps) {
    super(scope, id, props);
    
    // Get VPC from props or create a new one
    let vpc: ec2.IVpc;
    if (props?.vpcId) {
      vpc = ec2.Vpc.fromVpcAttributes(this, 'ExistingVpc', {
        vpcId: props.vpcId,
        availabilityZones: ['us-east-1a', 'us-east-1b'], // Replace with your AZs
        publicSubnetIds: props.subnetIds,
      });
    } else {
      vpc = new ec2.Vpc(this, 'ValidationVpc', {
        maxAzs: 2,
        natGateways: 1,
      });
    }
    
    // Security group for ECS tasks
    let securityGroup: ec2.ISecurityGroup;
    if (props?.securityGroupId) {
      securityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this, 
        'ImportedSecurityGroup', 
        props.securityGroupId
      );
    } else {
      securityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
        vpc,
        description: 'Security group for MCP Server validation tasks',
        allowAllOutbound: true,
      });
      
      // Allow inbound traffic on port 8000 (typical MCP server port)
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(8000),
        'Allow MCP server traffic'
      );
    }

    // 1. ECR Repository for MCP Server Images
    // Use repository lookup to avoid creation errors if it already exists
    const repositoryName = 'toolshed-mcp-servers-v2';
    
    // Always use fromRepositoryName to reference an existing repository
    // This means the repository must be created manually before deploying if it doesn't exist
    const repository = ecr.Repository.fromRepositoryName(
      this, 
      'MCPServerRepo', 
      repositoryName
    );
    
    // Add a CfnOutput to indicate we're using an existing repository
    new cdk.CfnOutput(this, 'ECRRepository', {
      value: repositoryName,
      description: 'ECR repository used for MCP server images'
    });
    
    // 2. GitHub Secret
    // We assume a GitHub token is stored in Secrets Manager
    const githubTokenSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GitHubToken',
      'toolshed/github-token'
    );
    
    // Docker Hub Secret
    const dockerHubSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'DockerHubCredentials',
      'toolshed/dockerhub-credentials'
    );
    
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
              'echo "Using execution ID: $EXECUTION_ID"',
              'echo "Create a sanitized image tag name (replace slashes with dashes)"',
              'SANITIZED_REPO_NAME=$(echo $REPOSITORY_NAME | tr "/" "-")',
              'IMAGE_TAG="${SANITIZED_REPO_NAME}-${EXECUTION_ID}"',
              'echo "Using stable image tag: $IMAGE_TAG"',
              'export IMAGE_TAG',
              'echo "Source commit SHA: $CODEBUILD_RESOLVED_SOURCE_VERSION"'
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
              'echo "{\"imageUri\":\"$REPOSITORY_URI:$IMAGE_TAG\",\"serverId\":\"$SERVER_ID\"}" > imageDefinition.json',
              'echo "{\"imageUri\":\"$REPOSITORY_URI:$IMAGE_TAG\",\"repositoryUri\":\"$REPOSITORY_URI\",\"imageTag\":\"$IMAGE_TAG\",\"lastVerifiedSha\":\"$CODEBUILD_RESOLVED_SOURCE_VERSION\",\"serverId\":\"$SERVER_ID\"}" > image-details.json'
            ]
          }
        },
        artifacts: {
          files: [
            'imageDefinition.json',
            'image-details.json'
          ]
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
    
    // Add CloudWatch Logs permissions for creating log groups
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );
    
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
    validationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:UpdateItem',
          'dynamodb:PutItem',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props?.dynamoDbTableName || 'ToolShedServers'}`,
        ],
      })
    );
    
    // Store configuration in SSM Parameter Store for the playground functionality
    // These parameters will be accessed by the playground API
    new ssm.StringParameter(this, 'PlaygroundClusterParam', {
      parameterName: '/toolshed/playground/cluster',
      stringValue: cluster.clusterName,
      description: 'ECS Cluster for ToolShed Playground',
    });
    
    new ssm.StringParameter(this, 'PlaygroundExecutionRoleParam', {
      parameterName: '/toolshed/playground/executionRoleArn',
      stringValue: executionRole.roleArn,
      description: 'Execution Role ARN for ToolShed Playground',
    });
    
    new ssm.StringParameter(this, 'PlaygroundSecurityGroupParam', {
      parameterName: '/toolshed/playground/securityGroup',
      stringValue: securityGroup.securityGroupId,
      description: 'Security Group ID for ToolShed Playground',
    });
    
    // Store all available public subnets
    const publicSubnets = vpc.publicSubnets.map(subnet => subnet.subnetId);
    new ssm.StringParameter(this, 'PlaygroundSubnetsParam', {
      parameterName: '/toolshed/playground/subnets',
      stringValue: publicSubnets.join(','),
      description: 'Public Subnet IDs for ToolShed Playground',
    });
    
    // 8. Step Functions State Machine
    
    // 8.0 Initialization step to extract execution ID for tagging
    const initializeStep = new sfn.Pass(this, 'InitializeValidation', {
      parameters: {
        'serverId.$': '$.serverId',
        'repositoryName.$': '$.repositoryName',
        'originalRepositoryName.$': '$.originalRepositoryName',
        // Use a simplified approach with the execution name as the tag
        'executionName': sfn.JsonPath.stringAt('$$.Execution.Name'),
        // Create a simple execution ID by using just the execution name
        'executionId': sfn.JsonPath.stringAt('$$.Execution.Name')
      }
    });
    
    // 8.1 CodeBuild Task (updated to use execution ID)
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
        },
        // Pass the execution ID to use as a stable tag
        EXECUTION_ID: {
          value: sfn.JsonPath.stringAt('$.executionId'),
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        }
      },
      resultPath: '$.buildResult',
    });
    
    // 8.2 Parse Build Output
    // Add a Lambda function to extract the image URI from the CodeBuild output
    const extractImageUriFunction = new lambda.Function(this, 'ExtractImageUriFunction', {
      functionName: 'ToolShed-Extract-Image-Uri',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        
        exports.handler = async (event) => {
          console.log('Input event:', JSON.stringify(event, null, 2));
          
          let imageUri;
          let imageTag;
          let lastVerifiedSha;
          let serverId = event.serverId;
          
          try {
            // Get information from the build output
            if (event.buildResult?.Build) {
              const build = event.buildResult.Build;
              
              // Get information from the build artifacts, which contain the actual image URI used
              const artifactLocation = build.Artifacts?.Location;
              if (!artifactLocation) {
                console.log('No artifact location found in build result');
                
                // Fall back to previous method if we can't find the artifacts
                return await fallbackToGeneratingImageUri(event);
              }
              
              // Parse S3 location
              // Format: bucket/path/to/artifact.zip
              const s3Path = artifactLocation.replace('s3://', '').split('/');
              const bucketName = s3Path[0];
              const objectKey = s3Path.slice(1).join('/');
              
              console.log('Artifact location:', artifactLocation);
              console.log('Bucket name:', bucketName);
              console.log('Object key:', objectKey);
              
              // Set up S3 client
              const s3Client = new S3Client();
              
              // Define the paths to the artifact files
              const imageDefinitionKey = objectKey.endsWith('/') 
                ? \`\${objectKey}imageDefinition.json\` 
                : \`\${objectKey}/imageDefinition.json\`;
                
              // Get the image definition file from S3
              try {
                const imageDefinitionResponse = await s3Client.send(
                  new GetObjectCommand({
                    Bucket: bucketName,
                    Key: imageDefinitionKey
                  })
                );
                
                // Read and parse the image definition
                const imageDefinitionData = await streamToString(imageDefinitionResponse.Body);
                const imageDefinition = JSON.parse(imageDefinitionData);
                
                console.log('Image definition:', imageDefinition);
                
                // Extract image information from the definition
                imageUri = imageDefinition.imageUri;
                imageTag = imageUri.split(':')[1]; // Extract tag from URI
                serverId = imageDefinition.serverId || serverId;
                
                // Get SHA from build if available
                lastVerifiedSha = build.SourceVersion || null;
                
                console.log('Extracted from artifacts - Image URI:', imageUri);
                console.log('Extracted from artifacts - Image tag:', imageTag);
                console.log('Server ID:', serverId);
              } catch (s3Error) {
                console.error('Error getting image definition from S3:', s3Error);
                // Fall back to the old method if we can't get the file
                return await fallbackToGeneratingImageUri(event);
              }
            } else {
              console.log('No build information in event, falling back to old method');
              return await fallbackToGeneratingImageUri(event);
            }
            
            // If we still don't have an image URI, throw an error
            if (!imageUri) {
              throw new Error('Could not determine image URI from build output. Check CodeBuild logs for more details.');
            }
            
            return {
              imageUri,
              imageTag,
              lastVerifiedSha,
              serverId
            };
          } catch (error) {
            console.error('Error extracting image URI:', error);
            throw error;
          }
        };
        
        // Helper function to convert stream to string
        async function streamToString(stream) {
          const chunks = [];
          return new Promise((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          });
        }
        
        // Fallback to the old method of generating image URI from build information
        async function fallbackToGeneratingImageUri(event) {
          console.log('Using fallback method to generate image URI');
          
          let imageUri;
          let imageTag;
          let lastVerifiedSha;
          let serverId = event.serverId;
          
          if (event.buildResult?.Build) {
            const build = event.buildResult.Build;
            
            // Get repository URI from environment variables
            const repoUri = build.Environment.EnvironmentVariables
              .find(v => v.Name === 'REPOSITORY_URI')?.Value;
            
            // Get repository name and server ID 
            const repoName = build.Environment.EnvironmentVariables
              .find(v => v.Name === 'REPOSITORY_NAME')?.Value;
            
            // Get execution ID from environment variables (added in buildTask)
            const executionId = build.Environment.EnvironmentVariables
              .find(v => v.Name === 'EXECUTION_ID')?.Value;
            
            // Get commit SHA from source version (if available)
            lastVerifiedSha = build.SourceVersion || null;
            
            // Prioritize using the execution ID over timestamp
            if (repoName && repoUri) {
              const sanitizedRepoName = repoName.replace(/\\//g, '-');
              
              if (executionId) {
                // Use the execution ID as the stable identifier
                imageTag = \`\${sanitizedRepoName}-\${executionId}\`;
                console.log('Using execution ID for image tag:', imageTag);
              } else {
                // Fallback to timestamp only if execution ID is not available
                const timestamp = build.StartTime ? 
                  new Date(build.StartTime).toISOString()
                    .replace(/[-:]/g, '')
                    .replace('T', '')
                    .replace(/\\..+/, '') : 
                  new Date().toISOString()
                    .replace(/[-:]/g, '')
                    .replace('T', '')
                    .replace(/\\..+/, '');
                
                imageTag = \`\${sanitizedRepoName}-\${timestamp}\`;
                console.log('Fallback to timestamp for image tag:', imageTag);
              }
              
              imageUri = \`\${repoUri}:\${imageTag}\`;
              console.log('Constructed image URI:', imageUri);
              console.log('Image tag:', imageTag);
              console.log('Last verified SHA:', lastVerifiedSha);
            }
          }
          
          if (!imageUri) {
            throw new Error('Could not determine image URI from build output, even with fallback method.');
          }
          
          return {
            imageUri,
            imageTag,
            lastVerifiedSha,
            serverId
          };
        }
      `),
      timeout: cdk.Duration.seconds(30)
    });
    
    // Grant the Lambda function permissions
    extractImageUriFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: ['*']
      })
    );
    
    const parseImageUri = new tasks.LambdaInvoke(this, 'ParseImageUri', {
      lambdaFunction: extractImageUriFunction,
      payload: sfn.TaskInput.fromObject({
        buildResult: sfn.JsonPath.objectAt('$.buildResult'),
        serverId: sfn.JsonPath.stringAt('$.serverId')
      }),
      resultPath: '$.imageDetails',
      payloadResponseOnly: true
    });
    
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
    
    // 8.4 ECS Task - Use AWS Service integration instead of EcsRunTask
    const runContainerTask = new tasks.CallAwsService(this, 'RunMCPServerContainer', {
      service: 'ecs',
      action: 'runTask',
      parameters: {
        Cluster: cluster.clusterArn,
        TaskDefinition: sfn.JsonPath.stringAt('$.registeredTask.TaskDefinition.TaskDefinitionArn'),
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
    
    // 8.4.1 Add a wait state for the task to start up and get a public IP
    const waitForTask = new sfn.Wait(this, 'WaitForTaskStartup', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60))
    });
    
    // 8.4.2 Add a task to describe the running task
    const describeTask = new tasks.CallAwsService(this, 'DescribeTask', {
      service: 'ecs',
      action: 'describeTasks',
      parameters: {
        Cluster: cluster.clusterArn,
        Tasks: sfn.JsonPath.array(sfn.JsonPath.stringAt('$.taskResult.Tasks[0].TaskArn'))
      },
      iamResources: ['*'],
      resultPath: '$.taskDescription'
    });
    
    // 8.5 Lambda Validation Task
    const validateTask = new tasks.LambdaInvoke(this, 'ValidateMCPServer', {
      lambdaFunction: validationFunction,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        serverId: sfn.JsonPath.stringAt('$.serverId'),
        endpoint: sfn.JsonPath.stringAt('$.taskDescription.Tasks[0].Attachments[0].Details[?(@.Name == "networkConfiguration")].Value.NetworkInterfaces[0].PublicIp'),
        taskArn: sfn.JsonPath.stringAt('$.taskDescription.Tasks[0].TaskArn'),
        imageDetails: sfn.JsonPath.objectAt('$.imageDetails'),
        // Store the executionArn for status checks
        executionArn: sfn.JsonPath.stringAt('$$.Execution.Id'),
      }),
      resultPath: '$.validationResult',
    });
    
    // 8.6 Use a Lambda function to stop the task instead
    const stopTaskFunction = new lambda.Function(this, 'StopTaskFunction', {
      functionName: 'ToolShed-Stop-ECS-Task',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'cdk/lambda/stop-task')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        CLUSTER_ARN: cluster.clusterArn
      }
    });
    
    // Grant permission to stop tasks
    stopTaskFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:StopTask'],
        resources: ['*']
      })
    );
    
    // Replace EcsRunTask with LambdaInvoke for cleanup
    const cleanupTask = new tasks.LambdaInvoke(this, 'StopMCPServerContainer', {
      lambdaFunction: stopTaskFunction,
      payload: sfn.TaskInput.fromObject({
        taskArn: sfn.JsonPath.stringAt('$.taskDescription.Tasks[0].TaskArn')
      }),
      resultPath: '$.cleanupResult'
    });
    
    // 8.6 Success and Failure States
    const successState = new sfn.Succeed(this, 'ValidationSucceeded');
    const failState = new sfn.Fail(this, 'ValidationFailed', {
      cause: 'MCP server validation failed',
      error: 'ServerValidationError',
    });
    
    // 8.7 Define Workflow - Modified to include the initialization step
    const definition = initializeStep
      .next(buildTask)
      .next(parseImageUri)
      .next(registerTask)     // Register dynamic task definition
      .next(runContainerTask) // Run the ECS task with new task definition
      .next(waitForTask)      // Wait for the task to initialize
      .next(describeTask)     // Get task details including networking info
      .next(validateTask)     // Validate the MCP server
      .next(cleanupTask)      // Stop the task
      .next(new sfn.Choice(this, 'CheckValidationResult')
        .when(sfn.Condition.booleanEquals('$.validationResult.verified', true), successState)
        .otherwise(failState)
      );
    
    // 8.8 Create State Machine - Ensure proper role configuration for registerTask
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
          stopTaskFunction.functionArn,
          extractImageUriFunction.functionArn
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

    // Create the state machine with the updated role and definition
    const stateMachine = new sfn.StateMachine(this, 'ValidationPipeline', {
      stateMachineName: 'ToolShed-MCP-Server-Validation-Pipeline',
      definition,
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
      role: stateMachineRole
    });

    // Store the state machine ARN for output
    this.stateMachineArn = stateMachine.stateMachineArn;
    
    // 9. Outputs
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'ARN of the validation pipeline state machine',
    });
    
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'URI of the ECR repository',
    });
    
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
      description: 'Name of the ECS cluster',
    });

    // Export resources for testing
    new cdk.CfnOutput(this, 'ClusterArn', {
      value: cluster.clusterArn,
      description: 'ARN of the ECS cluster',
      exportName: 'ValidationPipelineStack:ClusterArn'
    });

    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: securityGroup.securityGroupId,
      description: 'ID of the security group',
      exportName: 'ValidationPipelineStack:SecurityGroupId'
    });

    new cdk.CfnOutput(this, 'PublicSubnet1', {
      value: vpc.publicSubnets[0].subnetId,
      description: 'ID of the first public subnet',
      exportName: 'ValidationPipelineStack:PublicSubnet1'
    });

    new cdk.CfnOutput(this, 'PublicSubnet2', {
      value: vpc.publicSubnets[1].subnetId,
      description: 'ID of the second public subnet',
      exportName: 'ValidationPipelineStack:PublicSubnet2'
    });
  }
}