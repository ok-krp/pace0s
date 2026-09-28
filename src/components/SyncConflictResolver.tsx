import { useEffect } from "react";
import { useCloudSyncStatus } from "@/hooks/use-cloud-sync-engine";

/**
 * Sync conflicts are resolved automatically instead of interrupting the user.
 * The previous modal/popup forced a manual choice and could leave a queued
 * mutation blocked indefinitely. The sync engine's merge strategy preserves
 * both object/array values where possible.
 */
export function SyncConflictResolver() {
  const { conflicts, resolveConflict } = useCloudSyncStatus();

  useEffect(() => {
    if (!conflicts.length) return;
    for (const conflict of conflicts) {
      void resolveConflict(conflict.id, "merge");
    }
  }, [conflicts, resolveConflict]);

  return null;
}
