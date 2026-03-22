import{cR as a,df as _,cP as I,cM as T,cO as e,d_ as E,d$ as F,dA as O,d7 as u,dJ as U}from"./index-K9D-k8CQ.js";import{F as W}from"./ShieldCheckIcon-Bsv0RmZI.js";import{m as M}from"./ModalHeader-BnVmXtvG-Nz3STb3h.js";import{l as N}from"./Layouts-BlFm53ED-Cah0tDE0.js";import{g as V,h as H,u as z,b as B,k as D}from"./shared-DhWmkz5T-CJEMl0Qa.js";import{w as s}from"./Screen-Cycy3IzT-AInDupKi.js";import"./index-Dq_xe9dz-Xupo7JJd.js";const re={component:()=>{let[o,h]=a.useState(!0),{authenticated:p,user:b}=_(),{walletProxy:y,closePrivyModal:m,createAnalyticsEvent:v,client:g}=I(),{navigate:j,data:k,onUserCloseViaDialogOrKeybindRef:A}=T(),[n,C]=a.useState(void 0),[x,l]=a.useState(""),[d,f]=a.useState(!1),{entropyId:c,entropyIdVerifier:P,onCompleteNavigateTo:w,onSuccess:$,onFailure:R}=k.recoverWallet,i=(r="User exited before their wallet could be recovered")=>{m({shouldCallAuthOnSuccess:!1}),R(typeof r=="string"?new O(r):r)};return A.current=i,a.useEffect((()=>{if(!p)return i("User must be authenticated and have a Privy wallet before it can be recovered")}),[p]),e.jsxs(s,{children:[e.jsx(s.Header,{icon:W,title:"Enter your password",subtitle:"Please provision your account on this new device. To continue, enter your recovery password.",showClose:!0,onClose:i}),e.jsx(s.Body,{children:e.jsx(J,{children:e.jsxs("div",{children:[e.jsxs(V,{children:[e.jsx(H,{type:o?"password":"text",onChange:r=>(t=>{t&&C(t)})(r.target.value),disabled:d,style:{paddingRight:"2.3rem"}}),e.jsx(z,{style:{right:"0.75rem"},children:o?e.jsx(B,{onClick:()=>h(!1)}):e.jsx(D,{onClick:()=>h(!0)})})]}),!!x&&e.jsx(K,{children:x})]})})}),e.jsxs(s.Footer,{children:[e.jsx(s.HelpText,{children:e.jsxs(N,{children:[e.jsx("h4",{children:"Why is this necessary?"}),e.jsx("p",{children:"You previously set a password for this wallet. This helps ensure only you can access it"})]})}),e.jsx(s.Actions,{children:e.jsx(L,{loading:d||!y,disabled:!n,onClick:async()=>{f(!0);let r=await g.getAccessToken(),t=E(b,c);if(!r||!t||n===null)return i("User must be authenticated and have a Privy wallet before it can be recovered");try{v({eventName:"embedded_wallet_recovery_started",payload:{walletAddress:t.address}}),await y?.recover({accessToken:r,entropyId:c,entropyIdVerifier:P,recoveryPassword:n}),l(""),w?j(w):m({shouldCallAuthOnSuccess:!1}),$?.(t),v({eventName:"embedded_wallet_recovery_completed",payload:{walletAddress:t.address}})}catch(S){F(S)?l("Invalid recovery password, please try again."):l("An error has occurred, please try again.")}finally{f(!1)}},$hideAnimations:!c&&d,children:"Recover your account"})}),e.jsx(s.Watermark,{})]})]})}};let J=u.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`,K=u.div`
  line-height: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--privy-color-error);
  text-align: left;
  margin-top: 0.5rem;
`,L=u(M)`
  ${({$hideAnimations:o})=>o&&U`
      && {
        // Remove animations because the recoverWallet task on the iframe partially
        // blocks the renderer, so the animation stutters and doesn't look good
        transition: none;
      }
    `}
`;export{re as PasswordRecoveryScreen,re as default};
