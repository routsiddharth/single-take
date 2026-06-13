/**
 * Built-in offline generator. When no ANTHROPIC_API_KEY is set, single take still
 * needs to produce a REAL, self-contained, immutable HTML artifact so the whole
 * loop — building → live → permalink → vote → comment — works end to end.
 *
 * This emits a deterministic generative-art toy seeded by the prompt: a field
 * of orbiting particles over the prompt text, with a palette derived from a
 * hash of the prompt. It is fully self-contained (inline CSS+JS, no network),
 * so it passes the same scan + CSP the real artifacts do.
 */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES = [
  ["#0A0A14", "#FF2D00", "#FFE600", "#F3EFE5"],
  ["#101622", "#3DDC4E", "#FFFFFF", "#A0C8FF"],
  ["#1a0b2e", "#e94560", "#f9c80e", "#f5f5f5"],
  ["#0d1b2a", "#e0fbfc", "#3d5a80", "#ee6c4d"],
  ["#2b2118", "#ffba08", "#d00000", "#faf3dd"],
  ["#011627", "#2ec4b6", "#e71d36", "#fdfffc"],
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function stubArtifact(prompt: string): string {
  const seed = hash(prompt);
  const pal = PALETTES[seed % PALETTES.length];
  const [bg, a, b, fg] = pal;
  const count = 80 + (seed % 120);
  const safe = esc(prompt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe.slice(0, 60)}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:${bg};font-family:Georgia,'Times New Roman',serif;}
  canvas{display:block;position:fixed;inset:0;}
  .caption{position:fixed;left:0;right:0;bottom:0;padding:28px 32px;color:${fg};
    font-style:italic;font-size:clamp(18px,3.4vw,34px);line-height:1.25;
    text-shadow:0 2px 20px ${bg};pointer-events:none;max-width:900px;}
  .caption .q{color:${a};font-style:normal;}
  .tag{position:fixed;top:18px;left:20px;color:${b};font-family:ui-monospace,Menlo,monospace;
    font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.8;}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="tag">single take · one shot · rendered offline</div>
<p class="caption"><span class="q">&ldquo;</span>${safe}<span class="q">&rdquo;</span></p>
<script>
(function(){
  var cv=document.getElementById('c'),x=cv.getContext('2d');
  var S=${seed},N=${count};
  function rnd(){S=(S*1103515245+12345)&0x7fffffff;return S/0x7fffffff;}
  function fit(){cv.width=innerWidth*devicePixelRatio;cv.height=innerHeight*devicePixelRatio;x.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);}
  addEventListener('resize',fit);fit();
  var cols=['${a}','${b}','${fg}'];
  var ps=[];for(var i=0;i<N;i++){ps.push({a:rnd()*6.283,r:40+rnd()*Math.min(innerWidth,innerHeight)*0.42,sp:(0.2+rnd()*0.8)*(rnd()<.5?1:-1)*0.01,sz:1+rnd()*3.5,c:cols[(i)%3],ph:rnd()*6.283});}
  var t=0,mx=innerWidth/2,my=innerHeight/2;
  addEventListener('pointermove',function(e){mx=e.clientX;my=e.clientY;});
  function frame(){
    t++;
    x.fillStyle='${bg}';x.globalAlpha=0.16;x.fillRect(0,0,innerWidth,innerHeight);x.globalAlpha=1;
    var cx=innerWidth/2+(mx-innerWidth/2)*0.06,cy=innerHeight/2+(my-innerHeight/2)*0.06;
    for(var i=0;i<ps.length;i++){var p=ps[i];p.a+=p.sp;
      var wob=Math.sin(t*0.02+p.ph)*18;
      var px=cx+Math.cos(p.a)*(p.r+wob),py=cy+Math.sin(p.a)*(p.r+wob)*0.62;
      x.beginPath();x.fillStyle=p.c;x.globalAlpha=0.85;
      x.arc(px,py,p.sz,0,6.283);x.fill();
      if(i%7===0){x.globalAlpha=0.18;x.strokeStyle=p.c;x.beginPath();x.moveTo(cx,cy);x.lineTo(px,py);x.stroke();}
    }
    x.globalAlpha=1;
    requestAnimationFrame(frame);
  }
  x.fillStyle='${bg}';x.fillRect(0,0,innerWidth,innerHeight);
  frame();
})();
</script>
</body>
</html>`;
}
