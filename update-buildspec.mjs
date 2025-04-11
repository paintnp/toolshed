import { CodeBuildClient, UpdateProjectCommand } from '@aws-sdk/client-codebuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure AWS SDK
const region = 'us-east-1';
const codebuildClient = new CodeBuildClient({ region });

async function main() {
  try {
    // Read the updated buildspec from file
    const buildspecPath = path.join(__dirname, 'new-buildspec.json');
    console.log(`Reading buildspec from ${buildspecPath}`);
    const buildspecJson = JSON.parse(fs.readFileSync(buildspecPath, 'utf8'));
    
    // Update the project with the new buildspec
    console.log('Updating CodeBuild project...');
    const updateResult = await codebuildClient.send(
      new UpdateProjectCommand({
        name: 'ToolShed-MCP-Server-Build',
        source: {
          type: 'NO_SOURCE',
          buildspec: JSON.stringify(buildspecJson)
        }
      })
    );
    
    console.log('Update successful!');
    console.log('Updated source configuration:', updateResult.project.source);
  } catch (error) {
    console.error('Error updating CodeBuild project:', error);
  }
}

main(); 