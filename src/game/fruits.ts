export interface FruitDef {
  emoji: string;
  name: string;
  color: string;
  light: string;
}

export const FRUITS: FruitDef[] = [
  { emoji: '🍎', name: 'Apple', color: '#ff4d5e', light: '#ffd3d8' },
  { emoji: '🍊', name: 'Orange', color: '#ff9f1c', light: '#ffe2bd' },
  { emoji: '🍋', name: 'Lemon', color: '#f5c400', light: '#fff3b8' },
  { emoji: '🥝', name: 'Kiwi', color: '#4cbb2c', light: '#d8f3cc' },
  { emoji: '🫐', name: 'Blueberry', color: '#4d7cff', light: '#d6e1ff' },
  { emoji: '🍇', name: 'Grape', color: '#a05cff', light: '#e9d9ff' },
];

export const RAINBOW = FRUITS.map((f) => f.color);
