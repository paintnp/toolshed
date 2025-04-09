import { Navigation } from "@/components/Navigation";

export default function ApiAccess() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">API Access</h1>

        <div className="space-y-8">
          {/* Introduction */}
          <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-4">Introduction</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              ToolShed provides a REST API that allows you to programmatically access MCP server data 
              and execute tools. This API enables integration into your own applications, scripts, or 
              workflows without using the web interface.
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              All API endpoints return data in JSON format and accept standard HTTP methods.
            </p>
          </section>

          {/* Authentication */}
          <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-4">Authentication</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The API is currently open and does not require authentication. This is suitable for
              development and testing purposes.
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 p-4 rounded">
              <p className="text-amber-700 dark:text-amber-300 font-medium">Note</p>
              <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">
                Authentication via API keys will be implemented in a future release for production use.
                We will provide ample notice before making this change.
              </p>
            </div>
          </section>

          {/* Endpoints */}
          <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-6">API Endpoints</h2>
            
            {/* List Servers Endpoint */}
            <div className="mb-8">
              <div className="flex items-center mb-3">
                <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-3 py-1 rounded-lg text-sm font-medium mr-2">GET</span>
                <h3 className="text-xl font-semibold font-mono">/api/servers</h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Returns a list of available MCP servers with basic metadata. You can filter servers by name,
                description, or tags using the <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded text-sm">query</code> parameter.
              </p>
              
              <h4 className="text-lg font-medium mb-2">Parameters</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <dl className="space-y-2">
                  <div className="grid grid-cols-3 gap-4">
                    <dt className="font-mono text-sm">query</dt>
                    <dd className="col-span-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Optional.</span> Filter servers by name, description, or tags
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <dt className="font-mono text-sm">limit</dt>
                    <dd className="col-span-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Optional.</span> Maximum number of results to return (default: 10)
                    </dd>
                  </div>
                </dl>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Request</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <pre className="text-sm overflow-auto">{`GET /api/servers?query=database`}</pre>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Response</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`{
  "servers": [
    {
      "id": "2",
      "name": "Database MCP Server",
      "description": "Provides SQL database access tools",
      "language": "Python",
      "tags": ["database", "sql", "postgresql"]
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}`}</pre>
              </div>
            </div>
            
            {/* Get Server Details Endpoint */}
            <div className="mb-8">
              <div className="flex items-center mb-3">
                <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-3 py-1 rounded-lg text-sm font-medium mr-2">GET</span>
                <h3 className="text-xl font-semibold font-mono">/api/servers/{'{id}'}</h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Returns detailed information about a specific MCP server, including all available tools and metadata.
              </p>
              
              <h4 className="text-lg font-medium mb-2">Parameters</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <dl className="space-y-2">
                  <div className="grid grid-cols-3 gap-4">
                    <dt className="font-mono text-sm">id</dt>
                    <dd className="col-span-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Required.</span> The unique identifier of the server
                    </dd>
                  </div>
                </dl>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Request</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <pre className="text-sm overflow-auto">{`GET /api/servers/1`}</pre>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Response</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`{
  "id": "1",
  "name": "GitHub MCP Server",
  "description": "MCP server for GitHub operations",
  "language": "TypeScript",
  "tags": ["github", "git", "version-control"],
  "author": "ToolShed Team",
  "version": "1.2.0",
  "lastUpdated": "2023-11-15",
  "status": "Active",
  "source": "https://github.com/toolshed/github-mcp-server",
  "tools": [
    {
      "name": "list_repos",
      "description": "List repositories of a user",
      "parameters": {
        "username": {
          "type": "string",
          "required": true,
          "description": "GitHub username"
        }
      }
    },
    {
      "name": "create_issue",
      "description": "Create an issue on a repository",
      "parameters": {
        "repo": {
          "type": "string",
          "required": true,
          "description": "Repository name in owner/repo format"
        },
        "title": {
          "type": "string",
          "required": true,
          "description": "Issue title"
        },
        "body": {
          "type": "string",
          "required": false,
          "description": "Issue description"
        }
      }
    }
  ]
}`}</pre>
              </div>
            </div>
            
            {/* Execute Tool Endpoint */}
            <div className="mb-8">
              <div className="flex items-center mb-3">
                <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-lg text-sm font-medium mr-2">POST</span>
                <h3 className="text-xl font-semibold font-mono">/api/servers/{'{id}'}/execute</h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Executes a specific tool on the MCP server. Provide the tool name and parameters in the request body.
              </p>
              
              <h4 className="text-lg font-medium mb-2">Request Body</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`{
  "tool": "string",     // Required. The name of the tool to execute
  "parameters": {       // Required. Tool-specific parameters
    // Depends on the tool being executed
  }
}`}</pre>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Request</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`POST /api/servers/1/execute
Content-Type: application/json

{
  "tool": "list_repos",
  "parameters": {
    "username": "example_user"
  }
}`}</pre>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Example Response</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`{
  "success": true,
  "result": [
    {
      "name": "project-alpha",
      "description": "A demo project",
      "stars": 45
    },
    {
      "name": "awesome-lib",
      "description": "Utility library",
      "stars": 128
    }
  ]
}`}</pre>
              </div>
              
              <h4 className="text-lg font-medium mb-2">Error Response</h4>
              <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                <pre className="text-sm overflow-auto whitespace-pre-wrap">{`{
  "success": false,
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "The parameter 'username' is required"
  }
}`}</pre>
              </div>
            </div>
          </section>
          
          {/* Usage Tips */}
          <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-4">Usage Tips</h2>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>Tool execution may take a few seconds to complete as it runs in a sandboxed environment.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>The API has a rate limit of 100 requests per minute per IP address.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>Server data is refreshed daily from registered sources.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>For large datasets, use the <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded text-sm">limit</code> and <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded text-sm">offset</code> parameters to paginate results.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>Error responses include descriptive messages to help you debug issues.</span>
              </li>
            </ul>
          </section>
          
          {/* Client Libraries */}
          <section className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-4">Client Libraries</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              While you can use any HTTP client to interact with our API, we offer official client 
              libraries for popular programming languages:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <a href="#" className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <h3 className="font-semibold flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  JavaScript/TypeScript
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  npm install toolshed-api-client
                </p>
              </a>
              <a href="#" className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <h3 className="font-semibold flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Python
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  pip install toolshed-api
                </p>
              </a>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              *Client libraries are coming soon. Check back for updates.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
} 