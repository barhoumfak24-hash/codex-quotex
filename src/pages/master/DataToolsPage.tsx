import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { db } from "@/lib/db";

export function DataToolsPage() {
  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div>
        <h1 className="font-display text-3xl">Data tools</h1>
        <p className="text-ink-500 text-sm mt-1">Developer utilities for the local demo data store.</p>
      </div>
      <Disclaimer>
        These actions only affect the in-browser localStorage mock. The real platform must run all
        destructive operations server-side under audited admin permissions.
      </Disclaimer>
      <Card>
        <CardHeader title="Reset demo data" />
        <p className="text-sm text-ink-600 mb-4">Restores all tables (agencies, customers, carriers, etc.) to the seeded state.</p>
        <button
          className="btn-outline text-rose-600"
          onClick={() => {
            if (confirm("Reset all local demo data? This cannot be undone.")) {
              db.reset();
              location.reload();
            }
          }}
        >
          Reset demo data
        </button>
      </Card>
      <Card>
        <CardHeader title="Export snapshot" />
        <button
          className="btn-outline"
          onClick={() => {
            const blob = new Blob([JSON.stringify(db.snapshot(), null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `quotex-snapshot-${new Date().toISOString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download JSON snapshot
        </button>
      </Card>
    </div>
  );
}
