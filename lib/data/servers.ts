// Mock data for MCP servers
export const servers = [
  { 
    id: "1", 
    name: "GitHub MCP Server", 
    description: "MCP server for GitHub operations", 
    language: "TypeScript",
    tags: ["github", "git", "version-control"]
  },
  { 
    id: "2", 
    name: "Database MCP Server", 
    description: "Provides SQL database access tools", 
    language: "Python",
    tags: ["database", "sql", "postgresql"]
  },
  { 
    id: "3", 
    name: "OpenAI MCP Server", 
    description: "Interface with OpenAI API endpoints", 
    language: "TypeScript",
    tags: ["ai", "openai", "gpt"]
  },
  { 
    id: "4", 
    name: "Web Search MCP Server", 
    description: "Search the web with various providers", 
    language: "JavaScript",
    tags: ["search", "web", "browser"]
  },
  { 
    id: "5", 
    name: "Image Generation MCP Server", 
    description: "Generate images using AI models", 
    language: "Python",
    tags: ["image", "ai", "generation"]
  }
];

// Detailed server information including tools
export const serverDetails = {
  "1": { 
    id: "1", 
    name: "GitHub MCP Server", 
    description: "MCP server for GitHub operations", 
    language: "TypeScript",
    tags: ["github", "git", "version-control"],
    longDescription: "A powerful MCP server that provides seamless integration with GitHub repositories. It allows you to perform operations like creating repositories, managing issues, and handling pull requests programmatically.",
    author: "ToolShed Team",
    version: "1.2.0",
    lastUpdated: "2023-11-15",
    status: "Active",
    source: "https://github.com/toolshed/github-mcp-server",
    tools: [
      { 
        name: "list_repos", 
        description: "List repositories of a user",
        parameters: {
          username: {
            type: "string",
            required: true,
            description: "GitHub username"
          }
        }
      },
      { 
        name: "create_issue", 
        description: "Create an issue on a repository",
        parameters: {
          repo: {
            type: "string",
            required: true,
            description: "Repository name in owner/repo format"
          },
          title: {
            type: "string",
            required: true,
            description: "Issue title"
          },
          body: {
            type: "string",
            required: false,
            description: "Issue description"
          }
        }
      },
      { 
        name: "create_pull_request", 
        description: "Create a pull request",
        parameters: {
          repo: {
            type: "string",
            required: true,
            description: "Repository name in owner/repo format"
          },
          title: {
            type: "string",
            required: true,
            description: "PR title"
          },
          head: {
            type: "string",
            required: true,
            description: "The name of the branch where your changes are implemented"
          },
          base: {
            type: "string",
            required: true,
            description: "The name of the branch you want the changes pulled into"
          },
          body: {
            type: "string",
            required: false,
            description: "PR description"
          }
        }
      },
      { 
        name: "merge_pull_request", 
        description: "Merge a pull request",
        parameters: {
          repo: {
            type: "string",
            required: true,
            description: "Repository name in owner/repo format"
          },
          pull_number: {
            type: "number",
            required: true,
            description: "The number of the PR"
          },
          commit_message: {
            type: "string",
            required: false,
            description: "Commit message for the merge"
          }
        }
      },
      { 
        name: "get_repository_contents", 
        description: "Get contents of a repository",
        parameters: {
          repo: {
            type: "string",
            required: true,
            description: "Repository name in owner/repo format"
          },
          path: {
            type: "string",
            required: false,
            description: "Path to the content in the repository"
          },
          ref: {
            type: "string",
            required: false,
            description: "The name of the commit/branch/tag"
          }
        }
      }
    ]
  },
  "2": { 
    id: "2", 
    name: "Database MCP Server", 
    description: "Provides SQL database access tools", 
    language: "Python",
    tags: ["database", "sql", "postgresql"],
    longDescription: "This MCP server provides tools to interact with SQL databases. It supports multiple database types including PostgreSQL, MySQL, and SQLite, allowing for queries, schema management, and data manipulation.",
    author: "DB Tools Inc.",
    version: "0.9.5",
    lastUpdated: "2023-12-03",
    status: "Active",
    source: "https://github.com/dbtools/sql-mcp-server",
    tools: [
      { 
        name: "execute_query", 
        description: "Execute SQL query on a database",
        parameters: {
          database: {
            type: "string",
            required: true,
            description: "Database connection string or identifier"
          },
          query: {
            type: "string",
            required: true,
            description: "SQL query to execute"
          },
          params: {
            type: "object",
            required: false,
            description: "Query parameters (for parameterized queries)"
          }
        }
      },
      { 
        name: "list_tables", 
        description: "List all tables in a database",
        parameters: {
          database: {
            type: "string",
            required: true,
            description: "Database connection string or identifier"
          }
        }
      },
      { 
        name: "describe_table", 
        description: "Get schema information for a table",
        parameters: {
          database: {
            type: "string",
            required: true,
            description: "Database connection string or identifier"
          },
          table: {
            type: "string",
            required: true,
            description: "Table name"
          }
        }
      },
      { 
        name: "create_table", 
        description: "Create a new table in the database",
        parameters: {
          database: {
            type: "string",
            required: true,
            description: "Database connection string or identifier"
          },
          table: {
            type: "string",
            required: true,
            description: "Table name"
          },
          schema: {
            type: "object",
            required: true,
            description: "Table schema definition"
          }
        }
      },
      { 
        name: "insert_data", 
        description: "Insert data into a table",
        parameters: {
          database: {
            type: "string",
            required: true,
            description: "Database connection string or identifier"
          },
          table: {
            type: "string",
            required: true,
            description: "Table name"
          },
          data: {
            type: "object",
            required: true,
            description: "Data to insert"
          }
        }
      }
    ]
  },
  "3": { 
    id: "3", 
    name: "OpenAI MCP Server", 
    description: "Interface with OpenAI API endpoints", 
    language: "TypeScript",
    tags: ["ai", "openai", "gpt"],
    longDescription: "Access OpenAI's powerful language and image generation models through this MCP server. It provides a simplified interface for making requests to GPT models, DALL-E, and other OpenAI services.",
    author: "AI Integration Group",
    version: "2.1.3",
    lastUpdated: "2023-10-28",
    status: "Active",
    source: "https://github.com/ai-integration/openai-mcp-server",
    tools: [
      { 
        name: "chat_completion", 
        description: "Generate text completions using chat models",
        parameters: {
          model: {
            type: "string",
            required: true,
            description: "The model to use (e.g., gpt-4)"
          },
          messages: {
            type: "array",
            required: true,
            description: "Array of message objects with role and content"
          },
          temperature: {
            type: "number",
            required: false,
            description: "Sampling temperature (0-2)"
          }
        }
      },
      { 
        name: "text_completion", 
        description: "Generate text completions",
        parameters: {
          model: {
            type: "string",
            required: true,
            description: "The model to use (e.g., text-davinci-003)"
          },
          prompt: {
            type: "string",
            required: true,
            description: "The prompt to generate completions for"
          },
          max_tokens: {
            type: "number",
            required: false,
            description: "Maximum number of tokens to generate"
          }
        }
      },
      { 
        name: "image_generation", 
        description: "Generate images from text prompts",
        parameters: {
          prompt: {
            type: "string",
            required: true,
            description: "The prompt to generate images for"
          },
          size: {
            type: "string",
            required: false,
            description: "Size of the generated images (e.g., 1024x1024)"
          },
          n: {
            type: "number",
            required: false,
            description: "Number of images to generate"
          }
        }
      },
      { 
        name: "text_embedding", 
        description: "Generate embeddings for text",
        parameters: {
          model: {
            type: "string",
            required: true,
            description: "The model to use for embeddings"
          },
          input: {
            type: "string",
            required: true,
            description: "The text to generate embeddings for"
          }
        }
      },
      { 
        name: "speech_to_text", 
        description: "Convert audio to text",
        parameters: {
          file: {
            type: "string",
            required: true,
            description: "Audio file URL or base64 string"
          },
          model: {
            type: "string",
            required: true,
            description: "The model to use for transcription"
          }
        }
      }
    ]
  },
  "4": { 
    id: "4", 
    name: "Web Search MCP Server", 
    description: "Search the web with various providers", 
    language: "JavaScript",
    tags: ["search", "web", "browser"],
    longDescription: "This MCP server enables web search capabilities within your applications. It supports multiple search providers and offers features like result filtering, pagination, and advanced search syntax.",
    author: "Search Solutions LLC",
    version: "1.0.2",
    lastUpdated: "2023-11-30",
    status: "Active",
    source: "https://github.com/search-solutions/web-search-mcp",
    tools: [
      { 
        name: "search_web", 
        description: "Search the web with default provider",
        parameters: {
          query: {
            type: "string",
            required: true,
            description: "Search query"
          },
          limit: {
            type: "number",
            required: false,
            description: "Maximum number of results"
          }
        }
      },
      { 
        name: "search_news", 
        description: "Search for news articles",
        parameters: {
          query: {
            type: "string",
            required: true,
            description: "Search query"
          },
          days: {
            type: "number",
            required: false,
            description: "Maximum age of articles in days"
          }
        }
      },
      { 
        name: "search_images", 
        description: "Search for images",
        parameters: {
          query: {
            type: "string",
            required: true,
            description: "Search query"
          },
          safe_search: {
            type: "boolean",
            required: false,
            description: "Whether to enable safe search"
          }
        }
      },
      { 
        name: "get_search_results", 
        description: "Get detailed search results",
        parameters: {
          query: {
            type: "string",
            required: true,
            description: "Search query"
          },
          provider: {
            type: "string",
            required: false,
            description: "Search provider to use"
          }
        }
      },
      { 
        name: "filter_results", 
        description: "Filter search results by criteria",
        parameters: {
          results: {
            type: "array",
            required: true,
            description: "Search results to filter"
          },
          filters: {
            type: "object",
            required: true,
            description: "Filter criteria"
          }
        }
      }
    ]
  },
  "5": { 
    id: "5", 
    name: "Image Generation MCP Server", 
    description: "Generate images using AI models", 
    language: "Python",
    tags: ["image", "ai", "generation"],
    longDescription: "Generate and manipulate images using state-of-the-art AI models. This MCP server provides access to various image generation models and includes tools for image editing, style transfer, and more.",
    author: "Visual AI Collective",
    version: "0.8.7",
    lastUpdated: "2023-12-10",
    status: "Active",
    source: "https://github.com/visual-ai/image-gen-mcp",
    tools: [
      { 
        name: "generate_image", 
        description: "Generate an image from text prompt",
        parameters: {
          prompt: {
            type: "string",
            required: true,
            description: "Text description of the image to generate"
          },
          size: {
            type: "string",
            required: false,
            description: "Size of the generated image (e.g., 1024x1024)"
          },
          model: {
            type: "string",
            required: false,
            description: "AI model to use for generation"
          }
        }
      },
      { 
        name: "edit_image", 
        description: "Edit an existing image using AI",
        parameters: {
          image: {
            type: "string",
            required: true,
            description: "Base image URL or base64 string"
          },
          prompt: {
            type: "string",
            required: true,
            description: "Text instructions for editing"
          },
          mask: {
            type: "string",
            required: false,
            description: "Mask image URL or base64 string"
          }
        }
      },
      { 
        name: "style_transfer", 
        description: "Apply artistic style to an image",
        parameters: {
          image: {
            type: "string",
            required: true,
            description: "Source image URL or base64 string"
          },
          style: {
            type: "string",
            required: true,
            description: "Style reference image or style name"
          }
        }
      },
      { 
        name: "upscale_image", 
        description: "Increase resolution of an image",
        parameters: {
          image: {
            type: "string",
            required: true,
            description: "Image URL or base64 string"
          },
          scale: {
            type: "number",
            required: false,
            description: "Upscaling factor"
          }
        }
      },
      { 
        name: "remove_background", 
        description: "Remove background from an image",
        parameters: {
          image: {
            type: "string",
            required: true,
            description: "Image URL or base64 string"
          }
        }
      }
    ]
  }
};

