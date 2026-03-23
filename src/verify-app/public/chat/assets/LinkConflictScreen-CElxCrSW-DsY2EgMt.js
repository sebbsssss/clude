import{cR as l,cP as S,cM as $,cO as e,cN as W,d7 as a}from"./index-Br1bVXxn.js";import{F as E}from"./ExclamationTriangleIcon-CTdcHgLy.js";import{F as g}from"./WalletIcon-BosU0wjn.js";import{T as j,m as y,$ as R,u as w}from"./ModalHeader-BnVmXtvG-DWMZi5qe.js";import{i as M}from"./StackedContainer-B2vaEl56-8QBIRfJk.js";import{p as v}from"./Address-N-mzBgMy-BWv4jwSr.js";import{e as F}from"./capitalizeFirstLetter-DmLYqXsO-tV1Idewc.js";import{F as z}from"./ExclamationCircleIcon-CYhUtcuS.js";import"./check-YWvUncYC.js";import"./createLucideIcon-DqWH7Hlk.js";import"./copy-CY6NzjED.js";function I({title:r,titleId:n,...t},i){return l.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:i,"aria-labelledby":n},t),r?l.createElement("title",{id:n},r):null,l.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6"}))}const L=l.forwardRef(I),D=a.span`
  && {
    width: 82px;
    height: 82px;
    border-width: 4px;
    border-style: solid;
    border-color: ${r=>r.color??"var(--privy-color-accent)"};
    border-bottom-color: transparent;
    border-radius: 50%;
    display: inline-block;
    box-sizing: border-box;
    animation: rotation 1.2s linear infinite;
    transition: border-color 800ms;
    border-bottom-color: ${r=>r.color??"var(--privy-color-accent)"};
  }
