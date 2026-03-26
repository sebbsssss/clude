import{r as a,aU as I,I as T,P as _,j as e,v as E,dt as U,bX as F,aV as u,c0 as V}from"./vendor-privy-DtunxRQf.js";import{F as W}from"./ShieldCheckIcon-4FH6iPUM.js";import{m as N}from"./ModalHeader-BnVmXtvG-CidjF2-W.js";import{l as O}from"./Layouts-BlFm53ED-r0FkYYx9.js";import{g as H,h as M,u as z,b as B,k as D}from"./shared-DhWmkz5T-DF9kbQlt.js";import{w as s}from"./Screen-Cycy3IzT-BrkGy7CI.js";import"./index-Dq_xe9dz-N_qhxTGL.js";const re={component:()=>{let[o,h]=a.useState(!0),{authenticated:p,user:b}=I(),{walletProxy:y,closePrivyModal:m,createAnalyticsEvent:v,client:j}=T(),{navigate:g,data:k,onUserCloseViaDialogOrKeybindRef:A}=_(),[n,C]=a.useState(void 0),[x,l]=a.useState(""),[d,f]=a.useState(!1),{entropyId:c,entropyIdVerifier:P,onCompleteNavigateTo:w,onSuccess:S,onFailure:$}=k.recoverWallet,i=(r="User exited before their wallet could be recovered")=>{m({shouldCallAuthOnSuccess:!1}),$(typeof r=="string"?new F(r):r)};return A.current=i,a.useEffect((()=>{if(!p)return i("User must be authenticated and have a Privy wallet before it can be recovered")}),[p]),e.jsxs(s,{children:[e.jsx(s.Header,{icon:W,title:"Enter your password",subtitle:"Please provision your account on this new device. To continue, enter your recovery password.",showClose:!0,onClose:i}),e.jsx(s.Body,{children:e.jsx(K,{children:e.jsxs("div",{children:[e.jsxs(H,{children:[e.jsx(M,{type:o?"password":"text",onChange:r=>(t=>{t&&C(t)})(r.target.value),disabled:d,style:{paddingRight:"2.3rem"}}),e.jsx(z,{style:{right:"0.75rem"},children:o?e.jsx(B,{onClick:()=>h(!1)}):e.jsx(D,{onClick:()=>h(!0)})})]}),!!x&&e.jsx(L,{children:x})]})})}),e.jsxs(s.Footer,{children:[e.jsx(s.HelpText,{children:e.jsxs(O,{children:[e.jsx("h4",{children:"Why is this necessary?"}),e.jsx("p",{children:"You previously set a password for this wallet. This helps ensure only you can access it"})]})}),e.jsx(s.Actions,{children:e.jsx(X,{loading:d||!y,disabled:!n,onClick:async()=>{f(!0);let r=await j.getAccessToken(),t=E(b,c);if(!r||!t||n===null)return i("User must be authenticated and have a Privy wallet before it can be recovered");try{v({eventName:"embedded_wallet_recovery_started",payload:{walletAddress:t.address}}),await y?.recover({accessToken:r,entropyId:c,entropyIdVerifier:P,recoveryPassword:n}),l(""),w?g(w):m({shouldCallAuthOnSuccess:!1}),S?.(t),v({eventName:"embedded_wallet_recovery_completed",payload:{walletAddress:t.address}})}catch(R){U(R)?l("Invalid recovery password, please try again."):l("An error has occurred, please try again.")}finally{f(!1)}},$hideAnimations:!c&&d,children:"Recover your account"})}),e.jsx(s.Watermark,{})]})]})}};let K=u.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`,L=u.div`
  line-height: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--privy-color-error);
  text-align: left;
  margin-top: 0.5rem;
`,X=u(N)`
  ${({$hideAnimations:o})=>o&&V`
      && {
        // Remove animations because the recoverWallet task on the iframe partially
        // blocks the renderer, so the animation stutters and doesn't look good
        transition: none;
      }
    `}
`;export{re as PasswordRecoveryScreen,re as default};
