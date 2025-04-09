import { NextResponse } from "next/server";
import { getServer } from "@/lib/db/dynamodb";

export async function POST(request: Request, context: { params: { id: string } }) {
  const id = context.params.id;

  try {
    // Get server from DynamoDB
    const server = await getServer(id);
    
    if (!server) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404 }
      );
    }

    // Parse the request body
    const body = await request.json();
    const { tool, parameters } = body;

    // Validate required fields
    if (!tool) {
      return NextResponse.json(
        { success: false, error: "Tool name is required" },
        { status: 400 }
      );
    }

    // Check if server has tools
    if (!server.tools || server.tools.length === 0) {
      return NextResponse.json(
        { success: false, error: "This server has no available tools" },
        { status: 400 }
      );
    }

    // Validate that the tool exists for this server
    const toolExists = server.tools.some((t) => t.name === tool);
    if (!toolExists) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Tool '${tool}' not found for server '${server.name}'` 
        },
        { status: 400 }
      );
    }

    // Get the tool definition
    const toolDefinition = server.tools.find((t) => t.name === tool);
    
    // Validate parameters (basic validation)
    if (toolDefinition && toolDefinition.parameters) {
      const missingParams = Object.entries(toolDefinition.parameters)
        .filter(([_, param]: [string, any]) => param.required)
        .filter(([paramName]: [string, any]) => 
          !parameters || !parameters.hasOwnProperty(paramName)
        )
        .map(([paramName]: [string, any]) => paramName);
        
      if (missingParams.length > 0) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Missing required parameters: ${missingParams.join(', ')}` 
          },
          { status: 400 }
        );
      }
    }

    // This is a mock implementation - in a real app we would actually call the MCP server
    // Add artificial delay to simulate processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Mock result based on the tool name
    let result;
    if (tool.includes("search")) {
      result = { 
        results: ["Result 1", "Result 2", "Result 3"],
        query: parameters.query || "default query"
      };
    } else if (tool.includes("analyze") || tool.includes("analysis")) {
      result = { 
        success: true, 
        analysis: "This is a mock analysis result",
        details: { score: 0.85, confidence: "high" }
      };
    } else {
      result = { 
        success: true, 
        message: `Successfully executed ${tool}`,
        timestamp: new Date().toISOString()
      };
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error("Error executing tool:", error);
    return NextResponse.json(
      { success: false, error: "Invalid request format" },
      { status: 400 }
    );
  }
} 