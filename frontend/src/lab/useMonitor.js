import { useSyncExternalStore } from 'react';

// Subscribe a tile to the monitor's 10 Hz numeric snapshots.
export function useVitals(monitor) {
  return useSyncExternalStore(
    (cb) => monitor.subscribeNumeric(cb),
    () => monitor.getSnapshot(),
  );
}
