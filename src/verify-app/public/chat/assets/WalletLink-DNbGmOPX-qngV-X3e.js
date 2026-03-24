import{bY as j,d4 as n,dl as $,dx as o}from"./index-l91PVMT7.js";import{i as g,m as a,o as d,c as x}from"./ethers-Dnv1tMN3-C29bLIEd.js";import{C as k}from"./getFormattedUsdFromLamports-B6EqSEho-C-HCdwKa.js";import{t as y}from"./transaction-CnfuREWo-nROljJQP.js";const O=({weiQuantities:e,tokenPrice:i,tokenSymbol:s})=>{let r=a(e),t=i?d(r,i):void 0,l=x(r,s);return n.jsx(c,{children:t||l})},P=({weiQuantities:e,tokenPrice:i,tokenSymbol:s})=>{let r=a(e),t=i?d(r,i):void 0,l=x(r,s);return n.jsx(c,{children:t?n.jsxs(n.Fragment,{children:[n.jsx(S,{children:"USD"}),t==="<$0.01"?n.jsxs(p,{children:[n.jsx(h,{children:"<"}),"$0.01"]}):t]}):l})},D=({quantities:e,tokenPrice:i,tokenSymbol:s="SOL",tokenDecimals:r=9})=>{let t=e.reduce(((u,f)=>u+f),0n),l=i&&s==="SOL"&&r===9?k(t,i):void 0,m=s==="SOL"&&r===9?y(t):`${j(t,r)} ${s}`;return n.jsx(c,{children:l?n.jsx(n.Fragment,{children:l==="<$0.01"?n.jsxs(p,{children:[n.jsx(h,{children:"<"}),"$0.01"]}):l}):m})};let c=o.span`
  font-size: 14px;
  line-height: 140%;
  display: flex;
  gap: 4px;
  align-items: center;
`,S=o.span`
  font-size: 12px;
  line-height: 12px;
  color: var(--privy-color-foreground-3);
`,h=o.span`
  font-size: 10px;
`,p=o.span`
  display: flex;
  align-items: center;
`;function v(e,i){return`https://explorer.solana.com/account/${e}?chain=${i}`}const F=e=>n.jsx(b,{href:e.chainType==="ethereum"?g(e.chainId,e.walletAddress):v(e.walletAddress,e.chainId),target:"_blank",children:$(e.walletAddress)});let b=o.a`
  &:hover {
    text-decoration: underline;
  }
`;export{D as f,P as h,O as p,F as v};
