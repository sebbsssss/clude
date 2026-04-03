import{ak as j,am as n,aA as $,ar as l}from"./index-C5ltmIwg.js";import{i as g,m as c,o as d,c as h}from"./ethers-Dnv1tMN3-CeK2OppQ.js";import{C as k}from"./getFormattedUsdFromLamports-B6EqSEho-C-HCdwKa.js";import{t as y}from"./transaction-CnfuREWo-nROljJQP.js";const O=({weiQuantities:e,tokenPrice:r,tokenSymbol:s})=>{let i=c(e),t=r?d(i,r):void 0,o=h(i,s);return n.jsx(a,{children:t||o})},P=({weiQuantities:e,tokenPrice:r,tokenSymbol:s})=>{let i=c(e),t=r?d(i,r):void 0,o=h(i,s);return n.jsx(a,{children:t?n.jsxs(n.Fragment,{children:[n.jsx(S,{children:"USD"}),t==="<$0.01"?n.jsxs(x,{children:[n.jsx(p,{children:"<"}),"$0.01"]}):t]}):o})},D=({quantities:e,tokenPrice:r,tokenSymbol:s="SOL",tokenDecimals:i=9})=>{let t=e.reduce(((u,f)=>u+f),0n),o=r&&s==="SOL"&&i===9?k(t,r):void 0,m=s==="SOL"&&i===9?y(t):`${j(t,i)} ${s}`;return n.jsx(a,{children:o?n.jsx(n.Fragment,{children:o==="<$0.01"?n.jsxs(x,{children:[n.jsx(p,{children:"<"}),"$0.01"]}):o}):m})};let a=l.span`
  font-size: 14px;
  line-height: 140%;
  display: flex;
  gap: 4px;
  align-items: center;
`,S=l.span`
  font-size: 12px;
  line-height: 12px;
  color: var(--privy-color-foreground-3);
`,p=l.span`
  font-size: 10px;
`,x=l.span`
  display: flex;
  align-items: center;
`;function v(e,r){return`https://explorer.solana.com/account/${e}?chain=${r}`}const F=e=>n.jsx(w,{href:e.chainType==="ethereum"?g(e.chainId,e.walletAddress):v(e.walletAddress,e.chainId),target:"_blank",children:$(e.walletAddress)});let w=l.a`
  &:hover {
    text-decoration: underline;
  }
`;export{D as f,P as h,O as p,F as v};
