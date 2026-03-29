import{ai as S,dw as L,j as e,dx as y,dy as a,dz as M,dA as z,dB as R,bJ as p}from"./vendor-privy-D-qEdLrY.js";import{k as T,p as q,u as D,f as I,h as Q}from"./SelectSourceAsset-C10HQdge-CpylcKY3.js";import{n as g}from"./ScreenLayout-D1p_ntex-gpRu1-Ng.js";import{t as U,h as N}from"./GooglePay-DA-Ff7zK-IQNg2LA2.js";import{T as $}from"./triangle-alert-ZwnaTIci.js";import{c as f}from"./createLucideIcon-Fg1EDcUL.js";import{C as B}from"./circle-x-BETMXyKz.js";import{C as O}from"./check-DOQ5lhR0.js";import{W}from"./wallet-qjDNGAqB.js";import{S as j}from"./smartphone-efSlpvCg.js";import"./ModalHeader-BnVmXtvG-nKy1GoVW.js";import"./Screen-Cycy3IzT-wOMWdYJj.js";import"./index-Dq_xe9dz-uQVzNJLN.js";const Y=[["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3",key:"cabbwy"}],["rect",{x:"4",y:"2",width:"16",height:"20",rx:"2",key:"1uxh74"}]],b=f("building",Y);const F=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],G=f("chevron-right",F);const X=[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]],v=f("credit-card",X);const H=[["path",{d:"M10 18v-7",key:"wt116b"}],["path",{d:"M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z",key:"1m329m"}],["path",{d:"M14 18v-7",key:"vav6t3"}],["path",{d:"M18 18v-7",key:"aexdmj"}],["path",{d:"M3 22h18",key:"8prr45"}],["path",{d:"M6 18v-7",key:"1ivflk"}]],C=f("landmark",H),[E,K]=((t,o=750)=>{let s;return[(...r)=>{s&&clearTimeout(s),s=setTimeout((()=>{t(...r)}),o)},()=>{s&&clearTimeout(s)}]})((async(t,o)=>{a({isLoading:!0});try{let{getQuotes:s}=y(),r=(await s({source:{asset:o.source.selectedAsset.toUpperCase(),amount:t},destination:{asset:o.destination.asset.toUpperCase(),chain:o.destination.chain,address:o.destination.address},environment:o.environment})).quotes??[];a({localQuotes:r,localSelectedQuote:r[0],isLoading:!1,quotesWarning:r.length>0?null:10>parseFloat(t)?"amount_too_low":"currency_not_available"})}catch{a({localQuotes:[],localSelectedQuote:null,quotesWarning:"currency_not_available"})}})),V=t=>{a({amount:t});let{opts:o}=y();E(t,o)},k=async()=>{let{error:t,state:o,onFailure:s,onSuccess:r}=y();K(),t?s(t):o.status==="provider-success"?await r({status:"confirmed"}):o.status==="provider-confirming"?await r({status:"submitted"}):s(Error("User exited flow"))},J=async()=>{let t,o=z();if(!o)return;let s=R();if(!s)return void a({state:{status:"provider-error"},error:Error("Unable to open payment window")});a({isLoading:!0});let{opts:r,amount:l,getProviderUrl:m,getStatus:u,controller:i}=y();i.current=new AbortController;try{let c=await m({source:{asset:r.source.selectedAsset.toUpperCase(),amount:l||"0"},destination:{asset:r.destination.asset.toUpperCase(),chain:r.destination.chain,address:r.destination.address},provider:o.provider,sub_provider:o.sub_provider??void 0,payment_method:o.payment_method,redirect_url:window.location.origin});s.location.href=c.url,t=c.session_id}catch{return s.close(),void a({state:{status:"provider-error"},isLoading:!1,error:Error("Unable to start payment session")})}let d=await q(s,i.current.signal);if(d.status==="aborted"||(a({isLoading:!1}),d.status==="closed"))return;d.status,a({state:{status:"provider-confirming"}});let n=await D({operation:()=>u({session_id:t,provider:o.provider}),until:c=>c.status==="completed"||c.status==="failed"||c.status==="cancelled",delay:0,interval:2e3,attempts:60,signal:i.current.signal});if(n.status!=="aborted"){if(n.status==="max_attempts")return void a({state:{status:"provider-error"},error:Error("Timed out waiting for response")});n.result?.status==="completed"?a({state:{status:"provider-success"}}):a({state:{status:"provider-error"},error:Error(`Transaction ${n.result?.status??"failed"}`)})}},Z=()=>{let t=M();t&&t.length>0&&a({state:{status:"select-payment-method",quotes:t}})},ee=()=>{a({state:{status:"select-source-asset"}})},te=()=>{a({error:null,state:{status:"select-amount"}})},oe=t=>{a({localSelectedQuote:t,state:{status:"select-amount"}})},se=t=>{let{opts:o,amount:s}=y(),r={...o,source:{...o.source,selectedAsset:t}};a({opts:r,state:{status:"select-amount"}}),E(s,r)},re=({onClose:t})=>e.jsx(g,{showClose:!0,onClose:t,iconVariant:"loading",title:"Processing transaction",subtitle:"Your purchase is in progress. You can leave this screen — we’ll notify you when it’s complete.",primaryCta:{label:"Done",onClick:t},watermark:!0}),ae=({onClose:t,onRetry:o})=>e.jsx(g,{showClose:!0,onClose:t,icon:B,iconVariant:"error",title:"Something went wrong",subtitle:"We couldn't complete your transaction. Please try again.",primaryCta:{label:"Try again",onClick:o},secondaryCta:{label:"Close",onClick:t},watermark:!0}),ne=({onClose:t})=>e.jsx(g,{showClose:!0,onClose:t,icon:O,iconVariant:"success",title:"Transaction confirmed",subtitle:"Your purchase is processing. Funds should arrive in your wallet within a few minutes.",primaryCta:{label:"Done",onClick:t},watermark:!0});let ie={CREDIT_DEBIT_CARD:"card",APPLE_PAY:"Apple Pay",GOOGLE_PAY:"Google Pay",BANK_TRANSFER:"bank deposit",ACH:"bank deposit",SEPA:"bank deposit",PIX:"PIX"},le={CREDIT_DEBIT_CARD:e.jsx(v,{size:14}),APPLE_PAY:e.jsx(j,{size:14}),GOOGLE_PAY:e.jsx(j,{size:14}),BANK_TRANSFER:e.jsx(b,{size:14}),ACH:e.jsx(b,{size:14}),SEPA:e.jsx(b,{size:14}),PIX:e.jsx(W,{size:14})};const de=({opts:t,onClose:o,onEditSourceAsset:s,onEditPaymentMethod:r,onContinue:l,onAmountChange:m,amount:u,selectedQuote:i,quotesWarning:d,quotesCount:n,isLoading:c})=>{return e.jsxs(g,{showClose:!0,onClose:o,headerTitle:`Buy ${t.destination.asset.toLocaleUpperCase()}`,primaryCta:{label:"Continue",onClick:l,loading:c,disabled:!i},helpText:d?e.jsxs(ce,{children:[e.jsx($,{size:16,strokeWidth:2}),e.jsx(ue,{children:e.jsxs(e.Fragment,d==="amount_too_low"?{children:[e.jsx(_,{children:"Amount too low"}),e.jsx(P,{children:"Please choose a higher amount to continue."})]}:{children:[e.jsx(_,{children:"Currency not available"}),e.jsx(P,{children:"Please choose another currency to continue."})]})})]}):i&&n>1?e.jsxs(pe,{onClick:r,children:[(x=i.payment_method,le[x]??e.jsx(v,{size:14})),e.jsxs("span",{children:["Pay with ",(h=i.payment_method,ie[h]??h.replace(/_/g," ").toLowerCase().replace(/^\w/,(w=>w.toUpperCase())))]}),e.jsx(G,{size:14})]}):null,watermark:!0,children:[e.jsx(I,{currency:t.source.selectedAsset,value:u,onChange:m,inputMode:"decimal",autoFocus:!0}),e.jsx(Q,{selectedAsset:t.source.selectedAsset,onEditSourceAsset:s})]});var h,x};let ce=p.div`
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: var(--privy-color-warn-bg, #fffbbb);
  border: 1px solid var(--privy-color-border-warning, #facd63);
  overflow: clip;
  width: 100%;

  svg {
    flex-shrink: 0;
    color: var(--privy-color-icon-warning, #facd63);
  }
`,ue=p.div`
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--privy-color-foreground);
  font-feature-settings:
    'calt' 0,
    'kern' 0;
  text-align: left;
`,_=p.span`
  font-weight: 600;
`,P=p.span`
  font-weight: 400;
`,pe=p.button`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  cursor: pointer;

  && {
    padding: 0;
    color: var(--privy-color-accent);
    font-size: 0.875rem;
    font-style: normal;
    font-weight: 500;
    line-height: 1.375rem;
  }
`,me={CREDIT_DEBIT_CARD:"Credit / debit card",APPLE_PAY:"Apple Pay",GOOGLE_PAY:"Google Pay",BANK_TRANSFER:"Bank transfer",ACH:"ACH",SEPA:"SEPA",PIX:"PIX"},he={CREDIT_DEBIT_CARD:e.jsx(v,{size:20}),APPLE_PAY:e.jsx(N,{width:20,height:20}),GOOGLE_PAY:e.jsx(U,{width:20,height:20}),BANK_TRANSFER:e.jsx(C,{size:20}),ACH:e.jsx(C,{size:20}),SEPA:e.jsx(C,{size:20}),PIX:e.jsx(C,{size:20})};const ye=({onClose:t,onSelectPaymentMethod:o,quotes:s,isLoading:r})=>e.jsx(g,{showClose:!0,onClose:t,title:"Select payment method",subtitle:"Choose how you'd like to pay",watermark:!0,children:e.jsx(ge,{children:s.map(((l,m)=>{return e.jsx(xe,{onClick:()=>o(l),disabled:r,children:e.jsxs(Ce,{children:[e.jsx(fe,{children:(i=l.payment_method,he[i]??e.jsx(v,{size:20}))}),e.jsx(ve,{children:e.jsx(we,{children:(u=l.payment_method,me[u]??u.replace(/_/g," ").toLowerCase().replace(/^\w/,(d=>d.toUpperCase())))})})]})},`${l.provider}-${l.payment_method}-${m}`);var u,i}))})});let ge=p.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
`,xe=p.button`
  border-color: var(--privy-color-border-default);
  border-width: 1px;
  border-radius: var(--privy-border-radius-md);
  border-style: solid;
  display: flex;

  && {
    padding: 1rem 1rem;
  }
