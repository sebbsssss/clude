import{df as L,cM as M,cR as p,fh as $,cO as t,fi as I,dd as W,d7 as b}from"./index-BkcTwur5.js";import{p as B,u as F,k as P,f as V,h as z}from"./SelectSourceAsset-C10HQdge-B8q4zB8G.js";import{p as D}from"./CopyableText-BCytXyJL-DiXL67D0.js";import{n as k}from"./ScreenLayout-D1p_ntex-8MeE28Me.js";import{i as R}from"./InfoBanner-DkQEPd77-C8XBU0UM.js";import{c as j}from"./createLucideIcon-Bqqueww2.js";import{C as Y}from"./check-BTTlJ0EP.js";import{C as A}from"./circle-x-Doe752N_.js";import"./copy-CPpo7n79.js";import"./ModalHeader-BnVmXtvG-DzUrms-3.js";import"./Screen-Cycy3IzT-CWs3e14W.js";import"./index-Dq_xe9dz-Cknf8xXd.js";const q=[["path",{d:"M5 22h14",key:"ehvnwv"}],["path",{d:"M5 2h14",key:"pdyrp9"}],["path",{d:"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",key:"1d314k"}],["path",{d:"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",key:"1vvvr6"}]],N=j("hourglass",q);const O=[["path",{d:"m16 11 2 2 4-4",key:"9rsbq5"}],["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]],H=j("user-check",O),K=({data:e,onClose:i})=>t.jsx(k,{showClose:!0,onClose:i,title:"Initiate bank transfer",subtitle:"Use the details below to complete a bank transfer from your bank.",primaryCta:{label:"Done",onClick:i},watermark:!1,footerText:"Exchange rates and fees are set when you authorize and determine the amount you receive. You'll see the applicable rates and fees for your transaction separately",children:t.jsx(X,{children:(I[e.deposit_instructions.asset]||[]).map((([u,f],m)=>{let d=e.deposit_instructions[u];if(!d||Array.isArray(d))return null;let r=u==="asset"?d.toUpperCase():d,y=r.length>100?`${r.slice(0,9)}...${r.slice(-9)}`:r;return t.jsxs(G,{children:[t.jsx(J,{children:f}),t.jsx(D,{value:r,includeChildren:W.isMobile,children:t.jsx(Q,{children:y})})]},m)}))})});let X=b.ol`
  border-color: var(--privy-color-border-default);
  border-width: 1px;
  border-radius: var(--privy-border-radius-mdlg);
  border-style: solid;
  display: flex;
  flex-direction: column;

  && {
    padding: 0 1rem;
  }
`,G=b.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;

  &:not(:first-of-type) {
    border-top: 1px solid var(--privy-color-border-default);
  }

  & > {
    :nth-child(1) {
      flex-basis: 30%;
    }

    :nth-child(2) {
      flex-basis: 60%;
    }
  }
`,J=b.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-variant-numeric: lining-nums proportional-nums;
  font-feature-settings: 'calt' off;

  /* text-xs/font-regular */
  font-size: 0.75rem;
  font-style: normal;
  font-weight: 400;
  line-height: 1.125rem; /* 150% */

  text-align: left;
  flex-shrink: 0;
`,Q=b.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;

  /* text-sm/font-medium */
  font-size: 0.875rem;
  font-style: normal;
  font-weight: 500;
  line-height: 1.375rem; /* 157.143% */

  text-align: right;
  word-break: break-all;
`;const Z=({onClose:e})=>t.jsx(k,{showClose:!0,onClose:e,icon:A,iconVariant:"error",title:"Something went wrong",subtitle:"We couldn't complete account setup. This isn't caused by anything you did.",primaryCta:{label:"Close",onClick:e},watermark:!0}),ee=({onClose:e,reason:i})=>{let u=i?i.charAt(0).toLowerCase()+i.slice(1):void 0;return t.jsx(k,{showClose:!0,onClose:e,icon:A,iconVariant:"error",title:"Identity verification failed",subtitle:u?`We can't complete identity verification because ${u}. Please try again or contact support for assistance.`:"We couldn't verify your identity. Please try again or contact support for assistance.",primaryCta:{label:"Close",onClick:e},watermark:!0})},te=({onClose:e,email:i})=>t.jsx(k,{showClose:!0,onClose:e,icon:N,title:"Identity verification in progress",subtitle:"We're waiting for Persona to approve your identity verification. This usually takes a few minutes, but may take up to 24 hours.",primaryCta:{label:"Done",onClick:e},watermark:!0,children:t.jsxs(R,{theme:"light",children:["You'll receive an email at ",i," once approved with instructions for completing your deposit."]})}),se=({onClose:e,onAcceptTerms:i,isLoading:u})=>t.jsx(k,{showClose:!0,onClose:e,icon:H,title:"Verify your identity to continue",subtitle:"Finish verification with Persona — it takes just a few minutes and requires a government ID.",helpText:t.jsxs(t.Fragment,{children:[`This app uses Bridge to securely connect accounts and move funds. By clicking "Accept," you agree to Bridge's`," ",t.jsx("a",{href:"https://www.bridge.xyz/legal",target:"_blank",rel:"noopener noreferrer",children:"Terms of Service"})," ","and"," ",t.jsx("a",{href:"https://www.bridge.xyz/legal/row-privacy-policy/bridge-building-limited",target:"_blank",rel:"noopener noreferrer",children:"Privacy Policy"}),"."]}),primaryCta:{label:"Accept and continue",onClick:i,loading:u},watermark:!0}),re=({onClose:e})=>t.jsx(k,{showClose:!0,onClose:e,icon:Y,iconVariant:"success",title:"Identity verified successfully",subtitle:"We've successfully verified your identity. Now initiate a bank transfer to view instructions.",primaryCta:{label:"Initiate bank transfer",onClick:()=>{},loading:!0},watermark:!0}),oe=({opts:e,onClose:i,onEditSourceAsset:u,onSelectAmount:f,isLoading:m})=>t.jsxs(k,{showClose:!0,onClose:i,headerTitle:`Buy ${e.destination.asset.toLocaleUpperCase()}`,primaryCta:{label:"Continue",onClick:f,loading:m},watermark:!0,children:[t.jsx(V,{currency:e.source.selectedAsset,inputMode:"decimal",autoFocus:!0}),t.jsx(z,{selectedAsset:e.source.selectedAsset,onEditSourceAsset:u})]}),ae=({onClose:e,onAcceptTerms:i,onSelectAmount:u,onSelectSource:f,onEditSourceAsset:m,opts:d,state:r,email:y,isLoading:n})=>r.status==="select-amount"?t.jsx(oe,{onClose:e,onSelectAmount:u,onEditSourceAsset:m,opts:d,isLoading:n}):r.status==="select-source-asset"?t.jsx(P,{onSelectSource:f,opts:d,isLoading:n}):r.status==="kyc-prompt"?t.jsx(se,{onClose:e,onAcceptTerms:i,opts:d,isLoading:n}):r.status==="kyc-incomplete"?t.jsx(te,{onClose:e,email:y}):r.status==="kyc-success"?t.jsx(re,{onClose:e}):r.status==="kyc-error"?t.jsx(ee,{onClose:e,reason:r.reason}):r.status==="account-details"?t.jsx(K,{onClose:e,data:r.data}):r.status==="create-customer-error"||r.status==="get-customer-error"?t.jsx(Z,{onClose:e}):null,ge={component:()=>{let{user:e}=L(),i=M().data;if(!i?.FundWithBankDepositScreen)throw Error("Missing data");let{onSuccess:u,onFailure:f,opts:m,createOrUpdateCustomer:d,getCustomer:r,getOrCreateVirtualAccount:y}=i.FundWithBankDepositScreen,[n,w]=p.useState(m),[v,s]=p.useState({status:"select-amount"}),[x,c]=p.useState(null),[S,a]=p.useState(!1),g=p.useRef(null),E=p.useCallback((async()=>{let o;a(!0),c(null);try{o=await r({kycRedirectUrl:window.location.origin})}catch(l){if(!l||typeof l!="object"||!("status"in l)||l.status!==404)return s({status:"get-customer-error"}),c(l),void a(!1)}if(!o)try{o=await d({hasAcceptedTerms:!1,kycRedirectUrl:window.location.origin})}catch(l){return s({status:"create-customer-error"}),c(l),void a(!1)}if(!o)return s({status:"create-customer-error"}),c(Error("Unable to create customer")),void a(!1);if(o.status==="not_started"&&o.kyc_url)return s({status:"kyc-prompt",kycUrl:o.kyc_url}),void a(!1);if(o.status==="not_started")return s({status:"get-customer-error"}),c(Error("Unexpected user state")),void a(!1);if(o.status==="rejected")return s({status:"kyc-error",reason:o.rejection_reasons?.[0]?.reason}),c(Error("User KYC rejected.")),void a(!1);if(o.status==="incomplete")return s({status:"kyc-incomplete"}),void a(!1);if(o.status!=="active")return s({status:"get-customer-error"}),c(Error("Unexpected user state")),void a(!1);o.status;try{let l=await y({destination:n.destination,provider:n.provider,source:{asset:n.source.selectedAsset}});s({status:"account-details",data:l})}catch(l){return s({status:"create-customer-error"}),c(l),void a(!1)}}),[n]),U=p.useCallback((async()=>{if(c(null),a(!0),v.status!=="kyc-prompt")return c(Error("Unexpected state")),void a(!1);let o=$({location:v.kycUrl});if(await d({hasAcceptedTerms:!0}),!o)return c(Error("Unable to begin kyc flow.")),a(!1),void s({status:"create-customer-error"});g.current=new AbortController;let l=await B(o,g.current.signal);if(l.status==="aborted")return;if(l.status==="closed")return void a(!1);l.status;let h=await F({operation:()=>r({}),until:C=>C.status==="active"||C.status==="rejected",delay:0,interval:2e3,attempts:60,signal:g.current.signal});if(h.status!=="aborted"){if(h.status==="max_attempts")return s({status:"kyc-incomplete"}),void a(!1);if(h.status,h.result.status==="rejected")return s({status:"kyc-error",reason:h.result.rejection_reasons?.[0]?.reason}),c(Error("User KYC rejected.")),void a(!1);if(h.result.status!=="active")return s({status:"kyc-incomplete"}),void a(!1);o.closed||o.close(),h.result.status;try{s({status:"kyc-success"});let C=await y({destination:n.destination,provider:n.provider,source:{asset:n.source.selectedAsset}});s({status:"account-details",data:C})}catch(C){s({status:"create-customer-error"}),c(C)}finally{a(!1)}}}),[s,c,a,d,y,v,n,g]),_=p.useCallback((o=>{s({status:"select-amount"}),w({...n,source:{...n.source,selectedAsset:o}})}),[s,w]),T=p.useCallback((()=>{s({status:"select-source-asset"})}),[s]);return t.jsx(ae,{onClose:p.useCallback((async()=>{g.current?.abort(),x?f(x):await u()}),[x,g]),opts:n,state:v,isLoading:S,email:e.email.address,onAcceptTerms:U,onSelectAmount:E,onSelectSource:_,onEditSourceAsset:T})}};export{ge as FundWithBankDepositScreen,ge as default};
