# applied by build-receivers.sh to librespot discovery/src/lib.rs (MIT): an mDNS responder failure no longer stops librespot;
# the zeroconf HTTP endpoint keeps running and wavwiz-server advertises the device with its own mDNS responder instead.
import sys
p = sys.argv[1]; s = open(p).read()
old = """        match Pin::new(&mut self.event_rx).poll_recv(cx) {
            // Yields credentials
            Poll::Ready(Some(DiscoveryEvent::Credentials(creds))) => Poll::Ready(Some(creds)),
            // Also terminate the stream on fatal server or MDNS/DNS-SD errors.
            Poll::Ready(Some(
                DiscoveryEvent::ServerError(_) | DiscoveryEvent::ZeroconfError(_),
            )) => Poll::Ready(None),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }"""
new = """        loop {
            match Pin::new(&mut self.event_rx).poll_recv(cx) {
                // Yields credentials
                Poll::Ready(Some(DiscoveryEvent::Credentials(creds))) => return Poll::Ready(Some(creds)),
                // WavWiz patch: an mDNS responder error is not fatal (the host advertises instead)
                Poll::Ready(Some(DiscoveryEvent::ZeroconfError(_))) => continue,
                Poll::Ready(Some(DiscoveryEvent::ServerError(_))) => return Poll::Ready(None),
                Poll::Ready(None) => return Poll::Ready(None),
                Poll::Pending => return Poll::Pending,
            }
        }"""
if new not in s:
    assert old in s
    open(p, 'w').write(s.replace(old, new))