`;function N(r){return e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round",...r,children:[e.jsx("circle",{cx:"12",cy:"12",r:"10"}),e.jsx("line",{x1:"12",x2:"12",y1:"8",y2:"12"}),e.jsx("line",{x1:"12",x2:"12.01",y1:"16",y2:"16"})]})}const b=({onTransfer:r,isTransferring:n,transferSuccess:t})=>e.jsx(y,{...t?{success:!0,children:"Success!"}:{warn:!0,loading:n,onClick:r,children:"Transfer and delete account"}}),T=a.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding-bottom: 16px;
`,f=a.div`
  display: flex;
  flex-direction: column;
  && p {
    font-size: 14px;
  }
  width: 100%;
  gap: 16px;
`,k=a.div`
  display: flex;
  cursor: pointer;
  align-items: center;
  width: 100%;
  border: 1px solid var(--privy-color-foreground-4) !important;
  border-radius: var(--privy-border-radius-md);
  padding: 8px 10px;
  font-size: 14px;
  font-weight: 500;
  gap: 8px;
`,P=a(z)`
  position: relative;
  width: ${({$iconSize:r})=>`${r}px`};
  height: ${({$iconSize:r})=>`${r}px`};
  color: var(--privy-color-foreground-3);
  margin-left: auto;
`,B=a(L)`
  position: relative;
  width: 15px;
  height: 15px;
  color: var(--privy-color-foreground-3);
  margin-left: auto;
`,V=a.ol`
  display: flex;
  flex-direction: column;
  font-size: 14px;
  width: 100%;
  text-align: left;
`,m=a.li`
  font-size: 14px;
  list-style-type: auto;
  list-style-position: outside;
  margin-left: 1rem;
  margin-bottom: 0.5rem; /* Adjust the margin as needed */

  &:last-child {
    margin-bottom: 0; /* Remove margin from the last item */
  }
`,H=a.div`
  position: relative;
  width: 60px;
  height: 60px;
  margin: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
`;let O=()=>e.jsx(H,{children:e.jsx(P,{$iconSize:60})});const U=({address:r,onClose:n,onRetry:t,onTransfer:i,isTransferring:d,transferSuccess:u})=>{let{defaultChain:o}=W(),s=o.blockExplorers?.default.url??"https://etherscan.io";return e.jsxs(e.Fragment,{children:[e.jsx(j,{onClose:n,backFn:t}),e.jsxs(T,{children:[e.jsx(O,{}),e.jsxs(f,{children:[e.jsx("h3",{children:"Check account assets before transferring"}),e.jsx("p",{children:"Before transferring, ensure there are no assets in the other account. Assets in that account will not transfer automatically and may be lost."}),e.jsxs(V,{children:[e.jsx("p",{children:" To check your balance, you can:"}),e.jsx(m,{children:"Log out and log back into the other account, or "}),e.jsxs(m,{children:["Copy your wallet address and use a"," ",e.jsx("u",{children:e.jsx("a",{target:"_blank",href:s,children:"block explorer"})})," ","to see if the account holds any assets."]})]}),e.jsxs(k,{onClick:()=>navigator.clipboard.writeText(r).catch(console.error),children:[e.jsx(g,{color:"var(--privy-color-foreground-1)",strokeWidth:2,height:"28px",width:"28px"}),e.jsx(v,{address:r,showCopyIcon:!1}),e.jsx(B,{})]}),e.jsx(b,{onTransfer:i,isTransferring:d,transferSuccess:u})]})]}),e.jsx(w,{})]})},oe={component:()=>{let{initiateAccountTransfer:r,closePrivyModal:n}=S(),{data:t,navigate:i,lastScreen:d,setModalData:u}=$(),[o,s]=l.useState(void 0),[c,C]=l.useState(!1),[h,p]=l.useState(!1),x=async()=>{try{if(!t?.accountTransfer?.nonce||!t?.accountTransfer?.account)throw Error("missing account transfer inputs");p(!0),await r({nonce:t?.accountTransfer?.nonce,account:t?.accountTransfer?.account,accountType:t?.accountTransfer?.linkMethod,externalWalletMetadata:t?.accountTransfer?.externalWalletMetadata,telegramWebAppData:t?.accountTransfer?.telegramWebAppData,telegramAuthResult:t?.accountTransfer?.telegramAuthResult,farcasterEmbeddedAddress:t?.accountTransfer?.farcasterEmbeddedAddress,oAuthUserInfo:t?.accountTransfer?.oAuthUserInfo}),C(!0),p(!1),setTimeout(n,1e3)}catch(A){u({errorModalData:{error:A,previousScreen:d||"LinkConflictScreen"}}),i("ErrorScreen",!0)}};return o?e.jsx(U,{address:o,onClose:n,onRetry:()=>s(void 0),onTransfer:x,isTransferring:h,transferSuccess:c}):e.jsx(_,{onClose:n,onInfo:()=>s(t?.accountTransfer?.embeddedWalletAddress),onContinue:()=>s(t?.accountTransfer?.embeddedWalletAddress),onTransfer:x,isTransferring:h,transferSuccess:c,data:t})}},_=({onClose:r,onContinue:n,onInfo:t,onTransfer:i,transferSuccess:d,isTransferring:u,data:o})=>{if(!o?.accountTransfer?.linkMethod||!o?.accountTransfer?.displayName)return;let s={method:o?.accountTransfer?.linkMethod,handle:o?.accountTransfer?.displayName,disclosedAccount:o?.accountTransfer?.embeddedWalletAddress?{type:"wallet",handle:o?.accountTransfer?.embeddedWalletAddress}:void 0};return e.jsxs(e.Fragment,{children:[e.jsx(j,{closeable:!0}),e.jsxs(T,{children:[e.jsx(M,{children:e.jsxs("div",{children:[e.jsx(D,{color:"var(--privy-color-error)"}),e.jsx(E,{height:38,width:38,stroke:"var(--privy-color-error)"})]})}),e.jsxs(f,{children:[e.jsxs("h3",{children:[(function(c){switch(c){case"sms":return"Phone number";case"email":return"Email address";case"siwe":return"Wallet address";case"siws":return"Solana wallet address";case"linkedin":return"LinkedIn profile";case"google":case"apple":case"discord":case"github":case"instagram":case"spotify":case"tiktok":case"line":case"twitch":case"twitter":case"telegram":case"farcaster":return`${F(c.replace("_oauth",""))} profile`;default:return c.startsWith("privy:")?"Cross-app account":c}})(s.method)," is associated with another account"]}),e.jsxs("p",{children:["Do you want to transfer",e.jsx("b",{children:s.handle?` ${s.handle}`:""})," to this account instead? This will delete your other account."]}),e.jsx(q,{onClick:t,disclosedAccount:s.disclosedAccount})]}),e.jsxs(f,{style:{gap:12,marginTop:12},children:[o?.accountTransfer?.embeddedWalletAddress?e.jsx(y,{onClick:n,children:"Continue"}):e.jsx(b,{onTransfer:i,transferSuccess:d,isTransferring:u}),e.jsx(R,{onClick:r,children:"No thanks"})]})]}),e.jsx(w,{})]})};function q({disclosedAccount:r,onClick:n}){return r?e.jsxs(k,{onClick:n,children:[e.jsx(g,{color:"var(--privy-color-foreground-1)",strokeWidth:2,height:"28px",width:"28px"}),e.jsx(v,{address:r.handle,showCopyIcon:!1}),e.jsx(N,{width:15,height:15,color:"var(--privy-color-foreground-3)",style:{marginLeft:"auto"}})]}):null}export{oe as LinkConflictScreen,_ as LinkConflictScreenView,oe as default};
