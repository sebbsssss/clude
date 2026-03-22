import{cR as g,cP as Ne,cO as e,cN as ie,dP as te,d7 as d,c1 as De}from"./index-7Y6H6yFI.js";import{T as Q,g as Le,m as Z,u as oe,V as Ce}from"./ModalHeader-BnVmXtvG-DSojumJk.js";import{t as B,s,e as n,n as i,a as Pe}from"./Value-tcJV9e0L-DlaSnWp2.js";import{e as V}from"./ErrorMessage-D8VaAP5m-YvVInSd4.js";import{r as A}from"./LabelXs-oqZNqbm_-Be0V3fOW.js";import{r as le}from"./Subtitle-CV-2yKE4-BtFZeBF_.js";import{e as ae}from"./Title-BnzYV3Is-8EK1eBTa.js";import{p as c}from"./Address-N-mzBgMy-D1tNCipR.js";import{j as Re}from"./WalletInfoCard-CEcdukTg-DUO_BlUp.js";import{n as ce}from"./LoadingSkeleton-U6-3yFwI-0-4r_scU.js";import{d as Ve}from"./shared-FM0rljBt-DxxeEAKY.js";import{o as Be,F as He}from"./Checkbox-BhNoOKjX-kZcROCi0.js";import{t as We}from"./ErrorBanner-CQERa7bL-tykWyowm.js";import{t as Ue}from"./WarningBanner-D5LqDt95-CQILs6aR.js";import{F as ze}from"./ExclamationCircleIcon-C6HHKdGy.js";import{F as de}from"./ChevronDownIcon-bgouok6P.js";import{i as X}from"./formatters-DTekcSq3.js";function Je({title:l,titleId:a,...o},x){return g.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:x,"aria-labelledby":a},o),l?g.createElement("title",{id:a},l):null,g.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"}))}const qe=g.forwardRef(Je);function Qe({title:l,titleId:a,...o},x){return g.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:x,"aria-labelledby":a},o),l?g.createElement("title",{id:a},l):null,g.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"}))}const xe=g.forwardRef(Qe);function Ze({title:l,titleId:a,...o},x){return g.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",strokeWidth:1.5,stroke:"currentColor","aria-hidden":"true","data-slot":"icon",ref:x,"aria-labelledby":a},o),l?g.createElement("title",{id:a},l):null,g.createElement("path",{strokeLinecap:"round",strokeLinejoin:"round",d:"M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z"}))}const Ge=g.forwardRef(Ze),he=d(n)`
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--privy-color-accent);
  svg {
    fill: var(--privy-color-accent);
  }
