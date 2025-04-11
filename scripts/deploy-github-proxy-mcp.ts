/**
 * Script to deploy a GitHub MCP Proxy Server on ECS
 * This server acts as a proxy to GitHub APIs and functions as an MCP server
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/deploy-github-proxy-mcp.ts
 */

import { 
  ECSClient, 
  RunTaskCommand,
  RegisterTaskDefinitionCommand
} from "@aws-sdk/client-ecs";
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Settings
const region = process.env.AWS_REGION || 'us-east-1';
const cluster = process.env.AWS_ECS_CLUSTER || 'ToolShedCluster';
const subnets = process.env.AWS_SUBNETS ? process.env.AWS_SUBNETS.split(',') : [
  'subnet-07bc787a013cf5926',
  'subnet-0c0af47e04884bb80',
  'subnet-074535b0c6a340c11',
  'subnet-0e468f181287bbce4',
  'subnet-0792e0563b7a805cf',
  'subnet-0127f23858bc25529'
];
const securityGroups = process.env.AWS_SECURITY_GROUP_ID ? 
  [process.env.AWS_SECURITY_GROUP_ID] : ['sg-05aef5694ddf3eee3'];
const executionRoleArn = process.env.AWS_EXECUTION_ROLE_ARN || '';
const githubToken = process.env.GITHUB_TOKEN || '';

// Create clients
const ecsClient = new ECSClient({ region });

// Create a temporary file with the server code
async function createTempServerFile(): Promise<string> {
  // Simple MCP server implementation with ESM syntax
  const serverJs = `// Server.js - ESM version
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8000;

// Parse JSON bodies
app.use(express.json());

// MCP server endpoint for listing available tools
app.get('/tools', (req, res) => {
  const tools = [
    {
      name: 'get_repository',
      description: 'Get information about a GitHub repository',
      parameters: {
        owner: {
          type: 'string',
          description: 'Repository owner',
          required: true
        },
        repo: {
          type: 'string',
          description: 'Repository name',
          required: true
        }
      }
    },
    {
      name: 'search_repositories',
      description: 'Search for GitHub repositories',
      parameters: {
        query: {
          type: 'string',
          description: 'Search query',
          required: true
        },
        sort: {
          type: 'string',
          description: 'Sort field (stars, forks, updated)',
          required: false
        },
        order: {
          type: 'string',
          description: 'Sort order (asc, desc)',
          required: false
        }
      }
    },
    {
      name: 'list_issues',
      description: 'List issues for a repository',
      parameters: {
        owner: {
          type: 'string',
          description: 'Repository owner',
          required: true
        },
        repo: {
          type: 'string',
          description: 'Repository name',
          required: true
        },
        state: {
          type: 'string',
          description: 'Issue state (open, closed, all)',
          required: false
        },
        sort: {
          type: 'string',
          description: 'Sort field (created, updated, comments)',
          required: false
        }
      }
    }
  ];
  
  res.json({ tools });
});

// Import Octokit at runtime using dynamic import
let octokit;

// Initialize Octokit asynchronously
async function initOctokit() {
  try {
    // Use package that doesn't require ESM
    const { Octokit } = require('@octokit/core');
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    console.log('Octokit initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Octokit:', error);
    process.exit(1);
  }
}

// MCP server endpoint for executing tools
app.post('/execute', async (req, res) => {
  if (!octokit) {
    return res.status(503).json({ error: 'Server is still initializing. Please try again in a few seconds.' });
  }
  
  const { tool, params = {} } = req.body;
  
  try {
    let result;
    
    switch (tool) {
      case 'get_repository':
        result = await octokit.request('GET /repos/{owner}/{repo}', {
          owner: params.owner,
          repo: params.repo
        });
        break;
        
      case 'search_repositories':
        result = await octokit.request('GET /search/repositories', {
          q: params.query,
          sort: params.sort,
          order: params.order
        });
        break;
        
      case 'list_issues':
        result = await octokit.request('GET /repos/{owner}/{repo}/issues', {
          owner: params.owner,
          repo: params.repo,
          state: params.state || 'open',
          sort: params.sort || 'created'
        });
        break;
        
      default:
        return res.status(400).json({ error: \`Unknown tool: \${tool}\` });
    }
    
    res.json({ result: result.data });
  } catch (error) {
    console.error('Error executing tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
async function startServer() {
  await initOctokit();
  app.listen(PORT, () => {
    console.log(\`GitHub MCP Proxy Server running on port \${PORT}\`);
  });
}

startServer();
`;

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `server-${Date.now()}.js`);
  fs.writeFileSync(tempFilePath, serverJs, 'utf8');
  return tempFilePath;
}

