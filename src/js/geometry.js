/* ---------- geometry ---------- */
import {evalF, kids} from './core.js';
import {num, numEl} from './visio-package.js';

export function axisOf(t,n){
  if(t&&t.startsWith('Rel')) return null;
  if(t==='Ellipse') return {X:'x',A:'x',C:'x',Y:'y',B:'y',D:'y'}[n]||null;
  if(t==='EllipticalArcTo') return {X:'x',A:'x',Y:'y',B:'y'}[n]||null;
  return {X:'x',Y:'y'}[n]||null;
}
function readSec(sec){
  const o={ix:sec.getAttribute('IX')||'0',del:sec.getAttribute('Del')==='1',cells:{},rows:new Map()}; let n=0;
  for(const c of sec.children){
    if(c.localName==='Cell') o.cells[c.getAttribute('N')]={v:parseFloat(c.getAttribute('V')),f:c.getAttribute('F')};
    else if(c.localName==='Row'){ n++; const r={t:c.getAttribute('T'),del:c.getAttribute('Del')==='1',c:{}};
      for(const rc of c.children) if(rc.localName==='Cell') r.c[rc.getAttribute('N')]={v:parseFloat(rc.getAttribute('V')),f:rc.getAttribute('F')};
      o.rows.set(c.getAttribute('IX')||String(n),r); }
  }
  return o;
}
export function geomFor(sh,W,H){
  const secs=new Map();
  if(sh.mel){
    const mW=numEl(sh.mel,'Width',W)||W, mH=numEl(sh.mel,'Height',H)||H, sx=W/mW, sy=H/mH;
    for(const s of kids(sh.mel,'Section')) if(s.getAttribute('N')==='Geometry'){
      const o=readSec(s);
      for(const r of o.rows.values()) for(const n in r.c){ const cc=r.c[n], ev=evalF(cc.f,W,H);
        if(ev!=null) cc.v=ev; else { const ax=axisOf(r.t,n); if(ax==='x') cc.v*=sx; else if(ax==='y') cc.v*=sy; } }
      secs.set(o.ix,o);
    }
  }
  for(const s of kids(sh.el,'Section')) if(s.getAttribute('N')==='Geometry'){
    const o=readSec(s), b=secs.get(o.ix);
    if(!b){ if(!o.del) secs.set(o.ix,o); continue; }
    if(o.del){ secs.delete(o.ix); continue; }
    Object.assign(b.cells,o.cells);
    for(const [ix,r] of o.rows){ const br=b.rows.get(ix);
      if(!br){ if(!r.del) b.rows.set(ix,r); continue; }
      if(r.del){ b.rows.delete(ix); continue; }
      if(r.t) br.t=r.t; Object.assign(br.c,r.c); }
  }
  return [...secs.values()].filter(s=>!s.del).sort((a,b)=>+a.ix-+b.ix);
}
function arc3(a,m,b,n=24){
  const d=2*(a[0]*(m[1]-b[1])+m[0]*(b[1]-a[1])+b[0]*(a[1]-m[1]));
  if(Math.abs(d)<1e-12) return [b];
  const q=p=>p[0]*p[0]+p[1]*p[1];
  const ux=(q(a)*(m[1]-b[1])+q(m)*(b[1]-a[1])+q(b)*(a[1]-m[1]))/d;
  const uy=(q(a)*(b[0]-m[0])+q(m)*(a[0]-b[0])+q(b)*(m[0]-a[0]))/d;
  const r=Math.hypot(a[0]-ux,a[1]-uy), ang=p=>Math.atan2(p[1]-uy,p[0]-ux), T=2*Math.PI, nrm=x=>((x%T)+T)%T;
  const a0=ang(a); let sw=nrm(ang(b)-a0); if(nrm(ang(m)-a0)>sw) sw-=T;
  const out=[]; for(let i=1;i<=n;i++){ const t=a0+sw*i/n; out.push([ux+r*Math.cos(t),uy+r*Math.sin(t)]); }
  out[n-1]=b; return out;
}
function ellArc(p0,c,p1,ang,D){
  if(Math.abs(D)<1e-9) return [p1];
  const co=Math.cos(ang), si=Math.sin(ang);
  const f=p=>[(p[0]*co+p[1]*si)/D,-p[0]*si+p[1]*co];
  const g=q=>{ const x=q[0]*D, y=q[1]; return [x*co-y*si,x*si+y*co]; };
  return arc3(f(p0),f(c),f(p1)).map(g);
}
export function buildPaths(sh,W,H){
  const out=[];
  for(const s of geomFor(sh,W,H)){
    const flag=n=>s.cells[n]&&s.cells[n].v===1;
    if(flag('NoShow')) continue;
    const subs=[]; let cur=null, px=0, py=0;
    const start=(x,y)=>{ cur={pts:[[x,y]]}; subs.push(cur); };
    const to=(x,y)=>{ if(!cur) start(px,py); cur.pts.push([x,y]); };
    const rows=[...s.rows.entries()].sort((a,b)=>+a[0]-+b[0]).map(e=>e[1]).filter(r=>!r.del);
    for(const r of rows){
      const v=n=>{ const c=r.c[n]; if(!c) return 0; return isFinite(c.v)?c.v:(evalF(c.f,W,H)??0); };
      let X=v('X'), Y=v('Y');
      switch(r.t){
        case 'RelMoveTo': X*=W; Y*=H; start(X,Y); break;
        case 'MoveTo': start(X,Y); break;
        case 'RelLineTo': X*=W; Y*=H; to(X,Y); break;
        case 'LineTo': case 'NURBSTo': case 'PolylineTo': case 'SplineStart': case 'SplineKnot': to(X,Y); break;
        case 'ArcTo': { const A=v('A');
          if(Math.abs(A)<1e-9){ to(X,Y); break; }
          const dx=X-px, dy=Y-py, L=Math.hypot(dx,dy)||1;
          for(const q of arc3([px,py],[(px+X)/2+dy/L*A,(py+Y)/2-dx/L*A],[X,Y])) to(q[0],q[1]); break; }
        case 'EllipticalArcTo': case 'RelEllipticalArcTo': { let A=v('A'), B=v('B');
          if(r.t==='RelEllipticalArcTo'){ X*=W; Y*=H; A*=W; B*=H; }
          for(const q of ellArc([px,py],[A,B],[X,Y],v('C'),v('D')||1)) to(q[0],q[1]); break; }
        case 'Ellipse': { const A=v('A'), B=v('B'), C=v('C'), D=v('D'), pts=[];
          for(let i=0;i<=48;i++){ const t=i/48*2*Math.PI; pts.push([X+(A-X)*Math.cos(t)+(C-X)*Math.sin(t),Y+(B-Y)*Math.cos(t)+(D-Y)*Math.sin(t)]); }
          subs.push({pts}); cur=null; break; }
        case 'RelCubBezTo': { const p0=[px,py], c1=[v('A')*W,v('B')*H], c2=[v('C')*W,v('D')*H]; X*=W; Y*=H;
          for(let i=1;i<=16;i++){ const t=i/16, u=1-t;
            to(u*u*u*p0[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*X, u*u*u*p0[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*Y); } break; }
        case 'RelQuadBezTo': { const p0=[px,py], c1=[v('A')*W,v('B')*H]; X*=W; Y*=H;
          for(let i=1;i<=12;i++){ const t=i/12, u=1-t; to(u*u*p0[0]+2*u*t*c1[0]+t*t*X, u*u*p0[1]+2*u*t*c1[1]+t*t*Y); } break; }
        default: continue;
      }
      px=X; py=Y;
    }
    out.push({fill:!flag('NoFill'),line:!flag('NoLine'),subs});
  }
  return out;
}

/* ---------- transforms ---------- */
export const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const ap=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function localMatrix(sh){
  const W=num(sh,'Width',0), H=num(sh,'Height',0), a=num(sh,'Angle',0), c=Math.cos(a), s=Math.sin(a);
  const fx=num(sh,'FlipX',0)?-1:1, fy=num(sh,'FlipY',0)?-1:1;
  return mul([1,0,0,1,num(sh,'PinX',0),num(sh,'PinY',0)],mul([c,s,-s,c,0,0],mul([fx,0,0,fy,0,0],[1,0,0,1,-num(sh,'LocPinX',W/2),-num(sh,'LocPinY',H/2)])));
}