`;var _=({iconUrl:l,value:a,symbol:o,usdValue:x,nftName:I,nftCount:u,decimals:t,$isLoading:j})=>{if(j)return e.jsx($,{$isLoading:j});let f=a&&x&&t?(function(S,E,M){let m=parseFloat(S),y=parseFloat(M);if(m===0||y===0||Number.isNaN(m)||Number.isNaN(y))return S;let v=Math.ceil(-Math.log10(.01/(y/m))),p=Math.pow(10,v=Math.max(v=Math.min(v,E),1)),w=+(Math.floor(m*p)/p).toFixed(v).replace(/\.?0+$/,"");return Intl.NumberFormat(void 0,{maximumFractionDigits:E}).format(w)})(a,t,x):a;return e.jsxs("div",{children:[e.jsxs($,{$isLoading:j,children:[l&&e.jsx(Ke,{src:l,alt:"Token icon"}),u&&u>1?u+"x":void 0," ",I,f," ",o]}),x&&e.jsxs(Ye,{$isLoading:j,children:["$",x]})]})};let $=d.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.375rem;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  ${ce}
`;const Ye=d.span`
  color: var(--privy-color-foreground-2);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  word-break: break-all;
  text-align: right;
  display: flex;
  justify-content: flex-end;

  ${ce}
`;let Ke=d.img`
  height: 14px;
  width: 14px;
  margin-right: 4px;
  object-fit: contain;
`;const Xe=l=>{let{chain:a,transactionDetails:o,isTokenContractInfoLoading:x,symbol:I}=l,{action:u,functionName:t}=o;return e.jsx(Ve,{children:e.jsxs(B,{children:[u!=="transaction"&&e.jsxs(s,{children:[e.jsx(n,{children:"Action"}),e.jsx(i,{children:t})]}),t==="mint"&&"args"in o&&o.args.filter((j=>j)).map(((j,f)=>e.jsxs(s,{children:[e.jsx(n,{children:`Param ${f}`}),e.jsx(i,{children:typeof j=="string"&&De(j)?e.jsx(c,{address:j,url:a?.blockExplorers?.default?.url,showCopyIcon:!1}):j?.toString()})]},f))),t==="setApprovalForAll"&&o.operator&&e.jsxs(s,{children:[e.jsx(n,{children:"Operator"}),e.jsx(i,{children:e.jsx(c,{address:o.operator,url:a?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),t==="setApprovalForAll"&&o.approved!==void 0&&e.jsxs(s,{children:[e.jsx(n,{children:"Set approval to"}),e.jsx(i,{children:o.approved?"true":"false"})]}),t==="transfer"||t==="transferWithMemo"||t==="transferFrom"||t==="safeTransferFrom"||t==="approve"?e.jsxs(e.Fragment,{children:["formattedAmount"in o&&o.formattedAmount&&e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{$isLoading:x,children:[o.formattedAmount," ",I]})]}),"tokenId"in o&&o.tokenId&&e.jsxs(s,{children:[e.jsx(n,{children:"Token ID"}),e.jsx(i,{children:o.tokenId.toString()})]})]}):null,t==="safeBatchTransferFrom"&&e.jsxs(e.Fragment,{children:["amounts"in o&&o.amounts&&e.jsxs(s,{children:[e.jsx(n,{children:"Amounts"}),e.jsx(i,{children:o.amounts.join(", ")})]}),"tokenIds"in o&&o.tokenIds&&e.jsxs(s,{children:[e.jsx(n,{children:"Token IDs"}),e.jsx(i,{children:o.tokenIds.join(", ")})]})]}),t==="approve"&&o.spender&&e.jsxs(s,{children:[e.jsx(n,{children:"Spender"}),e.jsx(i,{children:e.jsx(c,{address:o.spender,url:a?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),(t==="transferFrom"||t==="safeTransferFrom"||t==="safeBatchTransferFrom")&&o.transferFrom&&e.jsxs(s,{children:[e.jsx(n,{children:"Transferring from"}),e.jsx(i,{children:e.jsx(c,{address:o.transferFrom,url:a?.blockExplorers?.default?.url,showCopyIcon:!1})})]}),(t==="transferFrom"||t==="safeTransferFrom"||t==="safeBatchTransferFrom")&&o.transferTo&&e.jsxs(s,{children:[e.jsx(n,{children:"Transferring to"}),e.jsx(i,{children:e.jsx(c,{address:o.transferTo,url:a?.blockExplorers?.default?.url,showCopyIcon:!1})})]})]})})},_e=({variant:l,setPreventMaliciousTransaction:a,colorScheme:o="light",preventMaliciousTransaction:x})=>l==="warn"?e.jsx(ee,{children:e.jsxs(Ue,{theme:o,children:[e.jsx("span",{style:{fontWeight:"500"},children:"Warning: Suspicious transaction"}),e.jsx("br",{}),"This has been flagged as a potentially deceptive request. Approving could put your assets or funds at risk."]})}):l==="error"?e.jsx(e.Fragment,{children:e.jsxs(ee,{children:[e.jsx(We,{theme:o,children:e.jsxs("div",{children:[e.jsx("strong",{children:"This is a malicious transaction"}),e.jsx("br",{}),"This transaction transfers tokens to a known malicious address. Proceeding may result in the loss of valuable assets."]})}),e.jsxs($e,{children:[e.jsx(Be,{color:"var(--privy-color-error)",checked:!x,readOnly:!0,onClick:()=>a(!x)}),e.jsx("span",{children:"I understand and want to proceed anyways."})]})]})}):null;let ee=d.div`
  margin-top: 1.5rem;
`,$e=d.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
`;const er=({transactionIndex:l,maxIndex:a})=>typeof l!="number"||a===0?"":` (${l+1} / ${a+1})`,Mr=({img:l,submitError:a,prepareError:o,onClose:x,action:I,title:u,subtitle:t,to:j,tokenAddress:f,network:S,missingFunds:E,fee:M,from:m,cta:y,disabled:v,chain:p,isSubmitting:w,isPreparing:b,isTokenPriceLoading:D,isTokenContractInfoLoading:L,isSponsored:C,symbol:H,balance:P,onClick:O,transactionDetails:F,transactionIndex:R,maxIndex:W,onBack:r,chainName:k,validation:U,hasScanDetails:G,setIsScanDetailsOpen:fe,preventMaliciousTransaction:ke,setPreventMaliciousTransaction:ye,tokensSent:Y,tokensReceived:z,isScanning:ve,isCancellable:we,functionName:be})=>{let{showTransactionDetails:J,setShowTransactionDetails:Te,hasMoreDetails:Ie,isErc20Ish:Ae}=(h=>{let[N,Ee]=g.useState(!1),q=!0,K=!1;return(!h||h.isErc20Ish||h.action==="transaction")&&(q=!1),q&&(K=Object.entries(h||{}).some((([Me,Oe])=>Oe&&!["action","isErc20Ish","isNFTIsh"].includes(Me)))),{showTransactionDetails:N,setShowTransactionDetails:Ee,hasMoreDetails:q&&K,isErc20Ish:h?.isErc20Ish}})(F),Se=ie(),Fe=Ae&&L||b||D||ve;return e.jsxs(e.Fragment,{children:[e.jsx(Q,{onClose:x,backFn:r}),l&&e.jsx(ue,{children:l}),e.jsxs(ae,{style:{marginTop:l?"1.5rem":0},children:[u,e.jsx(er,{maxIndex:W,transactionIndex:R})]}),e.jsx(le,{children:t}),e.jsxs(B,{style:{marginTop:"2rem"},children:[(!!Y[0]||Fe)&&e.jsxs(s,{children:[z.length>0?e.jsx(n,{children:"Send"}):e.jsx(n,{children:I==="approve"?"Approval amount":"Amount"}),e.jsx("div",{className:"flex flex-col",children:Y.map(((h,N)=>e.jsx(_,{iconUrl:h.iconUrl,value:be==="setApprovalForAll"?"All":h.value,usdValue:h.usdValue,symbol:h.symbol,nftName:h.nftName,nftCount:h.nftCount,decimals:h.decimals},N)))})]}),z.length>0&&e.jsxs(s,{children:[e.jsx(n,{children:"Receive"}),e.jsx("div",{className:"flex flex-col",children:z.map(((h,N)=>e.jsx(_,{iconUrl:h.iconUrl,value:h.value,usdValue:h.usdValue,symbol:h.symbol,nftName:h.nftName,nftCount:h.nftCount,decimals:h.decimals},N)))})]}),F&&"spender"in F&&F?.spender?e.jsxs(s,{children:[e.jsx(n,{children:"Spender"}),e.jsx(i,{children:e.jsx(c,{address:F.spender,url:p?.blockExplorers?.default?.url})})]}):null,j&&e.jsxs(s,{children:[e.jsx(n,{children:"To"}),e.jsx(i,{children:e.jsx(c,{address:j,url:p?.blockExplorers?.default?.url,showCopyIcon:!0})})]}),f&&e.jsxs(s,{children:[e.jsx(n,{children:"Token address"}),e.jsx(i,{children:e.jsx(c,{address:f,url:p?.blockExplorers?.default?.url})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Network"}),e.jsx(i,{children:S})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Estimated fee"}),e.jsx(i,{$isLoading:b||D||C===void 0,children:C?e.jsxs(pe,{children:[e.jsxs(ge,{children:["Sponsored by ",Se.name]}),e.jsx(xe,{height:16,width:16})]}):M})]}),Ie&&!G&&e.jsxs(e.Fragment,{children:[e.jsx(s,{className:"cursor-pointer",onClick:()=>Te(!J),children:e.jsxs(Pe,{className:"flex items-center gap-x-1",children:["Details"," ",e.jsx(de,{style:{width:"0.75rem",marginLeft:"0.25rem",transform:J?"rotate(180deg)":void 0}})]})}),J&&F&&e.jsx(Xe,{action:I,chain:p,transactionDetails:F,isTokenContractInfoLoading:L,symbol:H})]}),G&&e.jsx(s,{children:e.jsxs(he,{onClick:()=>fe(!0),children:[e.jsx("span",{className:"text-color-primary",children:"Details"}),e.jsx(qe,{height:"14px",width:"14px",strokeWidth:"2"})]})})]}),e.jsx(te,{}),a?e.jsx(V,{style:{marginTop:"2rem"},children:a.message}):o&&R===0?e.jsx(V,{style:{marginTop:"2rem"},children:o.shortMessage??me}):null,e.jsx(_e,{variant:U,preventMaliciousTransaction:ke,setPreventMaliciousTransaction:ye}),e.jsx(je,{$useSmallMargins:!(!o&&!a&&U!=="warn"&&U!=="error"),address:m,balance:P,errMsg:b||o||a||!E?void 0:`Add funds on ${p?.name??k} to complete transaction.`}),e.jsx(Z,{style:{marginTop:"1rem"},loading:w,disabled:v||b,onClick:O,children:y}),we&&e.jsx(Ce,{style:{marginTop:"1rem"},onClick:x,isSubmitting:!1,children:"Not now"}),e.jsx(oe,{})]})},Or=({img:l,title:a,subtitle:o,cta:x,instructions:I,network:u,blockExplorerUrl:t,isMissingFunds:j,submitError:f,parseError:S,total:E,swap:M,transactingWalletAddress:m,fee:y,balance:v,disabled:p,isSubmitting:w,isPreparing:b,isTokenPriceLoading:D,onClick:L,onClose:C,onBack:H,isSponsored:P})=>{let O=b||D,[F,R]=g.useState(!1),W=ie();return e.jsxs(e.Fragment,{children:[e.jsx(Q,{onClose:C,backFn:H}),l&&e.jsx(ue,{children:l}),e.jsx(ae,{style:{marginTop:l?"1.5rem":0},children:a}),e.jsx(le,{children:o}),e.jsxs(B,{style:{marginTop:"2rem",marginBottom:".5rem"},children:[(E||O)&&e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsx(i,{$isLoading:O,children:E})]}),M&&e.jsxs(s,{children:[e.jsx(n,{children:"Swap"}),e.jsx(i,{children:M})]}),u&&e.jsxs(s,{children:[e.jsx(n,{children:"Network"}),e.jsx(i,{children:u})]}),(y||O||P!==void 0)&&e.jsxs(s,{children:[e.jsx(n,{children:"Estimated fee"}),e.jsx(i,{$isLoading:O,children:P&&!O?e.jsxs(pe,{children:[e.jsxs(ge,{children:["Sponsored by ",W.name]}),e.jsx(xe,{height:16,width:16})]}):y})]})]}),e.jsx(s,{children:e.jsxs(he,{onClick:()=>R((r=>!r)),children:[e.jsx("span",{children:"Advanced"}),e.jsx(de,{height:"16px",width:"16px",strokeWidth:"2",style:{transition:"all 300ms",transform:F?"rotate(180deg)":void 0}})]})}),F&&e.jsx(e.Fragment,{children:I.map(((r,k)=>r.type==="sol-transfer"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Transfer ",r.withSeed?"with seed":""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{children:[X({amount:r.value,decimals:r.token.decimals})," ",r.token.symbol]})]}),!!r.toAccount&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.toAccount,url:t})})]})]},k):r.type==="spl-transfer"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Transfer ",r.token.symbol]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsx(i,{children:r.value.toString()})]}),!!r.fromAta&&e.jsxs(s,{children:[e.jsx(n,{children:"Source"}),e.jsx(i,{children:e.jsx(c,{address:r.fromAta,url:t})})]}),!!r.toAta&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.toAta,url:t})})]}),!!r.token.address&&e.jsxs(s,{children:[e.jsx(n,{children:"Token"}),e.jsx(i,{children:e.jsx(c,{address:r.token.address,url:t})})]})]},k):r.type==="ata-creation"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsx(A,{children:"Create token account"})}),e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},k):r.type==="create-account"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Create account ",r.withSeed?"with seed":""]})}),!!r.account&&e.jsxs(s,{children:[e.jsx(n,{children:"Account"}),e.jsx(i,{children:e.jsx(c,{address:r.account,url:t})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount"}),e.jsxs(i,{children:[X({amount:r.value,decimals:9})," SOL"]})]})]},k):r.type==="spl-init-account"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsx(A,{children:"Initialize token account"})}),!!r.account&&e.jsxs(s,{children:[e.jsx(n,{children:"Account"}),e.jsx(i,{children:e.jsx(c,{address:r.account,url:t})})]}),!!r.mint&&e.jsxs(s,{children:[e.jsx(n,{children:"Mint"}),e.jsx(i,{children:e.jsx(c,{address:r.mint,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},k):r.type==="spl-close-account"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsx(A,{children:"Close token account"})}),!!r.source&&e.jsxs(s,{children:[e.jsx(n,{children:"Source"}),e.jsx(i,{children:e.jsx(c,{address:r.source,url:t})})]}),!!r.destination&&e.jsxs(s,{children:[e.jsx(n,{children:"Destination"}),e.jsx(i,{children:e.jsx(c,{address:r.destination,url:t})})]}),!!r.owner&&e.jsxs(s,{children:[e.jsx(n,{children:"Owner"}),e.jsx(i,{children:e.jsx(c,{address:r.owner,url:t})})]})]},k):r.type==="spl-sync-native"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsx(A,{children:"Sync native"})}),e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]})]},k):r.type==="raydium-swap-base-input"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Raydium swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount in"}),e.jsx(i,{children:r.amountIn.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Minimum amount out"}),e.jsx(i,{children:r.minimumAmountOut.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},k):r.type==="raydium-swap-base-output"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Raydium swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Max amount in"}),e.jsx(i,{children:r.maxAmountIn.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount out"}),e.jsx(i,{children:r.amountOut.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},k):r.type==="jupiter-swap-shared-accounts-route"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Jupiter swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"In amount"}),e.jsx(i,{children:r.inAmount.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Quoted out amount"}),e.jsx(i,{children:r.quotedOutAmount.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},k):r.type==="jupiter-swap-exact-out-route"?e.jsxs(T,{children:[e.jsx(s,{children:e.jsxs(A,{children:["Jupiter swap"," ",r.tokenIn&&r.tokenOut?`${r.tokenIn.symbol} → ${r.tokenOut.symbol}`:""]})}),e.jsxs(s,{children:[e.jsx(n,{children:"Quoted in amount"}),e.jsx(i,{children:r.quotedInAmount.toString()})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Amount out"}),e.jsx(i,{children:r.outAmount.toString()})]}),r.mintIn&&e.jsxs(s,{children:[e.jsx(n,{children:"Token in"}),e.jsx(i,{children:e.jsx(c,{address:r.mintIn,url:t})})]}),r.mintOut&&e.jsxs(s,{children:[e.jsx(n,{children:"Token out"}),e.jsx(i,{children:e.jsx(c,{address:r.mintOut,url:t})})]})]},k):e.jsxs(T,{children:[e.jsxs(s,{children:[e.jsx(n,{children:"Program ID"}),e.jsx(i,{children:e.jsx(c,{address:r.program,url:t})})]}),e.jsxs(s,{children:[e.jsx(n,{children:"Data"}),e.jsx(i,{children:r.discriminator})]})]},k)))}),e.jsx(te,{}),f?e.jsx(V,{style:{marginTop:"2rem"},children:f.message}):S?e.jsx(V,{style:{marginTop:"2rem"},children:me}):null,e.jsx(je,{$useSmallMargins:!(!S&&!f),title:"",address:m,balance:v,errMsg:b||S||f||!j?void 0:"Add funds on Solana to complete transaction."}),e.jsx(Z,{style:{marginTop:"1rem"},loading:w,disabled:p||b,onClick:L,children:x}),e.jsx(oe,{})]})};let je=d(Re)`
  ${l=>l.$useSmallMargins?"margin-top: 0.5rem;":"margin-top: 2rem;"}
`,T=d(B)`
  margin-top: 0.5rem;
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-sm);
  padding: 0.5rem;
`,me="There was an error preparing your transaction. Your transaction request will likely fail.",ue=d.div`
  display: flex;
  width: 100%;
  justify-content: center;
  max-height: 40px;

  > img {
    object-fit: contain;
    border-radius: var(--privy-border-radius-sm);
  }
`,pe=d.span`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
`,ge=d.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,rr=()=>e.jsxs(tr,{children:[e.jsx(lr,{}),e.jsx(or,{})]});const Nr=({transactionError:l,chainId:a,onClose:o,onRetry:x,chainType:I,transactionHash:u})=>{let{chains:t}=Ne(),[j,f]=g.useState(!1),{errorCode:S,errorMessage:E}=((m,y)=>{if(y==="ethereum")return{errorCode:m.details??m.message,errorMessage:m.shortMessage};let v=m.txSignature,p=m?.transactionMessage||"Something went wrong.";if(Array.isArray(m.logs)){let w=m.logs.find((b=>/insufficient (lamports|funds)/gi.test(b)));w&&(p=w)}return{transactionHash:v,errorMessage:p}})(l,I),M=(({chains:m,chainId:y,chainType:v,transactionHash:p})=>v==="ethereum"?m.find((w=>w.id===y))?.blockExplorers?.default.url??"https://etherscan.io":(function(w,b){return`https://explorer.solana.com/tx/${w}?chain=${b}`})(p||"",y))({chains:t,chainId:a,chainType:I,transactionHash:u});return e.jsxs(e.Fragment,{children:[e.jsx(Q,{onClose:o}),e.jsxs(sr,{children:[e.jsx(rr,{}),e.jsx(nr,{children:S}),e.jsx(ir,{children:"Please try again."}),e.jsxs(se,{children:[e.jsx(re,{children:"Error message"}),e.jsx(ne,{$clickable:!1,children:E})]}),u&&e.jsxs(se,{children:[e.jsx(re,{children:"Transaction hash"}),e.jsxs(cr,{children:["Copy this hash to view details about the transaction on a"," ",e.jsx("u",{children:e.jsx("a",{href:M,children:"block explorer"})}),"."]}),e.jsxs(ne,{$clickable:!0,onClick:async()=>{await navigator.clipboard.writeText(u),f(!0)},children:[u,e.jsx(hr,{clicked:j})]})]}),e.jsx(ar,{onClick:()=>x({resetNonce:!!u}),children:"Retry transaction"})]}),e.jsx(Le,{})]})};let sr=d.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`,nr=d.span`
  color: var(--privy-color-foreground);
  text-align: center;
  font-size: 1.125rem;
  font-weight: 500;
  line-height: 1.25rem; /* 111.111% */
  text-align: center;
  margin: 10px;
`,ir=d.span`
  margin-top: 4px;
  margin-bottom: 10px;
  color: var(--privy-color-foreground-3);
  text-align: center;

  font-size: 0.875rem;
  font-style: normal;
  font-weight: 400;
  line-height: 20px; /* 142.857% */
  letter-spacing: -0.008px;
`,tr=d.div`
  position: relative;
  width: 60px;
  height: 60px;
  margin: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
`,or=d(ze)`
  position: absolute;
  width: 35px;
  height: 35px;
  color: var(--privy-color-error);
`,lr=d.div`
  position: absolute;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: var(--privy-color-error);
  opacity: 0.1;
`,ar=d(Z)`
  && {
    margin-top: 24px;
  }
  transition:
    color 350ms ease,
    background-color 350ms ease;
`,re=d.span`
  width: 100%;
  text-align: left;
  font-size: 0.825rem;
  color: var(--privy-color-foreground);
  padding: 4px;
`,se=d.div`
  width: 100%;
  margin: 5px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`,cr=d.text`
  position: relative;
  width: 100%;
  padding: 5px;
  font-size: 0.8rem;
  color: var(--privy-color-foreground-3);
  text-align: left;
  word-wrap: break-word;
`,ne=d.span`
  position: relative;
  width: 100%;
  background-color: var(--privy-color-background-2);
  padding: 8px 12px;
  border-radius: 10px;
  margin-top: 5px;
  font-size: 14px;
  color: var(--privy-color-foreground-3);
  text-align: left;
  word-wrap: break-word;
  ${l=>l.$clickable&&`cursor: pointer;
  transition: background-color 0.3s;
  padding-right: 45px;

  &:hover {
    background-color: var(--privy-color-foreground-4);
  }`}
`,dr=d(Ge)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,xr=d(He)`
  position: absolute;
  top: 13px;
  right: 13px;
  width: 24px;
  height: 24px;
`,hr=({clicked:l})=>e.jsx(l?xr:dr,{});export{Or as G,Mr as Q,Nr as n};
