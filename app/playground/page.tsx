"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Playground() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const serverId = searchParams.get("server");
  
  const [selectedServer, setSelectedServer] = useState<any>(null);
  const [allServers, setAllServers] = useState<any[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [parameters, setParameters] = useState<string>("");
  const [results, setResults] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingServers, setIsLoadingServers] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [jsonError, setJsonError] = useState<string>("");

  // Fetch all servers
  useEffect(() => {
    async function fetchServers() {
      try {
        const response = await fetch("/api/servers");
        if (!response.ok) {
          throw new Error("Failed to fetch servers");
        }
        
        const data = await response.json();
        setAllServers(data.servers);
      } catch (error) {
        console.error("Error fetching servers:", error);
        setError("Failed to load servers. Please try again.");
      } finally {
        setIsLoadingServers(false);
      }
    }
    
    fetchServers();
  }, []);
  
  // Load the server data when serverId changes
  useEffect(() => {
    if (serverId) {
      setIsLoading(true);
      setError("");
      
      async function fetchServerDetails() {
        try {
          // Ensure server ID is properly URL encoded
          const encodedServerId = encodeURIComponent(serverId);
          const response = await fetch(`/api/servers/${encodedServerId}`);
          
          if (!response.ok) {
            if (response.status === 404) {
              setError(`Server with ID ${serverId} not found.`);
              return;
            }
            throw new Error("Failed to fetch server details");
          }
          
          const server = await response.json();
          setSelectedServer(server);
          
          // Default to the first tool if available
          if (server.tools && server.tools.length > 0) {
            setSelectedTool(server.tools[0].name);
            // Generate default parameter template
            try {
              const toolParams = server.tools[0].parameters || {};
              const defaultParams = Object.keys(toolParams).reduce((acc, key) => {
                acc[key] = toolParams[key].required ? "" : undefined;
                return acc;
              }, {});
              
              setParameters(JSON.stringify(defaultParams, null, 2));
            } catch (e) {
              setParameters("{}");
            }
          }
        } catch (error) {
          console.error("Error fetching server details:", error);
          setError("Failed to load server details. Please try again.");
        } finally {
          setIsLoading(false);
        }
      }
      
      fetchServerDetails();
    }
  }, [serverId]);

  const handleServerChange = (serverId: string) => {
    // Update the URL to include the selected server
    router.push(`/playground?server=${encodeURIComponent(serverId)}`);
  };

  const handleToolChange = (toolName: string) => {
    setSelectedTool(toolName);
    setResults(""); // Clear results when changing tools
    setJsonError(""); // Clear any JSON validation errors
    
    // Generate parameter template for the selected tool
    if (selectedServer && selectedServer.tools) {
      const toolDef = selectedServer.tools.find((t: any) => t.name === toolName);
      if (toolDef && toolDef.parameters) {
        const defaultParams = Object.keys(toolDef.parameters).reduce((acc, key) => {
          acc[key] = toolDef.parameters[key].required ? "" : undefined;
          return acc;
        }, {});
        
        setParameters(JSON.stringify(defaultParams, null, 2));
      } else {
        setParameters("{}");
      }
    }
  };

  const validateParameters = (): boolean => {
    if (!parameters.trim()) {
      setJsonError("Parameters cannot be empty");
      return false;
    }

    try {
      JSON.parse(parameters);
      setJsonError("");
      return true;
    } catch (error) {
      setJsonError("Invalid JSON format. Please check your input.");
      return false;
    }
  };

  const handleRunTool = async () => {
    if (!validateParameters() || !selectedServer) return;
    
    // Check if server has tools
    if (!selectedServer.tools || !selectedTool) {
      setError("No tools available for this server");
      return;
    }
    
    setIsLoading(true);
    setError("");
    setResults("");

    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(selectedServer.ServerId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: selectedTool,
          parameters: JSON.parse(parameters)
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute tool');
      }
      
      const result = await response.json();
      setResults(JSON.stringify(result, null, 2));
    } catch (error: any) {
      setError(error.message || "An unexpected error occurred");
      setResults("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Playground</h1>
        
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {isLoadingServers ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
          </div>
        ) : !selectedServer ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8">
            <h2 className="text-xl font-medium mb-4">
              {serverId 
                ? "Server not found. Select a server from the list below." 
                : "Select a server to explore its tools"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {allServers.map((server: any) => (
                <button 
                  key={server.ServerId} 
                  onClick={() => handleServerChange(server.ServerId)}
                  className="text-left"
                >
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                    <h3 className="font-semibold mb-2">{server.name}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{server.description}</p>
                    <div className="mt-3 text-xs text-gray-500">
                      {server.tools ? server.tools.length : 0} tools available
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Tools Sidebar */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
              <div className="mb-4">
                <h2 className="text-xl font-bold">{selectedServer.name}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">{selectedServer.description}</p>
              </div>
              
              <div className="mt-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Available Tools</h3>
                <ul className="space-y-1">
                  {selectedServer.tools && selectedServer.tools.length > 0 ? (
                    selectedServer.tools.map((tool: any) => (
                      <li key={tool.name}>
                        <button
                          onClick={() => handleToolChange(tool.name)}
                          className={`w-full text-left px-3 py-2 rounded text-sm ${
                            selectedTool === tool.name 
                              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-medium" 
                              : "hover:bg-gray-100 dark:hover:bg-gray-700/50"
                          }`}
                        >
                          {tool.name}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li>
                      <div className="px-3 py-2 text-sm text-gray-500">
                        No tools available
                      </div>
                    </li>
                  )}
                </ul>
              </div>
              
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Link href={`/servers/${encodeURIComponent(selectedServer.ServerId)}`}>
                  <Button variant="outline" size="sm" className="w-full">
                    View Server Details
                  </Button>
                </Link>
              </div>
            </div>
            
            {/* Main Playground Area */}
            <div className="md:col-span-3 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
              {selectedTool && selectedServer.tools ? (
                <>
                  <div className="mb-6">
                    <h2 className="text-xl font-bold mb-2">
                      {selectedTool}
                    </h2>
                    <p className="text-gray-600 dark:text-gray-300">
                      {selectedServer.tools.find((t: any) => t.name === selectedTool)?.description}
                    </p>
                  </div>
                  
                  <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium">
                        Parameters (JSON format)
                      </label>
                      {jsonError && (
                        <span className="text-sm text-red-500">
                          {jsonError}
                        </span>
                      )}
                    </div>
                    <Textarea
                      placeholder='{"param1": "value1", "param2": "value2"}'
                      className="font-mono text-sm h-32"
                      value={parameters}
                      onChange={(e) => {
                        setParameters(e.target.value);
                        if (jsonError) validateParameters(); // Re-validate on change if there was an error
                      }}
                    />
                  </div>
                  
                  <div className="mb-6">
                    <Button 
                      onClick={handleRunTool}
                      disabled={isLoading}
                      className="w-32"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Running...
                        </>
                      ) : (
                        "Run Tool"
                      )}
                    </Button>
                  </div>
                  
                  {results && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Results
                      </label>
                      <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-4 overflow-auto max-h-80">
                        <pre className="font-mono text-sm whitespace-pre-wrap">{results}</pre>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">
                    {!selectedServer.tools || selectedServer.tools.length === 0 
                      ? "This server has no available tools."
                      : "Select a tool from the sidebar to begin"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
} 