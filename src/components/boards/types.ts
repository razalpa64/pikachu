export interface BoardProps<S> {
  state: S;
  youSlot: 0 | 1;
  onMove: (move: any) => void;
  interactive: boolean;
  names: [string, string];
  hint?: boolean;
}
