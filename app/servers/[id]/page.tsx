import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";

// Fetch server details from API
async function getServerDetails(id: string) {
  try {
    // Use the absolute URL with the correct port
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3091' 
        : '';
    
    console.log(`Fetching server details for ${id} from ${origin}/api/servers/${encodeURIComponent(id)}`);
    
    // Fix: Properly encode the ID in the URL path
    const encodedId = encodeURIComponent(id);
    const res = await fetch(`${origin}/api/servers/${encodedId}`, { 
      // Cache for 1 hour
      next: { revalidate: 3600 }
    });
    
    if (!res.ok) {
      if (res.status === 404) {
        return { notFound: true }; // Server not found
      }
      throw new Error(`Failed to fetch server details: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    return data;
  } catch (error) {
    console.error(`Error fetching server details for ${id}:`, error);
    return { error: error.message };
  }
}

export default async function ServerDetail({ params }: { params: { id: string } }) {
  // Fix: Await the params object before accessing its properties
  const paramsObject = await params;
  const serverId = decodeURIComponent(paramsObject.id);
  const response = await getServerDetails(serverId);
  
  // Handle not found case
  if (response?.notFound) {
    notFound();
  }
  
  // Handle error case
  if (response?.error) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
        <Navigation />
        <main className="flex-1 container mx-auto p-6">
          <div className="mb-6">
            <Link href="/servers" className="text-blue-600 dark:text-blue-400 hover:underline">
              ← Back to servers
            </Link>
          </div>
          
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8">
            <div className="p-6 max-w-2xl mx-auto text-center">
              <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">Error Loading Server</h1>
              <p className="text-gray-600 dark:text-gray-300 mb-6">{response.error}</p>
              <p className="mb-6">There was a problem fetching the details for this server. This could be due to network issues or database configuration.</p>
              <div className="flex justify-center gap-4">
                <Button onClick={() => window.location.reload()}>
                  Try Again
                </Button>
                <Link href="/servers">
                  <Button variant="outline">
                    Back to Servers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const server = response;

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <div className="mb-6">
          <Link href="/servers" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to servers
          </Link>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">{server.name}</h1>
            <p className="text-gray-600 dark:text-gray-300 text-lg">{server.description}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
              <h3 className="font-medium text-gray-500 dark:text-gray-400 mb-2">Language</h3>
              <p className="font-semibold">{server.language || 'Unknown'}</p>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
              <h3 className="font-medium text-gray-500 dark:text-gray-400 mb-2">Version</h3>
              <p className="font-semibold">{server.version || 'N/A'}</p>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
              <h3 className="font-medium text-gray-500 dark:text-gray-400 mb-2">Last Updated</h3>
              <p className="font-semibold">{server.lastUpdated ? new Date(server.lastUpdated).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
              <h3 className="font-medium text-gray-500 dark:text-gray-400 mb-2">Status</h3>
              <p className="font-semibold">{server.status || 'Unknown'}</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold mb-3">Description</h2>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              {server.longDescription || server.description || 'No detailed description available.'}
            </p>
          </div>

          {server.tools && server.tools.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-3">Available Tools</h2>
              <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-4">
                <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                  {server.tools.map((tool: any) => (
                    <li key={tool.name} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-col sm:flex-row sm:justify-between">
                        <h4 className="font-mono text-md font-semibold text-blue-600 dark:text-blue-400 mb-1 sm:mb-0">
                          {tool.name}
                        </h4>
                        <p className="text-gray-600 dark:text-gray-300">
                          {tool.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {server.topics && server.topics.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-3">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {server.topics.map((tag: string) => (
                  <span 
                    key={tag} 
                    className="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1 text-sm font-medium text-gray-800 dark:text-gray-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
              <div className="flex flex-col gap-1">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Author:</span> {server.author || 'Unknown'}
                </div>
                {server.url && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Source:</span>{" "}
                    <a 
                      href={server.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      GitHub Repository
                    </a>
                  </div>
                )}
                {server.verified && (
                  <div className="flex items-center gap-2">
                    <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs px-2 py-1 rounded">
                      Verified
                    </span>
                    {server.lastVerifiedSha && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        SHA: {server.lastVerifiedSha.substring(0, 7)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                {server.verified && server.imageUri && (
                  <Link href={`/playground?serverId=${encodeURIComponent(server.ServerId)}`}>
                    <Button className="w-full md:w-auto">Try in Playground</Button>
                  </Link>
                )}
                <Button variant="outline" className="w-full md:w-auto">View Documentation</Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 