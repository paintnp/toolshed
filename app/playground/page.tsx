"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Navigation } from "@/components/Navigation";
import { Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

function PlaygroundContent() {
  const searchParams = useSearchParams();
  const serverIdParam = searchParams.get('serverId');
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{type: 'input' | 'output', content: any}>>([]);
  const [serverInfo, setServerInfo] = useState<{
    name: string;
    id: string;
    tools: Array<{name: string, description: string}>
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch server details if provided in URL
  useEffect(() => {
    if (serverIdParam) {
      fetchServerDetails(serverIdParam);
    }
  }, [serverIdParam]);

  // Scroll to bottom when history updates
  useEffect(() => {
    scrollToBottom();
  }, [history]);

  // Function to fetch server details
  async function fetchServerDetails(serverId: string) {
    try {
      setLoading(true);
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch server');
      }
      const data = await response.json();
      
      if (data) {
        setServerInfo({
          name: data.name || data.fullName || 'Unknown Server',
          id: data.ServerId,
          tools: data.tools || []
        });
        
        // Add welcome message
        setHistory([{
          type: 'output',
          content: `Connected to ${data.name || data.fullName || 'server'}. ${data.tools?.length || 0} tools available.`
        }]);
      }
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to connect to server",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // Execute command
  async function executeCommand(e: React.FormEvent) {
    e.preventDefault();
    
    if (!input.trim() || !serverInfo) return;
    
    const command = input.trim();
    setInput('');
    
    // Add command to history
    setHistory(prev => [...prev, { type: 'input', content: command }]);
    
    try {
      setLoading(true);
      
      const response = await fetch(`/api/servers/${encodeURIComponent(serverInfo.id)}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });
      
      if (!response.ok) {
        throw new Error('Command execution failed');
      }
      
      const result = await response.json();
      
      // Add response to history
      setHistory(prev => [...prev, { 
        type: 'output', 
        content: result.output || 'Command executed successfully with no output.'
      }]);
    } catch (error) {
      setHistory(prev => [...prev, { 
        type: 'output', 
        content: 'Error: Failed to execute command. The server may be unavailable.'
      }]);
    } finally {
      setLoading(false);
    }
  }

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6 flex items-center">
          <Terminal className="mr-2" />
          MCP Server Playground
          {serverInfo && (
            <span className="ml-3 text-xl font-normal text-gray-500 dark:text-gray-400">
              - {serverInfo.name}
            </span>
          )}
        </h1>
        
        <Card className="mb-6">
          <CardContent className="p-4">
            <p className="text-gray-600 dark:text-gray-300">
              This playground allows you to interact with MCP servers directly. 
              {!serverInfo && " Connect to a server to get started."}
            </p>
            
            {serverInfo && serverInfo.tools.length > 0 && (
              <div className="mt-4">
                <h2 className="text-lg font-semibold mb-2">Available Tools:</h2>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.tools.map((tool: any) => (
                    <div 
                      key={tool.name} 
                      className="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded text-sm"
                      title={tool.description || ""}
                    >
                      {tool.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 h-[400px] mb-6 flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 font-mono text-sm">
            {history.length === 0 && !serverInfo && (
              <div className="text-gray-500 dark:text-gray-400 italic p-4 text-center">
                Connect to a server to start interacting
              </div>
            )}
            
            {history.map((item, index) => (
              <div key={index} className={`mb-2 ${item.type === 'input' ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                {item.type === 'input' ? '> ' : ''}
                {typeof item.content === 'string' 
                  ? item.content.split('\n').map((line, i) => <div key={i}>{line}</div>)
                  : JSON.stringify(item.content, null, 2)
                }
              </div>
            ))}
            
            {loading && (
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        <form onSubmit={executeCommand} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={serverInfo ? "Enter a command..." : "Connect to a server first"}
            disabled={!serverInfo || loading}
            className="font-mono"
          />
          <Button 
            type="submit" 
            disabled={!serverInfo || loading || !input.trim()}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Execute
          </Button>
        </form>
      </main>
    </div>
  );
}

export default function Playground() {
  return (
    <Suspense fallback={
      <div className="flex flex-col min-h-screen">
        <Navigation />
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
        </div>
      </div>
    }>
      <PlaygroundContent />
    </Suspense>
  );
} 