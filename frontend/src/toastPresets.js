// Color presets for the "Toast" trigger action. Shared by TriggerRow (author-facing dropdown)
// and Chat.js (maps the fired preset key to the colors the toast renders with). The key is what
// gets stored in the trigger and broadcast by the backend — renaming one breaks saved triggers.
export const TOAST_PRESETS = [
  { key: 'midnight', label: 'Midnight (navy / ice)', bg: '#1e2a4a', fg: '#dbe7ff', border: '#3d5a9e' },
  { key: 'emerald', label: 'Emerald (green / mint)', bg: '#123c2b', fg: '#c9f7dd', border: '#2c7a56' },
  { key: 'amber', label: 'Amber (bronze / gold)', bg: '#4a3405', fg: '#ffd97a', border: '#9e7c2c' },
  { key: 'crimson', label: 'Crimson (red / blush)', bg: '#4a1214', fg: '#ffd6d8', border: '#9e3d41' },
  { key: 'violet', label: 'Violet (purple / lavender)', bg: '#32204a', fg: '#e4d4ff', border: '#6e4d9e' },
  { key: 'slate', label: 'Slate (charcoal / silver)', bg: '#2b2f36', fg: '#e6e9ee', border: '#5a626e' },
];

export function toastPresetByKey(key) {
  return TOAST_PRESETS.find(p => p.key === key) || TOAST_PRESETS[0];
}
