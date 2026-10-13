import math, random
cx, cy, bottom = 490, 236, 556
def arch(rx, ry, cyy=cy, bot=bottom, x=cx):
    return f"M{x-rx:.1f},{bot} L{x-rx:.1f},{cyy} A{rx},{ry} 0 0 1 {x+rx:.1f},{cyy} L{x+rx:.1f},{bot}"
def archc(rx, ry, cyy=cy, bot=bottom, x=cx): return arch(rx,ry,cyy,bot,x)+" Z"
o=[]
o.append('<svg class="jbr-svg" viewBox="0 0 980 551" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">')
o.append('''<defs>
<linearGradient id="jbrRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e1210"/><stop offset="1" stop-color="#0e0808"/></linearGradient>
<linearGradient id="jbrWood" x1="0" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><stop offset="0" stop-color="#60221a"/><stop offset=".35" stop-color="#7a2e20"/><stop offset=".6" stop-color="#6a281c"/><stop offset="1" stop-color="#803422"/></linearGradient>
<linearGradient id="jbrFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#54101a"/><stop offset="1" stop-color="#28080e"/></linearGradient>
<linearGradient id="jbrTube" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff781e"/><stop offset=".1" stop-color="#e82e28"/><stop offset=".26" stop-color="#ffba3c"/><stop offset=".45" stop-color="#ff781e"/><stop offset=".6" stop-color="#ffba3c"/><stop offset=".72" stop-color="#e82e28"/><stop offset=".85" stop-color="#19c3b1"/><stop offset="1" stop-color="#19c3b1"/></linearGradient>
<linearGradient id="jbrChrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef2f6"/><stop offset=".5" stop-color="#9aa0a8"/><stop offset="1" stop-color="#eef2f6"/></linearGradient>
<linearGradient id="jbrWin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161a2c"/><stop offset="1" stop-color="#08080e"/></linearGradient>
<radialGradient id="jbrVig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<filter id="jbrGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="jbrSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<clipPath id="jbrWinClip"><path d="''' + archc(200,110,190,276) + '''"/></clipPath>
</defs>''')
o.append('<rect width="980" height="551" fill="url(#jbrRoom)"/>')
r=random.Random(9)
o.append('<g class="jbr-bokeh" filter="url(#jbrSoft)">')
for k in range(26):
    x,y,rr=r.uniform(0,980),r.uniform(0,551*.7),r.uniform(6,22); col=r.choice(['#ff963c','#ff5a3c','#19c3b1'])
    o.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rr:.0f}" fill="{col}" opacity=".16"/>')
o.append('</g>')
o.append(f'<path d="{archc(448,222)}" fill="#000" opacity=".85" filter="url(#jbrGlow)"/>')
o.append(f'<path d="{archc(448,222)}" fill="url(#jbrWood)"/>')
# tube glow + body + highlight
tube=arch(422,198)
o.append(f'<path class="jbr-tubeglow" d="{tube}" fill="none" stroke="url(#jbrTube)" stroke-width="30" opacity=".8" filter="url(#jbrGlow)"/>')
o.append(f'<path d="{tube}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="24"/>')
o.append(f'<path class="jbr-tube" d="{tube}" fill="none" stroke="url(#jbrTube)" stroke-width="18"/>')
o.append(f'<path d="{tube}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="6"/>')
o.append(f'<path class="jbr-bubbles" d="{tube}" fill="none" stroke="#fffff0" stroke-opacity=".85" stroke-width="4.2" stroke-linecap="round" stroke-dasharray="0.01 17 0.01 9 0.01 23"/>')
o.append(f'<path class="jbr-bubbles b2" d="{tube}" fill="none" stroke="#fffff0" stroke-opacity=".6" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0.01 13 0.01 31" transform="translate(0,-4)"/>')
for rx,ry,w in [(436,212,7),(408,184,7),(448,222,5)]:
    d=arch(rx,ry)
    o.append(f'<path d="{d}" fill="none" stroke="#6e747c" stroke-width="{w}"/><path d="{d}" fill="none" stroke="#c8ced6" stroke-width="{w*.6:.1f}"/><path d="{d}" fill="none" stroke="#eef2f6" stroke-width="{w*.22:.1f}"/>')
o.append(f'<path d="{archc(404,180)}" fill="url(#jbrFace)"/>')
for side in (-1,1):
    for k in range(5):
        x=cx+side*(330+k*12)
        o.append(f'<line x1="{x}" y1="{150-k*6}" x2="{x}" y2="330" stroke="#eef2f6" stroke-opacity="{.25-k*.03:.2f}" stroke-width="2.2" stroke-linecap="round"/>')
