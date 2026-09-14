// Card condition and language vocabularies, shared by the add/review forms,
// the collection table and the CSV export.

export const CONDITIONS: Array<{ key: string; label: string }> = [
  { key: "NM", label: "Near Mint" },
  { key: "LP", label: "Lightly Played" },
  { key: "MP", label: "Moderately Played" },
  { key: "HP", label: "Heavily Played" },
  { key: "DMG", label: "Damaged" },
];

export const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "KR", "ZH"];

export function conditionLabel(key: string): string {
  return CONDITIONS.find((c) => c.key === key)?.label ?? key;
}
