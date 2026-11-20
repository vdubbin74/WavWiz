import { h, api, toast } from './util.js';

export function remoteView(S, { heading = true, onState } = {}) {
  const root = h('div');
  async function draw() {
    let st; try { st = await api('/remote'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); onState?.(null); return; }
    const addrs = st.tailscale?.addresses || [];
    onState?.(st);   // 0.7.1 t2073: the Away-from-home panel header shows the Tailscale state and picks its first open/closed state from it
    root.replaceChildren(
      heading ? h('h2', { style: 'margin:0 0 8px' }, 'Away-from-home access') : null,
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

export const AWAY_KEY = 'wavwiz.awayOpen.v1';
/** 0.7.1 t2073: Settings > Network > Away-from-home access is a collapsible panel. Its full-width header IS the old
 *  "Away-from-home access (Tailscale)" button (that one only scrolled to the section right below it). Closed by default when this PC has no
 *  Tailscale address, open when it has one; a click is remembered (AWAY_KEY). A deep link (Settings > remote) or a search hit opens it (el._reveal). */
export function awayPanel(S, { store = globalThis.localStorage, view = remoteView, onLoad } = {}) {
  let open = false, touched = false;
  const saved = () => { try { const v = store?.getItem(AWAY_KEY); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } };
  const body = h('div', { class: 'awaybody', id: 'sec-away-body', role: 'region', 'aria-label': 'Away-from-home access' });
  const pill = h('span', { class: 'pill awaypill' }, 'Checking…');
  const head = h('button', { type: 'button', class: 'awayhead', 'aria-expanded': 'false', 'aria-controls': 'sec-away-body', onclick: () => set(!open, true) },
    h('span', { class: 'awt' }, 'Away-from-home access (Tailscale)'), pill, h('span', { class: 'awchev', 'aria-hidden': 'true' }));
  const el = h('div', { class: 'card setpage awayfold', id: 'sec-away', 'data-fold': '' }, head, body);
  function set(v, remember) {
    open = !!v; head.setAttribute('aria-expanded', String(open)); body.hidden = !open; el.classList.toggle('open', open);
    if (remember) { touched = true; try { store?.setItem(AWAY_KEY, open ? '1' : '0'); } catch { /* private mode */ } }
  }
  const rv = view(S, { heading: false, onState: st => {
    const a = st?.tailscale?.addresses || [];
    pill.textContent = !st ? 'Unavailable' : a.length ? `Tailscale ${a[0].ip}` : 'Not set up';
    pill.className = 'pill awaypill ' + (a.length ? 'ok' : 'idle');
    if (!touched && saved() == null) set(a.length > 0, false);
    if (onLoad) setTimeout(onLoad, 0);   // after the view painted: Settings search re-indexes, so its text (Prefer Tailscale...) can be found
  } });
  body.append(rv.el);
  set(saved() ?? false, false);
  el._reveal = () => set(true, false);
  return { el, head, body, set, isOpen: () => open, reload: rv.reload };
}
