import { CheckCircle, FileText, Table, Image as ImageIcon, Heading } from "lucide-react";
import { GenericStep } from "./GenericStep";

interface PartitioningStepProps {
  status: "completed" | "processing" | "failed" | "pending";
  // FIX: Allow any string key, not just specific hardcoded ones
  elementsFound?: Record<string, number>;
}

export function PartitioningStep({
  status,
  elementsFound,
}: PartitioningStepProps) {
  if (!elementsFound || status !== "completed") {
    return (
      <GenericStep
        stepName="Partitioning"
        description="Processing and extracting text, images, and tables"
        status={status}
      />
    );
  }

  // Helper to pick a nice icon based on the category name
  const getIcon = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes("image") || k.includes("figure")) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (k.includes("table")) return <Table className="w-4 h-4 text-green-400" />;
    if (k.includes("title") || k.includes("header")) return <Heading className="w-4 h-4 text-yellow-400" />;
    return <FileText className="w-4 h-4 text-blue-400" />;
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto text-center">
        <h3 className="text-xl font-medium text-gray-100 mb-2">Partitioning</h3>
        <p className="text-gray-400 mb-6">
          Processing and extracting text, images, and tables
        </p>

        <div className="mb-6 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <h4 className="font-medium text-blue-300 mb-3 flex items-center justify-center gap-2">
            📊 Elements Discovered
          </h4>
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(elementsFound)
              .filter(([_, value]) => value > 0) // Hide zero counts
              .map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between bg-[#2a2a2a] rounded px-3 py-2 border border-gray-600"
                >
                  <div className="flex items-center gap-2">
                    {/* Icon based on type */}
                    {getIcon(key)}
                    {/* FIX: Just display the key directly (e.g. "NarrativeText") */}
                    <span className="text-gray-300 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()} 
                    </span>
                  </div>
                  <span className="font-medium text-gray-100">{value}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-green-300 font-medium">
              Step completed successfully
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}