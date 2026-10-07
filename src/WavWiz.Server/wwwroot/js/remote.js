import { h, api, toast } from './util.js';

export function remoteView(S) {
  const root = h('div');
  async function draw() {
    let st; try { st = await api('/remote'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const addrs = st.tailscale?.addresses || [];
    root.replaceChildren(
      h('h2', { style: 'margin:0 0 8px' }, 'Away-from-home access'),
      h('p', null, st.note),
      h('div', { class: 'card' },
        h('h3', null, 'Tailscale'),
        h('p', { class: 'small dim' }, st.tailscale?.help || ''),
        addrs.length ? h('ul', null, addrs.map(a => h('li', { class: 'mono' }, `${a.ip} (${a.interfaceName})`))) : h('p', { class: 'warnc' }, 'No Tailscale address detected on this PC yet.'),
        h('p', { class: 'small' }, `Current bind address: ${st.bindAddress}`),
        S.auth.role === 'admin' ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!st.preferTailscale, onchange: async ev => { try { await api('/remote', { method: 'PUT', body: { preferTailscale: ev.target.checked } }); toast('Saved'); draw(); } catch (e) { toast(e.message, true); } } }), 'Prefer Tailscale when suggesting an address') : null),
      h('div', { class: 'card' }, h('h3', null, 'What WavWiz will not do'),
        h('ul', { class: 'small' }, h('li', null, 'Open a port on your router / public internet'), h('li', null, 'Create a cloud relay or account'), h('li', null, 'Change firewall rules to “Any” / public profiles')),
        h('p', { class: 'small dim' }, st.firewallNote)));
  }
  draw(); return { el: root, reload: draw };
}
