import{di as v,cO as e,ez as h,cR as f,d7 as n}from"./index-CJh2rB3E.js";import{n as j}from"./ScreenLayout-D1p_ntex-3uAcHMJ3.js";import{c as k}from"./createLucideIcon-Bc7bGkPp.js";const C=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],z=k("chevron-down",C),A=async({operation:r,until:a,delay:o,interval:i,attempts:l,signal:p})=>{let d,s=0;for(;s<l;){if(p?.aborted)return{status:"aborted",result:d,attempts:s};s++;try{if(d=await r(),a(d))return{status:"success",result:d,attempts:s};s<l&&await v(i)}catch{s<l&&await v(i)}}return{status:"max_attempts",result:d,attempts:s}},S=r=>{try{return r.location.origin}catch{return}},O=async(r,a)=>{let o=await A({operation:async()=>({done:S(r)===window.location.origin,closed:r.closed}),until:({done:i,closed:l})=>i||l,delay:0,interval:500,attempts:360,signal:a});return o.status==="aborted"?(r.close(),{status:"aborted"}):o.status==="max_attempts"?{status:"timeout"}:o.result.done?(r.close(),{status:"redirected"}):{status:"closed"}},T=({currency:r="usd",value:a,onChange:o,inputMode:i="decimal",autoFocus:l})=>{let[p,d]=f.useState("0"),s=f.useRef(null),m=a??p,g=h[r]?.symbol??"$",w=f.useCallback((c=>{let t=c.target.value,u=(t=t.replace(/[^\d.]/g,"")).split(".");u.length>2&&(t=u[0]+"."+u.slice(1).join("")),u.length===2&&u[1].length>2&&(t=`${u[0]}.${u[1].slice(0,2)}`),t.length>1&&t[0]==="0"&&t[1]!=="."&&(t=t.slice(1)),(t===""||t===".")&&(t="0"),o?o(t):d(t)}),[o]),b=f.useCallback((c=>{!(["Delete","Backspace","Tab","Escape","Enter",".","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(c.key)||(c.ctrlKey||c.metaKey)&&["a","c","v","x"].includes(c.key.toLowerCase()))&&(c.key>="0"&&c.key<="9"||c.preventDefault())}),[]),y=f.useMemo((()=>(m.includes("."),m)),[m]);return e.jsxs(L,{onClick:()=>s.current?.focus(),children:[e.jsx(x,{children:g}),y,e.jsx("input",{ref:s,type:"text",inputMode:i,value:y,onChange:w,onKeyDown:b,autoFocus:l,placeholder:"0",style:{width:1,height:"1rem",opacity:0,alignSelf:"center",fontSize:"1rem"}}),e.jsx(x,{style:{opacity:0},children:g})]})},Y=({selectedAsset:r,onEditSourceAsset:a})=>{let{icon:o}=h[r];return e.jsxs(D,{onClick:a,children:[e.jsx(E,{children:o}),e.jsx(R,{children:r.toLocaleUpperCase()}),e.jsx(_,{children:e.jsx(z,{})})]})};let L=n.span`
  background-color: var(--privy-color-background);
  width: 100%;
  text-align: center;
  border: none;
  font-kerning: none;
  font-feature-settings: 'calt' off;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  cursor: pointer;

  &:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }

  && {
    color: var(--privy-color-foreground);
    font-size: 3.75rem;
    font-style: normal;
    font-weight: 600;
    line-height: 5.375rem;
  }
`,x=n.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 1rem;
  font-style: normal;
  font-weight: 600;
  line-height: 1.5rem;
  margin-top: 0.75rem;
`,D=n.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: auto;
  gap: 0.5rem;
  border: 1px solid var(--privy-color-border-default);
  border-radius: var(--privy-border-radius-full);

  && {
    margin: auto;
    padding: 0.5rem 1rem;
  }
`,E=n.div`
  svg {
    width: 1rem;
    height: 1rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
  }
`,R=n.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 0.875rem;
  font-style: normal;
  font-weight: 500;
  line-height: 1.375rem;
`,_=n.div`
  color: var(--privy-color-foreground);

  svg {
    width: 1.25rem;
    height: 1.25rem;
  }
`;const Z=({opts:r,isLoading:a,onSelectSource:o})=>e.jsx(j,{showClose:!1,showBack:!0,onBack:()=>o(r.source.selectedAsset),title:"Select currency",children:e.jsx(B,{children:r.source.assets.map((i=>{let{icon:l,name:p}=h[i];return e.jsx(K,{onClick:()=>o(i),disabled:a,children:e.jsxs(M,{children:[e.jsx(U,{children:l}),e.jsxs(F,{children:[e.jsx($,{children:p}),e.jsx(q,{children:i.toLocaleUpperCase()})]})]})},i)}))})});let B=n.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
`,K=n.button`
  border-color: var(--privy-color-border-default);
  border-width: 1px;
  border-radius: var(--privy-border-radius-mdlg);
  border-style: solid;
  display: flex;

  && {
    padding: 0.75rem 1rem;
  }
`,M=n.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
`,U=n.div`
  svg {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
  }
`,F=n.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
`,$=n.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
`,q=n.span`
  color: var(--privy-color-foreground-3);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.125rem;
`;export{T as f,Y as h,Z as k,O as p,A as u};