# window
o.append(f'<g clip-path="url(#jbrWinClip)"><rect x="290" y="60" width="400" height="230" fill="url(#jbrWin)"/>')
SP=['#c8cdd6','#e25a46','#5aaadc','#ebc45a','#aa78d2','#78c8a0']; r2=random.Random(5)
for k in range(46):
    th=math.radians(180+180*(k+.5)/46); x=cx+214*math.cos(th); depth=-math.sin(th); y=150+34*math.sin(th)
    w=1.4+4*abs(math.cos(th))**.5; hh=50+16*depth; col=r2.choice(SP) if k%3 else '#cdd2dc'; al=.12+.22*(1-depth)
    o.append(f'<rect x="{x-w/2:.1f}" y="{y-hh/2:.1f}" width="{w:.1f}" height="{hh:.1f}" rx=".8" fill="{col}" opacity="{al*1.6:.2f}"/>')
rail=' '.join(f'{cx+214*math.cos(math.radians(t)):.1f},{190+34*math.sin(math.radians(t)):.1f}' for t in range(180,361,3))
o.append(f'<polyline points="{rail}" fill="none" stroke="#eef2f6" stroke-opacity=".5" stroke-width="2.2"/>')
o.append(f'<path d="{arch(188,98,190,270)}" fill="none" stroke="#ff3caa" stroke-width="6" opacity=".9" filter="url(#jbrSoft)"/><path class="jbr-neon" d="{arch(188,98,190,270)}" fill="none" stroke="#ff96d7" stroke-width="2"/>')
o.append('</g>')
# bracket + rail under the disc
o.append('<polygon points="464,274 516,274 502,190 478,190" fill="#464a52"/><rect x="420" y="264" width="140" height="10" rx="2" fill="#6e747c" stroke="#eef2f6"/>')
# glass reflections (drawn over the disc by .jbr-glass)
o.append(f'<path d="{archc(200,110,190,276)}" fill="none" stroke="#6e747c" stroke-width="6"/><path d="{archc(200,110,190,276)}" fill="none" stroke="#eef2f6" stroke-width="2"/>')
# placard glow, neon line under it
o.append('<rect x="260" y="286" width="460" height="66" fill="#ffa050" opacity=".35" filter="url(#jbrGlow)"/>')
o.append('<line x1="270" y1="357" x2="710" y2="357" stroke="#3ce6ff" stroke-width="4" opacity=".9" filter="url(#jbrSoft)"/><line x1="270" y1="357" x2="710" y2="357" stroke="#9ef2ff" stroke-width="1.6"/>')
# rack frame glow
o.append('<rect x="234" y="368" width="512" height="124" fill="#ffc88c" opacity=".18" filter="url(#jbrGlow)"/>')
# grille
o.append('<rect x="228" y="508" width="524" height="60" rx="3" fill="#1e0e0e" stroke="#eef2f6" stroke-width="2"/>')
for k in range(7):
    y=518+k*7
    pts=' '.join(f'{x},{y+2.2*math.sin((x-cx)/14):.1f}' for x in range(236,745,3))
    o.append(f'<polyline points="{pts}" fill="none" stroke="{"#eef2f6" if k%2 else "#9aa0a8"}" stroke-opacity=".8" stroke-width="1.6"/>')
o.append('<text x="490" y="544" text-anchor="middle" class="jbr-grille-wm">WavWiz</text>')
# select glow
o.append('<circle cx="830" cy="432" r="56" fill="#ff5a28" opacity=".45" filter="url(#jbrGlow)"/>')
o.append('<rect width="980" height="551" fill="url(#jbrVig)" pointer-events="none"/>')
o.append('</svg>')
svg=''.join(o)
open('/workspace/wavwiz-public/src/WavWiz.Server/wwwroot/js/jukebox-retro.js','w').write(
"// WavWiz 0.3.4 H4: Retro CD cabinet artwork for the Jukebox big screen (980 x 551 design stage), traced from the approved render\n"
"// wavwiz-jukebox-retro-cd.png (wood arch cabinet, neon bubble tube, chrome trims, CD window with changer rack, speaker grille).\n"
"// Generated once from the render's geometry; the live parts (disc, placard, strips, QR, SELECT) are HTML on top. Static string, no DOM work at import.\n"
"export const RETRO_SVG = " + repr(svg).replace("\\'","'") + ";\n")
print(len(svg))
