// 0.7.0 item 5c: release tests compare versions instead of pinning one string, so every release does not break the older tests.
import { readFileSync } from 'node:fs';
/** The version in about.js's WHATS_NEW_VERSION (source text). */
export const whatsNewVersion = src => (String(src).match(/WHATS_NEW_VERSION = '(\d+\.\d+\.\d+)'/) || [])[1] || '';
/** a >= b for x.y.z versions. */
export function vge(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
}
/** THE version (Directory.Build.props). */
export const buildVersion = () => (readFileSync(new URL('../../Directory.Build.props', import.meta.url), 'utf8').match(/<WavWizVersion>([^<]+)</) || [])[1];
