/* =====================================================================
   Automatic layout for formats without positions: layered, top to bottom (or as the source asks)
   ===================================================================== */
import {SHAPES, TABLE, tableHeight} from './shapes.js';
import {clampN, fullLabel} from './formats/export.js';

export function sizeFor(n){
  const T=SHAPES[n.kind]||SHAPES.process, text=fullLabel(n).split('\n'), CH=0.075;   // average character width in inches at 11 pt
  const longest=Math.max(1,...text.map(l=>l.length));
  if(n.kind==='table') return {w:Math.max(TABLE.w,longest*CH+0.3),h:tableHeight(Math.max(1,(n.columns||[]).length))};
  if(n.kind==='user'||n.kind==='server') return {w:T.w,h:T.h};
  let w=Math.max(T.w,Math.min(3,longest*CH+0.4));
  const rows=text.reduce((s,l)=>s+Math.max(1,Math.ceil(l.length*CH/Math.max(w-0.3,0.5))),0);
  let h=Math.max(T.h,rows*0.22+0.3);
  if(n.kind==='text') return {w:Math.min(3,longest*CH+0.3),h:rows*0.22+0.1};
  if(n.kind==='decision'){ w=Math.max(w*1.35,1.5); h=Math.max(h*1.4,1); }
  return {w,h};
}
export function layoutGraph(g){
  if(g.positioned){
    for(const n of g.nodes){ n.w=clampN(n.w,0.1,20,1.5); n.h=clampN(n.h,0.1,20,0.75); n.x=clampN(n.x,-1e4,1e4,0); n.y=clampN(n.y,-1e4,1e4,0);
      if(n.kind==='table') n.h=tableHeight(Math.max(1,(n.columns||[]).length)); }
  } else {
    const N=g.nodes.length, idx=new Map(g.nodes.map((n,i)=>[n.id,i])), outs=g.nodes.map(()=>[]), linked=new Array(N).fill(false);
    for(const n of g.nodes) if(n.w==null||n.h==null) Object.assign(n,sizeFor(n));
    g.edges.forEach((e,k)=>{ const a=idx.get(e.from), b=idx.get(e.to); if(a==null||b==null||a===b) return; outs[a].push([b,k]); linked[a]=linked[b]=true; });
    // break cycles: an edge into a node still on the DFS stack points backwards
    const state=new Array(N).fill(0), back=new Set(), indeg=new Array(N).fill(0);
    for(const o of outs) for(const [b] of o) indeg[b]++;
    const dfs=s=>{ const st=[[s,0]]; state[s]=1;
      while(st.length){ const top=st[st.length-1], [v,i]=top;
        if(i<outs[v].length){ top[1]++; const [w,k]=outs[v][i]; if(state[w]===1) back.add(k); else if(!state[w]){ state[w]=1; st.push([w,0]); } }
        else { state[v]=2; st.pop(); } } };
    for(let i=0;i<N;i++) if(!indeg[i]&&!state[i]) dfs(i);
    for(let i=0;i<N;i++) if(!state[i]) dfs(i);
    const succ=g.nodes.map(()=>[]), pred=g.nodes.map(()=>[]);
    for(let a=0;a<N;a++) for(const [b,k] of outs[a]) if(!back.has(k)){ succ[a].push(b); pred[b].push(a); }
    // longest-path ranks
    const rank=new Array(N).fill(0), deg=pred.map(x=>x.length), q=[];
    for(let i=0;i<N;i++) if(!deg[i]) q.push(i);
    while(q.length){ const v=q.shift(); for(const w of succ[v]){ rank[w]=Math.max(rank[w],rank[v]+1); if(--deg[w]===0) q.push(w); } }
    const maxR=Math.max(0,...rank.filter((_,i)=>linked[i])), anyLinked=linked.some(Boolean);
    for(let i=0;i<N;i++) if(!linked[i]) rank[i]=anyLinked?maxR+1:0;   // unconnected shapes get a row of their own
    const layers=[]; for(let i=0;i<N;i++) (layers[rank[i]]=layers[rank[i]]||[]).push(i);
    const pos=new Array(N); layers.forEach(Lr=>Lr&&Lr.forEach((v,j)=>pos[v]=j));
    const bary=(v,nb)=>nb[v].length?nb[v].reduce((s,u)=>s+pos[u],0)/nb[v].length:pos[v];
    for(let it=0;it<8;it++){   // barycentre sweeps reduce crossings
      const down=it%2===0, nb=down?pred:succ;
      for(let r0=0;r0<layers.length;r0++){ const r=down?r0:layers.length-1-r0, Lr=layers[r]; if(!Lr) continue;
        Lr.sort((a,b)=>bary(a,nb)-bary(b,nb)); Lr.forEach((v,j)=>pos[v]=j); }
    }
    const horiz=g.direction==='LR'||g.direction==='RL', GAP_MAIN=0.6, GAP_CROSS=0.45;
    const main=v=>horiz?g.nodes[v].w:g.nodes[v].h, cross=v=>horiz?g.nodes[v].h:g.nodes[v].w;
    let offset=0;
    for(const Lr of layers){ if(!Lr) continue;
      const size=Math.max(...Lr.map(main)), total=Lr.reduce((s,v)=>s+cross(v),0)+GAP_CROSS*(Lr.length-1); let c=-total/2;
      for(const v of Lr){ const n=g.nodes[v], m=offset+(size-main(v))/2; if(horiz){ n.x=m; n.y=c; } else { n.x=c; n.y=m; } c+=cross(v)+GAP_CROSS; }
      offset+=size+GAP_MAIN; }
    /* straighten edges: pull each shape towards the mean of its neighbours, then remove overlaps by sweeping the
       layer from both ends and averaging (both sweeps keep the gaps, so their average does too) */
    const ctr=v=>horiz?g.nodes[v].y+g.nodes[v].h/2:g.nodes[v].x+g.nodes[v].w/2;
    const setCtr=(v,c)=>{ const n=g.nodes[v]; if(horiz) n.y=c-n.h/2; else n.x=c-n.w/2; };
    for(const nb of [pred,succ,pred,succ]){
      const order=nb===pred?layers:[...layers].reverse();
      for(const Lr of order){ if(!Lr) continue;
        const want=Lr.map(v=>nb[v].length?nb[v].reduce((s,u)=>s+ctr(u),0)/nb[v].length:ctr(v)), a=[], b=[];
        let edge=-Infinity; Lr.forEach((v,i)=>{ a[i]=Math.max(want[i],edge+GAP_CROSS+cross(v)/2); edge=a[i]+cross(v)/2; });
        edge=Infinity; for(let i=Lr.length-1;i>=0;i--){ const v=Lr[i]; b[i]=Math.min(want[i],edge-GAP_CROSS-cross(v)/2); edge=b[i]-cross(v)/2; }
        Lr.forEach((v,i)=>setCtr(v,(a[i]+b[i])/2));
      }
    }
    if(g.direction==='BT'||g.direction==='RL') for(const n of g.nodes){ if(horiz) n.x=offset-n.x-n.w; else n.y=offset-n.y-n.h; }
  }
  const mx=Math.min(...g.nodes.map(n=>n.x)), my=Math.min(...g.nodes.map(n=>n.y));
  for(const n of g.nodes){ n.x-=mx; n.y-=my; }
}
