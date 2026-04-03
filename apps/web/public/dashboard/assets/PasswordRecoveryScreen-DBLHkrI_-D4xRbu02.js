import{al as a,aq as I,ap as T,an as _,am as e,eb as E,ec as F,cK as U,ar as u,cP as W}from"./index-C5ltmIwg.js";import{F as N}from"./ShieldCheckIcon-D0PTlg34.js";import{m as O}from"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import{l as V}from"./Layouts-BlFm53ED-Cl-jVgTB.js";import{g as H,h as M,u as z,b as K,k as q}from"./shared-DhWmkz5T-C7IUj8Oe.js";import{w as s}from"./Screen-Cycy3IzT-CRRvO9tN.js";import"./index-Dq_xe9dz-CSuLitfE.js";const re={component:()=>{let[o,h]=a.useState(!0),{authenticated:p,user:b}=I(),{walletProxy:y,closePrivyModal:m,createAnalyticsEvent:v,client:g}=T(),{navigate:j,data:k,onUserCloseViaDialogOrKeybindRef:A}=_(),[n,C]=a.useState(void 0),[x,l]=a.useState(""),[d,f]=a.useState(!1),{entropyId:c,entropyIdVerifier:P,onCompleteNavigateTo:w,onSuccess:S,onFailure:$}=k.recoverWallet,i=(r="User exited before their wallet could be recovered")=>{m({shouldCallAuthOnSuccess:!1}),$(typeof r=="string"?new U(r):r)};return A.current=i,a.useEffect((()=>{if(!p)return i("User must be authenticated and have a Privy wallet before it can be recovered")}),[p]),e.jsxs(s,{children:[e.jsx(s.Header,{icon:N,title:"Enter your password",subtitle:"Please provision your account on this new device. To continue, enter your recovery password.",showClose:!0,onClose:i}),e.jsx(s.Body,{children:e.jsx(B,{children:e.jsxs("div",{children:[e.jsxs(H,{children:[e.jsx(M,{type:o?"password":"text",onChange:r=>(t=>{t&&C(t)})(r.target.value),disabled:d,style:{paddingRight:"2.3rem"}}),e.jsx(z,{style:{right:"0.75rem"},children:o?e.jsx(K,{onClick:()=>h(!1)}):e.jsx(q,{onClick:()=>h(!0)})})]}),!!x&&e.jsx(D,{children:x})]})})}),e.jsxs(s.Footer,{children:[e.jsx(s.HelpText,{children:e.jsxs(V,{children:[e.jsx("h4",{children:"Why is this necessary?"}),e.jsx("p",{children:"You previously set a password for this wallet. This helps ensure only you can access it"})]})}),e.jsx(s.Actions,{children:e.jsx(L,{loading:d||!y,disabled:!n,onClick:async()=>{f(!0);let r=await g.getAccessToken(),t=E(b,c);if(!r||!t||n===null)return i("User must be authenticated and have a Privy wallet before it can be recovered");try{v({eventName:"embedded_wallet_recovery_started",payload:{walletAddress:t.address}}),await y?.recover({accessToken:r,entropyId:c,entropyIdVerifier:P,recoveryPassword:n}),l(""),w?j(w):m({shouldCallAuthOnSuccess:!1}),S?.(t),v({eventName:"embedded_wallet_recovery_completed",payload:{walletAddress:t.address}})}catch(R){F(R)?l("Invalid recovery password, please try again."):l("An error has occurred, please try again.")}finally{f(!1)}},$hideAnimations:!c&&d,children:"Recover your account"})}),e.jsx(s.Watermark,{})]})]})}};let B=u.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`,D=u.div`
  line-height: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--privy-color-error);
  text-align: left;
  margin-top: 0.5rem;
`,L=u(O)`
  ${({$hideAnimations:o})=>o&&W`
      && {
        // Remove animations because the recoverWallet task on the iframe partially
        // blocks the renderer, so the animation stutters and doesn't look good
        transition: none;
      }
    `}
`;export{re as PasswordRecoveryScreen,re as default};