async function main() {
  try {
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN not found in environment variables');
    }
    
    const serverName = `github-mcp-proxy-${Date.now().toString().slice(-6)}`;
    const containerName = `github-mcp-proxy-${Date.now().toString().slice(-6)}`;
    
    console.log(`\n=== Deploying GitHub MCP Proxy Server ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Container Name: ${containerName}`);
    
    // Create server.js file
    console.log('\nStep 1: Creating server.js file...');
    const serverFilePath = await createTempServerFile();
    
    // Create startup script
    const initScript = `#!/bin/sh
mkdir -p /app
cd /app
cat > server.js << 'EOL'
$(cat ${serverFilePath})
EOL
npm init -y
npm install --no-save express @octokit/core dotenv
node server.js
`;
    
    const initScriptPath = path.join(os.tmpdir(), `init-${Date.now()}.sh`);
    fs.writeFileSync(initScriptPath, initScript, 'utf8');
    console.log(`Startup script created at ${initScriptPath}`);
    
    // Display file content
    console.log('\nScript content:');
    console.log('----------------------------------------');
    console.log(fs.readFileSync(initScriptPath, 'utf8').slice(0, 500) + '...');
    console.log('----------------------------------------');
    
    // Register a task definition
    console.log('\nStep 2: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `github-mcp-proxy-task-${Date.now().toString().slice(-6)}`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '512',  // 0.5 vCPU
      memory: '1024', // 1GB RAM
      executionRoleArn,
      containerDefinitions: [
        {
          name: containerName,
          image: 'node:18-alpine',
          essential: true,
          command: [
            "/bin/sh", 
            "-c", 
            // Use a simple and reliable startup script that doesn't rely on ESM imports
            "cd /tmp && echo '// Server.js\\nconst express = require(\"express\");\\nconst app = express();\\nconst PORT = process.env.PORT || 8000;\\n\\n// Parse JSON bodies\\napp.use(express.json());\\n\\n// MCP server endpoint for listing available tools\\napp.get(\"/tools\", (req, res) => {\\n  const tools = [\\n    {\\n      name: \"get_repository\",\\n      description: \"Get information about a GitHub repository\",\\n      parameters: {\\n        owner: {\\n          type: \"string\",\\n          description: \"Repository owner\",\\n          required: true\\n        },\\n        repo: {\\n          type: \"string\",\\n          description: \"Repository name\",\\n          required: true\\n        }\\n      }\\n    }\\n  ];\\n  \\n  res.json({ tools });\\n});\\n\\n// Import Octokit and initialize it\\nlet octokit;\\n\\nasync function initOctokit() {\\n  try {\\n    const { Octokit } = require(\"@octokit/core\");\\n    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });\\n    console.log(\"Octokit initialized successfully\");\\n  } catch (error) {\\n    console.error(\"Failed to initialize Octokit:\", error);\\n    process.exit(1);\\n  }\\n}\\n\\n// MCP server endpoint for executing tools\\napp.post(\"/execute\", async (req, res) => {\\n  if (!octokit) {\\n    return res.status(503).json({ error: \"Server is still initializing\" });\\n  }\\n  \\n  const { tool, params = {} } = req.body;\\n  \\n  try {\\n    let result;\\n    \\n    if (tool === \"get_repository\") {\\n      result = await octokit.request(\"GET /repos/{owner}/{repo}\", {\\n        owner: params.owner,\\n        repo: params.repo\\n      });\\n      res.json({ result: result.data });\\n    } else {\\n      res.status(400).json({ error: \"Unknown tool\" });\\n    }\\n  } catch (error) {\\n    console.error(\"Error executing tool:\", error);\\n    res.status(500).json({ error: error.message });\\n  }\\n});\\n\\n// Start the server\\nasync function startServer() {\\n  await initOctokit();\\n  app.listen(PORT, () => {\\n    console.log(`GitHub MCP Proxy Server running on port ${PORT}`);\\n  });\\n}\\n\\nstartServer();' > server.js && npm init -y && npm install --no-save express @octokit/core dotenv && node server.js"
          ],
          environment: [
            { name: 'PORT', value: '8000' },
            { name: 'GITHUB_TOKEN', value: githubToken }
          ],
          portMappings: [
            {
              containerPort: 8000,
              hostPort: 8000,
              protocol: 'tcp'
            }
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': 'ecs',
              'awslogs-region': region,
              'awslogs-stream-prefix': 'mcp'
            }
          }
        }
      ]
    });
    
    const taskDefResponse = await ecsClient.send(registerTaskDefCommand);
    if (!taskDefResponse.taskDefinition?.taskDefinitionArn) {
      throw new Error('Failed to register task definition');
    }
    
    const taskDefArn = taskDefResponse.taskDefinition.taskDefinitionArn;
    console.log(`Task definition registered: ${taskDefArn}`);
    
    // Run the task
    console.log('\nStep 3: Launching Fargate task...');
    const runTaskCommand = new RunTaskCommand({
      cluster,
      taskDefinition: taskDefArn,
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: 'ENABLED'
        }
      }
    });
    
    const runTaskResult = await ecsClient.send(runTaskCommand);
    
    if (!runTaskResult.tasks || runTaskResult.tasks.length === 0) {
      const failureReason = runTaskResult.failures && runTaskResult.failures.length > 0
        ? runTaskResult.failures[0].reason
        : 'Unknown reason';
      
      throw new Error(`Failed to start task: ${failureReason}`);
    }
    
    const taskArn = runTaskResult.tasks[0].taskArn;
    const taskId = taskArn?.split('/').pop();
    console.log(`Task started with ARN: ${taskArn}`);
    
    // Provide info to stop the task
    console.log('\nTo stop this task, run:');
    console.log(`aws ecs stop-task --cluster ${cluster} --task ${taskId} --region ${region}`);
    
    // Track the private IP
    if (runTaskResult.tasks[0].attachments && runTaskResult.tasks[0].attachments.length > 0) {
      console.log('\nTask network details:');
      console.log(JSON.stringify(runTaskResult.tasks[0].attachments, null, 2));
    }
    
    console.log('\nTask is running. To access this container, you need to:');
    console.log('1. Wait for the task to reach RUNNING state (usually 30-60 seconds)');
    console.log('2. Get the private IP address using:');
    console.log(`   aws ecs describe-tasks --cluster ${cluster} --tasks ${taskId} --region ${region}`);
    console.log('3. Set up an ALB or other routing mechanism to access the container');
    console.log('\nAfter getting the private IP, you can set up an ALB using:');
    console.log(`   npx ts-node -P scripts/tsconfig.json scripts/setup-alb-for-mcp.ts <privateIP> 8000`);
    
    // Clean up
    fs.unlinkSync(serverFilePath);
    fs.unlinkSync(initScriptPath);
    
  } catch (error: any) {
    console.error('ERROR:', error.message);
  }
}

main().catch(console.error); 