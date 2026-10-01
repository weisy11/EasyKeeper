/** Module-level dice runtime bookkeeping (cleared on tool dispose). */

type Disposable = { destroy?: () => void; clearDice?: () => void };

const boxes = new Set<Disposable>();
let heavyLoaded = false;

export function markDiceHeavyLoaded() {
  heavyLoaded = true;
}

export function wasDiceHeavyLoaded() {
  return heavyLoaded;
}

export function registerDiceBox(box: Disposable) {
  boxes.add(box);
}

export function unregisterDiceBox(box: Disposable) {
  boxes.delete(box);
}

export function disposeDiceRuntime() {
  for (const box of [...boxes]) {
    try {
      const anyBox = box as {
        clearDice?: () => void;
        destroy?: () => void;
        running?: boolean;
        threadid?: number;
        renderer?: { dispose?: () => void; forceContextLoss?: () => void; domElement?: HTMLElement };
      };
      anyBox.running = false;
      if (typeof anyBox.threadid === "number") cancelAnimationFrame(anyBox.threadid);
      anyBox.clearDice?.();
      anyBox.renderer?.dispose?.();
      anyBox.renderer?.forceContextLoss?.();
      anyBox.renderer?.domElement?.remove?.();
      anyBox.destroy?.();
    } catch {
      /* ignore */
    }
  }
  boxes.clear();
  // Keep heavyLoaded=true so host can reload window after dispose to drop module cache.
}
