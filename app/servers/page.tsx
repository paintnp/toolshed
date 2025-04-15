import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { ServersPageActions } from "@/components/ServersPageActions";

// This function will fetch data from our API route
async function getServers() {
  try {
    // Use the absolute URL with the correct port
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3091' 
        : '';
    
    console.log(`Fetching servers from ${origin}/api/servers`);
    
    const res = await fetch(`${origin}/api/servers?t=${Date.now()}`, { 
      // Disable caching temporarily
      next: { revalidate: 0 },
      cache: 'no-store'
    });
    
    if (!res.ok) {
      console.error(`Server response not OK: ${res.status} ${res.statusText}`);
      throw new Error(`Failed to fetch servers: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    console.log(`Successfully fetched ${data.servers?.length || 0} servers`);
    return data;
  } catch (error) {
    console.error('Error fetching servers:', error);
    // Return empty servers array as fallback
    return { servers: [], total: 0, error: error.message || "Unknown fetch error" };
  }
}

export default async function ServersPage() {
  const { servers, error } = await getServers();
  
  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-900">
      <Navigation />
      <main className="flex-1 container mx-auto p-6">
        <ServersPageActions />
        
        {error && (
          <div className="mb-6 p-4 border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-md">
            <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Error Loading Servers</h2>
            <p className="text-red-600 dark:text-red-300">{error}</p>
            <p className="mt-2 text-gray-700 dark:text-gray-300">
              Please make sure your DynamoDB table is set up properly and AWS credentials are configured.
              You can continue using other parts of the application.
            </p>
          </div>
        )}
        
        {!servers || servers.length === 0 ? (
          <div className="text-center p-12 bg-white dark:bg-slate-800 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-2">No Servers Found</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {error ? 
                "Unable to load servers due to an error." : 
                "There are no servers in the database yet."
              }
            </p>
            <Link 
              href="/servers/add" 
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Your First Server
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((server: any) => (
              <Link 
                href={`/servers/${encodeURIComponent(server.ServerId)}`} 
                key={server.ServerId}
                className="block hover:scale-[1.02] transition-transform"
              >
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 h-full border border-transparent hover:border-primary">
                  <h2 className="text-xl font-semibold mb-2">{server.name}</h2>
                  <p className="text-gray-600 dark:text-gray-300 mb-3">{server.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                      {server.language || 'Unknown'}
                    </span>
                    <div className="flex gap-1">
                      {server.topics && server.topics.slice(0, 2).map((tag: string) => (
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
        )}
      </main>
    </div>
  );
} 