`,Ce=p.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
`,fe=p.div`
  color: var(--privy-color-foreground-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`,ve=p.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  flex: 1;
`,we=p.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
`;const Ae=({onClose:t,onContinue:o,onAmountChange:s,onSelectSource:r,onEditSourceAsset:l,onEditPaymentMethod:m,onSelectPaymentMethod:u,onRetry:i,opts:d,state:n,amount:c,selectedQuote:h,quotesWarning:x,quotesCount:w,isLoading:A})=>n.status==="select-amount"?e.jsx(de,{onClose:t,onContinue:o,onAmountChange:s,onEditSourceAsset:l,onEditPaymentMethod:m,opts:d,amount:c,selectedQuote:h,quotesWarning:x,quotesCount:w,isLoading:A}):n.status==="select-source-asset"?e.jsx(T,{onSelectSource:r,opts:d,isLoading:A}):n.status==="select-payment-method"?e.jsx(ye,{onClose:t,onSelectPaymentMethod:u,quotes:n.quotes,isLoading:A}):n.status==="provider-confirming"?e.jsx(re,{onClose:t}):n.status==="provider-error"?e.jsx(ae,{onClose:t,onRetry:i}):n.status==="provider-success"?e.jsx(ne,{onClose:t}):null,De={component:()=>{let{onUserCloseViaDialogOrKeybindRef:t}=S(),o=L();if(!o)throw Error("Unexpected missing data");let{opts:s,state:r,isLoading:l,amount:m,quotesWarning:u,localQuotes:i,localSelectedQuote:d,initialQuotes:n,initialSelectedQuote:c}=o;return t.current=k,e.jsx(Ae,{onClose:k,opts:s,state:r,isLoading:l,amount:m,selectedQuote:d??c,quotesWarning:u,quotesCount:(i??n)?.length??0,onAmountChange:V,onContinue:J,onSelectSource:se,onEditSourceAsset:ee,onEditPaymentMethod:Z,onSelectPaymentMethod:oe,onRetry:te})}};export{De as FiatOnrampScreen,De as default};
