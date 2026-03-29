import{bf as P,bg as S,bT as R,bX as Q,r as Y,j as e,bY as C,bZ as z,b_ as E,b$ as H,c0 as J,bJ as o}from"./vendor-privy-D-qEdLrY.js";import{n as O}from"./getErc20Balance-o7J9W1su-Axfj8jR4.js";import{k as U,u as X}from"./ModalHeader-BnVmXtvG-nKy1GoVW.js";import{c as Z,s as q}from"./Layouts-BlFm53ED-ChItRmlQ.js";import{t as D}from"./FundWalletMethodHeader-Cb-ACySl-DElUr3VE.js";import{s as $,e as x,n as G}from"./Value-tcJV9e0L-D1mLe9x9.js";import{e as K}from"./ErrorMessage-D8VaAP5m-Dq4QnDxM.js";import{r as L}from"./Subtitle-CV-2yKE4-CuPgY2H6.js";import{e as M}from"./Title-BnzYV3Is-BUooebHz.js";import{F as V}from"./WalletIcon-D78yV1kk.js";import{e as N}from"./getChainName-DjpPdUSc-c2urPd0g.js";import{n as W}from"./Chip-D2-wZOHJ-BPiJItdI.js";import{w as _}from"./TransferOrBridgeLoadingScreen-DVeIRghG-AYPZpvCh.js";import{d as ee,e as re}from"./shared-FM0rljBt-CcVPmDjr.js";import{F as ae}from"./ChevronDownIcon-DrDFPRf0.js";import{t as k}from"./formatErc20TokenAmount-BuPk9xcy-CkAr4Oc0.js";import{c as F}from"./ethers-Dnv1tMN3-B8croYaS.js";import{a as ne,p as se,s as ie,c as oe,l as te}from"./styles-DDaGxKdi-87sZwmGG.js";const Qe=({chains:s,appId:r,address:a,rpcConfig:t,includeUsdc:c})=>Promise.all(s.map((async n=>{let m=P({chain:n,transport:S(R(n,t,r))}),b=await m.getBalance({address:a}).catch((()=>0n)),i=null,l=Q[n.id];if(c&&l){let{balance:h}=await O({address:a,chain:n,rpcConfig:t,appId:r,erc20Address:l});i=h}return{balance:b,erc20Balance:i,erc20Address:l,chain:n}}))),ce=({balance:s,className:r,chain:a})=>e.jsx(ee,{className:r,$state:void 0,children:e.jsx(j,{balance:s,chain:a})}),j=({balance:s,chain:r})=>e.jsxs(e.Fragment,{children:[e.jsxs(le,{children:[e.jsx(me,{chainId:typeof r=="object"?r.id:"solana"}),e.jsx(G,{children:typeof r=="object"?r.name:N(r)})]}),e.jsxs(W,{isLoading:!1,isPulsing:!1,color:"gray",children:[e.jsx(de,{children:e.jsx(V,{})}),s]})]});let le=o.div`
  display: flex;
  align-items: center;
`,de=o.div`
  height: 0.75rem;
  width: 0.75rem;
  margin-right: 0.2rem;
`,me=o(_)`
  height: 1.25rem;
  width: 1.25rem;
  display: inline-block;
  margin-right: 0.5rem;
  border-radius: 4px;
`;const he=({options:s,onSelect:r,selected:a,className:t})=>e.jsxs(z,{as:pe,children:[e.jsxs(E,{as:xe,children:[e.jsx(j,{balance:a.balance,chain:a.chain}),e.jsx(y,{height:16})]}),e.jsx(H,{as:ue,className:t,children:s.map(((c,n)=>e.jsx(J,{as:fe,onClick:()=>r(n),children:e.jsx(j,{balance:c.balance,chain:c.chain})},n)))})]});let pe=o.div`
  width: 100%;
  position: relative;
`,ue=o.div`
  width: 100%;
  margin-top: 0.5rem;
  position: absolute;
  background-color: var(--privy-color-background);
  border-radius: var(--privy-border-radius-md);
  overflow-x: hidden;
  overflow-y: auto;
  box-shadow: 0px 1px 2px 0px rgba(16, 24, 40, 0.05);
  max-height: 11.75rem;

  && {
    border: solid 1px var(--privy-color-foreground-4);
  }

  z-index: 1;
`,fe=o.button`
  width: 100%;
  display: flex;
  justify-content: space-between;

  && {
    padding: 1rem;
  }

  :not(:last-child) {
    border-bottom: solid 1px var(--privy-color-foreground-4);
  }

  :hover {
    background: var(--privy-color-background-2);
  }
`,y=o(ae)`
  height: 1rem;
  margin-left: 0.5rem;
`,xe=o.button`
  ${re}

  /* Push the chip all the way to the right */
  span {
    margin-left: auto;
  }

  ${y} {
    transition: rotate 100ms ease-in;
  }

  &[aria-expanded='true'] {
    ${y} {
      rotate: -180deg;
    }
  }
`;const Ye=({displayName:s,errorMessage:r,configuredFundingChain:a,formattedBalance:t,fundingAmount:c,fundingCurrency:n,fundingAmountInUsd:m,options:b,selectedOption:i,isPreparing:l,isSubmitting:h,addressToFund:T,fundingWalletAddress:A,onSubmit:B,onSelect:I,onAmountChange:v,erc20ContractInfo:p})=>{let w=Y.useRef(null);return e.jsxs(e.Fragment,{children:[e.jsx(D,{}),e.jsx(Z,{}),e.jsx(M,{children:"Transfer from another network"}),e.jsxs(L,{children:["You need more funds on the"," ",typeof a=="object"?a.name:N(a)," ","network. Bridge from another blockchain network."]}),e.jsxs(ne,{style:{marginTop:"2rem"},children:[e.jsxs(se,{onClick:()=>w.current?.focus(),children:[e.jsx(ie,{ref:w,value:c,onChange:u=>{let d=u.target.value;if(/^[0-9.]*$/.test(d)&&d.split(".").length-1<=1){let g=/\.$/.test(d)?".":"",f=Number(d.replace(/\.$/,"")||"0");if(Number.isNaN(f))return void v("0");v(f.toString()+g)}}}),e.jsx(oe,{children:n})]}),m&&e.jsx(te,{children:m})]}),e.jsxs($,{style:{marginTop:"1.5rem"},children:[e.jsx(x,{children:"From"}),e.jsx(x,{children:C(A)})]}),e.jsx(he,{selected:{chain:i.chain,balance:i.isErc20Quote?k({amount:i.erc20Balance??0n,decimals:p?.decimals??6})+` ${p?.symbol||""}`:F(i.balance,i.chain.nativeCurrency.symbol,3,!0)},options:b.map((({chain:u,balance:d,isErc20Quote:g,erc20Balance:f})=>({chain:u,balance:g?k({amount:f??0n,decimals:p?.decimals??6})+` ${p?.symbol||""}`:F(d,u.nativeCurrency.symbol,3,!0)}))),onSelect:I}),e.jsxs($,{style:{marginTop:"1.5rem"},children:[e.jsx(x,{children:"To"}),e.jsx(x,{children:C(T)})]}),e.jsx(ce,{chain:a,balance:t}),e.jsx(K,{style:{marginTop:"1rem"},children:r}),e.jsxs(U,{style:{marginTop:"1rem"},loading:h||l,disabled:l||h,onClick:B,children:["Confirm with ",s]}),e.jsx(q,{}),e.jsx(X,{})]})};export{Qe as H,Ye as Z};
