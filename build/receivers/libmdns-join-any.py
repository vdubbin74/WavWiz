# applied by build-receivers.sh
import sys
p=sys.argv[1]
s=open(p).read()
old='            // TODO: If any join succeeds return success (log failures)\n            for ip in addrs {\n                socket.join_multicast_v4(multiaddr, &ip)?;\n            }\n            Ok(())'
new='            // WavWiz patch: succeed if any interface joins (VPN / virtual adapters may refuse multicast)\n            let mut last = None;\n            let mut any = false;\n            for ip in addrs {\n                match socket.join_multicast_v4(multiaddr, &ip) {\n                    Ok(()) => any = true,\n                    Err(e) => last = Some(e),\n                }\n            }\n            if any { Ok(()) } else { match last { Some(e) => Err(e), None => Ok(()) } }'
if new not in s:
    assert old in s
    open(p,'w').write(s.replace(old,new))
