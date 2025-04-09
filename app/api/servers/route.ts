import { NextResponse } from "next/server";
import { servers } from "@/lib/data/servers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.toLowerCase() || "";
  const limit = parseInt(searchParams.get("limit") || "10");
  const offset = parseInt(searchParams.get("offset") || "0");

  let filteredServers = servers;

  // If query parameter is provided, filter servers
  if (query) {
    filteredServers = servers.filter(server => 
      server.name.toLowerCase().includes(query) ||
      server.description.toLowerCase().includes(query) ||
      server.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  // Apply pagination
  const paginatedServers = filteredServers.slice(offset, offset + limit);

  return NextResponse.json({
    servers: paginatedServers,
    total: filteredServers.length,
    limit,
    offset
  });
} 