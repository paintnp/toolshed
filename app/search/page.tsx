"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export default function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";
  
  const [isLoading, setIsLoading] = useState(true);
  const [servers, setServers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchServers() {
      setIsLoading(true);
      setError("");
      
      try {
        const params = new URLSearchParams();
        if (query) {
          params.append("query", query);
        }
        
        const response = await fetch(`/api/servers?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch servers");
        }
        
        const data = await response.json();
        setServers(data.servers);
      } catch (err) {
        console.error("Error fetching servers:", err);
        setError("Failed to load servers. Please try again.");
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchServers();
  }, [query]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-2">Search Results</h1>
        {query && (
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
            Results for &quot;{query}&quot;
          </p>
        )}

        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 text-center">
            <p className="text-red-500 dark:text-red-400 font-medium mb-2">
              {error}
            </p>
            <p className="text-gray-500">
              Try refreshing the page or modifying your search.
            </p>
          </div>
        ) : servers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map(server => (
              <Link 
                href={`/servers/${server.id}`} 
                key={server.id}
                className="block hover:scale-[1.02] transition-transform"
              >
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 h-full border border-transparent hover:border-primary">
                  <h2 className="text-xl font-semibold mb-2">{server.name}</h2>
                  <p className="text-gray-600 dark:text-gray-300 mb-3">{server.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                      {server.language}
                    </span>
                    <div className="flex gap-1">
                      {server.tags.slice(0, 2).map(tag => (
                        <span 
                          key={tag} 
                          className="inline-flex items-center rounded-md bg-gray-50 dark:bg-gray-700 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 text-center">
            <p className="text-lg text-gray-600 dark:text-gray-300">
              No servers found for &quot;{query}&quot;
            </p>
            <p className="mt-2 text-gray-500">
              Try searching with different keywords or {" "}
              <Link href="/servers" className="text-blue-600 dark:text-blue-400 hover:underline">
                browse all available servers
              </Link>
            </p>
          </div>
        )}
      </main>
    </div>
  );
} 