// Mock tool execution results
export const mockToolResults = {
  // GitHub MCP Server tools
  "list_repos": {
    success: true,
    result: [
      { name: "project-alpha", description: "A demo project", stars: 45 },
      { name: "awesome-lib", description: "Utility library", stars: 128 },
      { name: "devtools", description: "Developer productivity tools", stars: 72 }
    ]
  },
  "create_issue": {
    success: true,
    result: {
      id: Math.floor(Math.random() * 1000),
      title: "Sample Issue",
      status: "open",
      created_at: new Date().toISOString()
    }
  },
  "create_pull_request": {
    success: true,
    result: {
      id: Math.floor(Math.random() * 1000),
      title: "Sample PR",
      status: "open",
      created_at: new Date().toISOString()
    }
  },
  
  // Database MCP Server tools
  "execute_query": {
    success: true,
    result: {
      rows: [
        { id: 1, name: "John Doe", email: "john@example.com" },
        { id: 2, name: "Jane Smith", email: "jane@example.com" }
      ],
      rowCount: 2,
      duration: "42ms"
    }
  },
  "list_tables": {
    success: true,
    result: ["users", "products", "orders", "categories"]
  },
  
  // OpenAI MCP Server tools
  "chat_completion": {
    success: true,
    result: {
      id: "chatcmpl-" + Math.random().toString(36).substring(2, 10),
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello! I'm an AI assistant. How can I help you today?"
          }
        }
      ]
    }
  },
  "image_generation": {
    success: true,
    result: {
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          url: "https://example.com/generated-image.png"
        }
      ]
    }
  },
  
  // Web Search MCP Server tools
  "search_web": {
    success: true,
    result: [
      { title: "Example Website", url: "https://example.com", snippet: "This is an example website..." },
      { title: "Sample Page", url: "https://sample.org", snippet: "Sample organization homepage..." }
    ]
  },
  
  // Image Generation MCP Server tools
  "generate_image": {
    success: true,
    result: {
      url: "https://example.com/ai-generated-image.png",
      width: 1024,
      height: 1024
    }
  }
};

// Default fallback for any tool not specifically mocked
export function getMockToolResult(toolName: string) {
  if (mockToolResults[toolName]) {
    return mockToolResults[toolName];
  } else {
    return {
      success: true,
      result: `Mock result for ${toolName}`,
      timestamp: new Date().toISOString()
    };
  }
} 