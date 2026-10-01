declare module "../../vendor/dice-box-threejs/dist/dice-box-threejs.es.js" {
  const DiceBox: new (el: string | HTMLElement, opts?: Record<string, unknown>) => {
    initialize: () => Promise<void>;
    roll: (notation: string) => Promise<unknown>;
    clearDice?: () => void;
    setDimensions?: (size: { x: number; y: number }) => void;
    destroy?: () => void;
  };
  export default DiceBox;
}

declare module "*dice-box-threejs.es.js" {
  const DiceBox: new (el: string | HTMLElement, opts?: Record<string, unknown>) => {
    initialize: () => Promise<void>;
    roll: (notation: string) => Promise<unknown>;
    clearDice?: () => void;
    setDimensions?: (size: { x: number; y: number }) => void;
    destroy?: () => void;
  };
  export default DiceBox;
}
