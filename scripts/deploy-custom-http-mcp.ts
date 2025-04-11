/**
 * Script to deploy a custom HTTP-based MCP server on ECS
 * 
 * Usage:
 *   npx ts-node -P scripts/tsconfig.json scripts/deploy-custom-http-mcp.ts
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

// Custom Express-based HTTP MCP server code
const customServerCode = `
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const app = express();
const PORT = process.env.PORT || 8000;

// Parse JSON bodies and enable CORS
app.use(express.json());
app.use(cors());

// Initialize Octokit with GitHub token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Endpoint to check server health
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Custom GitHub MCP Server running on HTTP' 
  });
});

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

// MCP server endpoint for executing tools
app.post('/execute', async (req, res) => {
  const { tool, params = {} } = req.body;
  
  try {
    let result;
    
    switch (tool) {
      case 'get_repository':
        result = await octokit.repos.get({
          owner: params.owner,
          repo: params.repo
        });
        res.json({ result: result.data });
        break;
        
      case 'search_repositories':
        result = await octokit.search.repos({
          q: params.query,
          sort: params.sort,
          order: params.order
        });
        res.json({ result: result.data });
        break;
        
      case 'list_issues':
        result = await octokit.issues.listForRepo({
          owner: params.owner,
          repo: params.repo,
          state: params.state || 'open',
          sort: params.sort || 'created'
        });
        res.json({ result: result.data });
        break;
        
      default:
        res.status(400).json({ error: \`Unknown tool: \${tool}\` });
        break;
    }
  } catch (error) {
    console.error('Error executing tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(\`Custom GitHub MCP Server running on HTTP port \${PORT}\`);
});
`;

// Create a startup script
function createStartupScript(): string {
  const tempDir = os.tmpdir();
  const serverJsPath = path.join(tempDir, `custom-mcp-server-${Date.now()}.js`);
  fs.writeFileSync(serverJsPath, customServerCode, 'utf8');
  
  const scriptContent = `#!/bin/sh
cd /tmp
cat > server.js << 'EOL'
${customServerCode}
EOL
npm init -y
npm install --no-save express cors @octokit/rest
node server.js
`;

  const scriptPath = path.join(tempDir, `startup-${Date.now()}.sh`);
  fs.writeFileSync(scriptPath, scriptContent, 'utf8');
  return scriptPath;
}

async function main() {
  try {
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN not found in environment variables');
    }
    
    const serverName = `custom-http-mcp-server-${Date.now().toString().slice(-6)}`;
    
    console.log(`\n=== Deploying Custom HTTP MCP Server ===`);
    console.log(`Server Name: ${serverName}`);
    console.log(`Using GitHub Token: ${githubToken.substring(0, 5)}...${githubToken.substring(githubToken.length - 5)}`);
    
    // Create startup script
    console.log('\nStep 1: Creating startup script...');
    const scriptPath = createStartupScript();
    console.log(`Startup script created at: ${scriptPath}`);
    
    // Register a task definition
    console.log('\nStep 2: Registering task definition...');
    const registerTaskDefCommand = new RegisterTaskDefinitionCommand({
      family: `custom-mcp-task-${Date.now().toString().slice(-6)}`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '512',  // 0.5 vCPU
      memory: '1024', // 1GB RAM
      executionRoleArn,
      containerDefinitions: [
        {
          name: serverName,
          image: 'node:18-alpine',
          essential: true,
          command: [
            '/bin/sh', 
            '-c', 
            `cd /tmp && echo '
const express = require("express");
const cors = require("cors");
const { Octokit } = require("@octokit/rest");
const app = express();
const PORT = process.env.PORT || 8000;

// Parse JSON bodies and enable CORS
app.use(express.json());
app.use(cors());

// Initialize Octokit with GitHub token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Endpoint to check server health
app.get("/", (req, res) => {
  res.json({ 
    status: "ok",
    message: "Custom GitHub MCP Server running on HTTP" 
  });
});

// MCP server endpoint for listing available tools
app.get("/tools", (req, res) => {
  const tools = [
    {
      name: "get_repository",
      description: "Get information about a GitHub repository",
      parameters: {
        owner: {
          type: "string",
          description: "Repository owner",
          required: true
        },
        repo: {
          type: "string",
          description: "Repository name",
          required: true
        }
      }
    },
    {
      name: "search_repositories",
      description: "Search for GitHub repositories",
      parameters: {
        query: {
          type: "string",
          description: "Search query",
          required: true
        },
        sort: {
          type: "string",
          description: "Sort field (stars, forks, updated)",
          required: false
        },
        order: {
          type: "string",
          description: "Sort order (asc, desc)",
          required: false
        }
      }
    },
    {
      name: "list_issues",
      description: "List issues for a repository",
      parameters: {
        owner: {
          type: "string",
          description: "Repository owner",
          required: true
        },
        repo: {
          type: "string",
          description: "Repository name",
          required: true
        },
        state: {
          type: "string",
          description: "Issue state (open, closed, all)",
          required: false
        },
        sort: {
          type: "string",
          description: "Sort field (created, updated, comments)",
          required: false
        }
      }
    }
  ];
  
  res.json({ tools });
});

// MCP server endpoint for executing tools
app.post("/execute", async (req, res) => {
  const { tool, params = {} } = req.body;
  
  try {
    let result;
    
    switch (tool) {
      case "get_repository":
        result = await octokit.repos.get({
          owner: params.owner,
          repo: params.repo
        });
        res.json({ result: result.data });
        break;
        
      case "search_repositories":
        result = await octokit.search.repos({
          q: params.query,
          sort: params.sort,
          order: params.order
        });
        res.json({ result: result.data });
        break;
        
      case "list_issues":
        result = await octokit.issues.listForRepo({
          owner: params.owner,
          repo: params.repo,
          state: params.state || "open",
          sort: params.sort || "created"
        });
        res.json({ result: result.data });
        break;
        
      default:
        res.status(400).json({ error: "Unknown tool: " + tool });
        break;
    }
  } catch (error) {
    console.error("Error executing tool:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log("Custom GitHub MCP Server running on HTTP port " + PORT);
});
' > server.js && npm init -y && npm install --no-save express cors @octokit/rest && node server.js`
          ],
          environment: [
            { name: 'GITHUB_TOKEN', value: githubToken },
            { name: 'PORT', value: '8000' }
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
    fs.unlinkSync(scriptPath);
    
  } catch (error: any) {
    console.error('ERROR:', error.message);
  }
}

main().catch(console.error); 