import { SFNClient, UpdateStateMachineCommand, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { CodeBuildClient, UpdateProjectCommand, BatchGetProjectsCommand } from '@aws-sdk/client-codebuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure AWS SDK
const region = 'us-east-1';
const sfnClient = new SFNClient({ region });
const codebuildClient = new CodeBuildClient({ region });

// Constants
const stateMachineArn = 'arn:aws:states:us-east-1:277502524328:stateMachine:ToolShed-MCP-Server-Validation-Pipeline';
const codeBuildProjectName = 'ToolShed-MCP-Server-Build';

// Helper function to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function verifyCodeBuildUpdate() {
  console.log('Verifying CodeBuild project update...');
  const response = await codebuildClient.send(
    new BatchGetProjectsCommand({ names: [codeBuildProjectName] })
  );
  
  if (!response.projects || response.projects.length === 0) {
    console.error('Could not find the project after update!');
    return false;
  }
  
  const project = response.projects[0];
  const buildspec = project.source?.buildspec;
  
  if (!buildspec) {
    console.error('Project has no buildspec after update!');
    return false;
  }
  
  const parsedBuildspec = JSON.parse(buildspec);
  
  // Check for ORIGINAL_REPOSITORY_NAME in build section
  const buildCommands = parsedBuildspec.phases?.build?.commands || [];
  const usesOriginalRepo = buildCommands.some(cmd => 
    cmd.includes('$ORIGINAL_REPOSITORY_NAME')
  );
  
  if (!usesOriginalRepo) {
    console.error('Buildspec is not using ORIGINAL_REPOSITORY_NAME for git clone!');
    console.log('Current buildspec:', JSON.stringify(parsedBuildspec, null, 2));
    return false;
  }
  
  console.log('Buildspec was successfully updated to use ORIGINAL_REPOSITORY_NAME');
  return true;
}

async function main() {
  try {
    console.log('Starting the update process...');
    
    // Step 1: Update the CodeBuild project's buildspec
    console.log('Getting current CodeBuild project configuration...');
    const getBuildProjectResponse = await codebuildClient.send(
      new BatchGetProjectsCommand({ names: [codeBuildProjectName] })
    );
    
    if (!getBuildProjectResponse.projects || getBuildProjectResponse.projects.length === 0) {
      throw new Error(`CodeBuild project ${codeBuildProjectName} not found`);
    }
    
    const project = getBuildProjectResponse.projects[0];
    
    // Read the updated buildspec from file
    const buildspecPath = path.join(__dirname, 'new-buildspec.json');
    console.log(`Reading buildspec from ${buildspecPath}`);
    const updatedBuildSpec = JSON.parse(fs.readFileSync(buildspecPath, 'utf8'));
    
    console.log('Updating CodeBuild project with new buildspec...');
    await codebuildClient.send(
      new UpdateProjectCommand({
        name: codeBuildProjectName,
        buildSpec: JSON.stringify(updatedBuildSpec)
      })
    );
    
    // Wait for 5 seconds to ensure the update has time to propagate
    console.log('Waiting for update to propagate...');
    await sleep(5000);
    
    // Verify that the buildspec was updated correctly
    const updateSuccessful = await verifyCodeBuildUpdate();
    if (!updateSuccessful) {
      console.log('Attempting to update buildspec again with direct inline JSON...');
      // Try direct approach by setting the buildspec inline
      await codebuildClient.send(
        new UpdateProjectCommand({
          name: codeBuildProjectName,
          source: {
            type: 'NO_SOURCE',
            buildspec: JSON.stringify(updatedBuildSpec)
          }
        })
      );
      
      // Wait again and verify
      await sleep(5000);
      const secondAttemptSuccess = await verifyCodeBuildUpdate();
      if (!secondAttemptSuccess) {
        throw new Error('Failed to update the buildspec even after second attempt.');
      }
    }
    
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
      
      // Get the environment variables array
      const envVars = currentDefinition.States.BuildMCPServerImage.Parameters.EnvironmentVariablesOverride;
      
      // Fix JsonPath syntax for all environment variables
      for (let i = 0; i < envVars.length; i++) {
        // If the variable uses JsonPath but doesn't have the correct syntax
        if (envVars[i].Value && (
            envVars[i].Value.startsWith('$.') || 
            envVars[i].Value.includes('$.')
        )) {
          // Value should be a JsonPath reference
          const jsonPathValue = envVars[i].Value;
          delete envVars[i].Value;
          envVars[i]['Value.$'] = jsonPathValue;
          console.log(`Fixed JsonPath syntax for ${envVars[i].Name}`);
        }
      }
      
      // Check if ORIGINAL_REPOSITORY_NAME already exists
      const originalRepoVarExists = envVars.some(v => v.Name === 'ORIGINAL_REPOSITORY_NAME');
      
      if (!originalRepoVarExists) {
        // Add the new environment variable
        envVars.push({
          Name: 'ORIGINAL_REPOSITORY_NAME',
          'Value.$': '$.originalRepositoryName',
          Type: 'PLAINTEXT'
        });
        
        // Also add SERVER_ID variable
        const serverIdVarExists = envVars.some(v => v.Name === 'SERVER_ID');
        if (!serverIdVarExists) {
          envVars.push({
            Name: 'SERVER_ID',
            'Value.$': '$.serverId',
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