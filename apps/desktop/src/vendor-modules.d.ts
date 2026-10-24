/** Injected by Vite from the installed dockview-react package. */
declare const __DOCKVIEW_VERSION__: string;

declare module "*dice-box-threejs.es.js" {
  const DiceBox: new (el: string | HTMLElement, opts?: Record<string, unknown>) => {
    initialize: () => Promise<void>;
    roll: (notation: string) => Promise<unknown>;
    add?: (notation: string) => Promise<unknown>;
    clearDice?: () => void;
    getDiceResults?: () => { notation?: string; total?: number };
    setDimensions?: (size: { x: number; y: number }) => void;
    destroy?: () => void;
  };
  export default DiceBox;
}
