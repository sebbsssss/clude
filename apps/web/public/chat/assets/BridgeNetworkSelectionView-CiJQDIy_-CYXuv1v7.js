import{bk as P,bl as S,bY as R,c0 as O,r as Q,j as e,c1 as C,c2 as Y,c3 as z,c4 as E,c5 as H,bO as o}from"./vendor-privy-BA9hQiL2.js";import{n as U}from"./getErc20Balance-o7J9W1su-BJH839x0.js";import{k as q,u as D}from"./ModalHeader-BnVmXtvG-C1ndut6F.js";import{c as G,s as J}from"./Layouts-BlFm53ED-Clf4F1cP.js";import{t as K}from"./FundWalletMethodHeader-Cb-ACySl-HRURyELV.js";import{s as $,e as f,n as L}from"./Value-tcJV9e0L-CnhfDN3_.js";import{e as M}from"./ErrorMessage-D8VaAP5m-COxZ50fe.js";import{r as V}from"./Subtitle-CV-2yKE4-2aLSTGAF.js";import{e as W}from"./Title-BnzYV3Is-Di54wI8M.js";import{F as X}from"./WalletIcon-Bo07oJT8.js";import{e as N}from"./getChainName-DjpPdUSc-c2urPd0g.js";import{n as Z}from"./Chip-D2-wZOHJ-2CUJB1pG.js";import{w as _}from"./TransferOrBridgeLoadingScreen-DVeIRghG-hIQBkPRR.js";import{d as ee,e as re}from"./shared-FM0rljBt-18WZYt6X.js";import{F as ae}from"./ChevronDownIcon-CQuJuHOf.js";import{t as k}from"./formatErc20TokenAmount-BuPk9xcy-CkAr4Oc0.js";import{c as F}from"./ethers-Dnv1tMN3-CWhaqaCY.js";import{a as ne,p as se,s as ie,c as oe,l as te}from"./styles-DDaGxKdi-CtUzw2kD.js";const Oe=({chains:s,appId:r,address:a,rpcConfig:t,includeUsdc:c})=>Promise.all(s.map((async n=>{let m=P({chain:n,transport:S(R(n,t,r))}),g=await m.getBalance({address:a}).catch((()=>0n)),i=null,l=O[n.id];if(c&&l){let{balance:h}=await U({address:a,chain:n,rpcConfig:t,appId:r,erc20Address:l});i=h}return{balance:g,erc20Balance:i,erc20Address:l,chain:n}}))),ce=({balance:s,className:r,chain:a})=>e.jsx(ee,{className:r,$state:void 0,children:e.jsx(j,{balance:s,chain:a})}),j=({balance:s,chain:r})=>e.jsxs(e.Fragment,{children:[e.jsxs(le,{children:[e.jsx(me,{chainId:typeof r=="object"?r.id:"solana"}),e.jsx(L,{children:typeof r=="object"?r.name:N(r)})]}),e.jsxs(Z,{isLoading:!1,isPulsing:!1,color:"gray",children:[e.jsx(de,{children:e.jsx(X,{})}),s]})]});let le=o.div`
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
`;const he=({options:s,onSelect:r,selected:a,className:t})=>e.jsxs(Y,{as:pe,children:[e.jsxs(z,{as:fe,children:[e.jsx(j,{balance:a.balance,chain:a.chain}),e.jsx(y,{height:16})]}),e.jsx(E,{as:ue,className:t,children:s.map(((c,n)=>e.jsx(H,{as:xe,onClick:()=>r(n),children:e.jsx(j,{balance:c.balance,chain:c.chain})},n)))})]});let pe=o.div`
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
`,xe=o.button`
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
`,fe=o.button`
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
`;const Qe=({displayName:s,errorMessage:r,configuredFundingChain:a,formattedBalance:t,fundingAmount:c,fundingCurrency:n,fundingAmountInUsd:m,options:g,selectedOption:i,isPreparing:l,isSubmitting:h,addressToFund:T,fundingWalletAddress:A,onSubmit:B,onSelect:I,onAmountChange:v,erc20ContractInfo:p})=>{let w=Q.useRef(null);return e.jsxs(e.Fragment,{children:[e.jsx(K,{}),e.jsx(G,{}),e.jsx(W,{children:"Transfer from another network"}),e.jsxs(V,{children:["You need more funds on the"," ",typeof a=="object"?a.name:N(a)," ","network. Bridge from another blockchain network."]}),e.jsxs(ne,{style:{marginTop:"2rem"},children:[e.jsxs(se,{onClick:()=>w.current?.focus(),children:[e.jsx(ie,{ref:w,value:c,onChange:u=>{let d=u.target.value;if(/^[0-9.]*$/.test(d)&&d.split(".").length-1<=1){let b=/\.$/.test(d)?".":"",x=Number(d.replace(/\.$/,"")||"0");if(Number.isNaN(x))return void v("0");v(x.toString()+b)}}}),e.jsx(oe,{children:n})]}),m&&e.jsx(te,{children:m})]}),e.jsxs($,{style:{marginTop:"1.5rem"},children:[e.jsx(f,{children:"From"}),e.jsx(f,{children:C(A)})]}),e.jsx(he,{selected:{chain:i.chain,balance:i.isErc20Quote?k({amount:i.erc20Balance??0n,decimals:p?.decimals??6})+` ${p?.symbol||""}`:F(i.balance,i.chain.nativeCurrency.symbol,3,!0)},options:g.map((({chain:u,balance:d,isErc20Quote:b,erc20Balance:x})=>({chain:u,balance:b?k({amount:x??0n,decimals:p?.decimals??6})+` ${p?.symbol||""}`:F(d,u.nativeCurrency.symbol,3,!0)}))),onSelect:I}),e.jsxs($,{style:{marginTop:"1.5rem"},children:[e.jsx(f,{children:"To"}),e.jsx(f,{children:C(T)})]}),e.jsx(ce,{chain:a,balance:t}),e.jsx(M,{style:{marginTop:"1rem"},children:r}),e.jsxs(q,{style:{marginTop:"1rem"},loading:h||l,disabled:l||h,onClick:B,children:["Confirm with ",s]}),e.jsx(J,{}),e.jsx(D,{})]})};export{Oe as H,Qe as Z};
