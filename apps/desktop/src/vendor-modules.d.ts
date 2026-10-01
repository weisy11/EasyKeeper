declare module "*dice-box-threejs.es.js" {
  const DiceBox: new (el: string | HTMLElement, opts?: Record<string, unknown>) => {
    initialize: () => Promise<void>;
    roll: (notation: string) => Promise<unknown>;
    clearDice?: () => void;
    setDimensions?: (size: unknown) => void;
    destroy?: () => void;
  };
  export default DiceBox;
}
