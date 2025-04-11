import { SFNClient, UpdateStateMachineCommand, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { CodeBuildClient, UpdateProjectCommand, BatchGetProjectsCommand } from '@aws-sdk/client-codebuild';

// Configure AWS SDK
const region = 'us-east-1';
const sfnClient = new SFNClient({ region });
const codebuildClient = new CodeBuildClient({ region });

// Constants
const stateMachineArn = 'arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline';
const codeBuildProjectName = 'ToolShed-MCP-Server-Build';

async function main() {
  try {
    console.log('Starting the update process...');
    
    // Step 1: Update the CodeBuild project's buildspec to use originalRepositoryName for git clone
    console.log('Getting current CodeBuild project configuration...');
    const getBuildProjectResponse = await codebuildClient.send(
      new BatchGetProjectsCommand({ names: [codeBuildProjectName] })
    );
    
    if (!getBuildProjectResponse.projects || getBuildProjectResponse.projects.length === 0) {
      throw new Error(`CodeBuild project ${codeBuildProjectName} not found`);
    }
    
    const project = getBuildProjectResponse.projects[0];
    
    // Create the updated buildspec with originalRepositoryName
    const updatedBuildSpec = {
      version: '0.2',
      phases: {
        pre_build: {
          commands: [
            'echo Logging in to Amazon ECR...',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
            'REPO_URL=$(echo $CODEBUILD_INITIATOR | cut -d/ -f2)',
            'REPO_NAME=$(echo $REPO_URL | cut -d@ -f1)',
            'echo "Repository Name: $REPOSITORY_NAME"',
            'echo "Original Repository Name: $ORIGINAL_REPOSITORY_NAME"',
            'IMAGE_TAG=${REPOSITORY_NAME}:${CODEBUILD_RESOLVED_SOURCE_VERSION}'
          ],
        },
        build: {
          commands: [
            'echo Cloning repository...',
            'git clone https://$GITHUB_TOKEN@github.com/$ORIGINAL_REPOSITORY_NAME.git repo',
            'cd repo',
            'echo Building the Docker image...',
            'docker build -t $REPOSITORY_URI:$IMAGE_TAG .',
            'docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest'
          ],
        },
        post_build: {
          commands: [
            'echo Pushing the Docker image...',
            'docker push $REPOSITORY_URI:$IMAGE_TAG',
            'docker push $REPOSITORY_URI:latest',
            'echo Writing image definition file...',
            'echo "{\"imageUri\":\"$REPOSITORY_URI:$IMAGE_TAG\", \"serverId\":\"$SERVER_ID\"}" > imageDefinition.json'
          ],
        },
      },
      artifacts: {
        files: ['imageDefinition.json'],
      },
    };
    
    console.log('Updating CodeBuild project with new buildspec...');
    await codebuildClient.send(
      new UpdateProjectCommand({
        name: codeBuildProjectName,
        buildSpec: JSON.stringify(updatedBuildSpec)
      })
    );
    
    // Step 2: Update the Step Functions state machine to pass originalRepositoryName to CodeBuild
    console.log('Getting current Step Functions state machine definition...');
    const getStateMachineResponse = await sfnClient.send(
      new DescribeStateMachineCommand({ stateMachineArn })
    );
    
    let currentDefinition = JSON.parse(getStateMachineResponse.definition);
    
    // Find the CodeBuild task and update it to pass originalRepositoryName
    console.log('Updating Step Functions state machine definition...');
    
    // Look for the BuildMCPServerImage task
    if (currentDefinition.States && 
        currentDefinition.States.BuildMCPServerImage && 
        currentDefinition.States.BuildMCPServerImage.Parameters && 
        currentDefinition.States.BuildMCPServerImage.Parameters.EnvironmentVariablesOverride) {
      
      // Check if ORIGINAL_REPOSITORY_NAME already exists
      const envVars = currentDefinition.States.BuildMCPServerImage.Parameters.EnvironmentVariablesOverride;
      const originalRepoVarExists = envVars.some(v => v.Name === 'ORIGINAL_REPOSITORY_NAME');
      
      if (!originalRepoVarExists) {
        // Add the new environment variable
        envVars.push({
          Name: 'ORIGINAL_REPOSITORY_NAME',
          Value: '$.originalRepositoryName',
          Type: 'PLAINTEXT'
        });
        
        // Also add SERVER_ID variable
        const serverIdVarExists = envVars.some(v => v.Name === 'SERVER_ID');
        if (!serverIdVarExists) {
          envVars.push({
            Name: 'SERVER_ID',
            Value: '$.serverId',
            Type: 'PLAINTEXT'
          });
        }
        
        console.log('Added ORIGINAL_REPOSITORY_NAME and SERVER_ID to environment variables');
      } else {
        console.log('ORIGINAL_REPOSITORY_NAME already exists in environment variables');
      }
    } else {
      console.error('Could not find BuildMCPServerImage state or its environment variables in the state machine definition');
    }
    
    // Update the state machine definition
    console.log('Applying state machine updates...');
    await sfnClient.send(
      new UpdateStateMachineCommand({
        stateMachineArn,
        definition: JSON.stringify(currentDefinition, null, 2)
      })
    );
    
    console.log('Update completed successfully.');
  } catch (error) {
    console.error('Error updating step function:', error);
  }
}

main(); 