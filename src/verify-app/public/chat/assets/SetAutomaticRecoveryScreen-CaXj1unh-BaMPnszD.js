import{df as k,cP as C,cM as E,cR as y,cO as e,dP as g,d_ as w,db as F,d7 as I}from"./index-cZZafNNI.js";import{F as M}from"./ExclamationTriangleIcon-DNEQ0x3_.js";import{F as U}from"./LockClosedIcon-fRzv4yA0.js";import{T as x,k as v,u as j}from"./ModalHeader-BnVmXtvG-BeIgDUam.js";import{r as W}from"./Subtitle-CV-2yKE4-B_GhBPnT.js";import{e as S}from"./Title-BnzYV3Is-CYjOmQHQ.js";const A=I.div`
  && {
    border-width: 4px;
  }

  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  aspect-ratio: 1;
  border-style: solid;
  border-color: ${t=>t.$color??"var(--privy-color-accent)"};
  border-radius: 50%;
`,_={component:()=>{let{user:t}=k(),{client:b,walletProxy:u,refreshSessionAndUser:$,closePrivyModal:s}=C(),r=E(),{entropyId:f,entropyIdVerifier:P}=r.data?.recoverWallet,[a,m]=y.useState(!1),[i,T]=y.useState(null),[l,h]=y.useState(null);function n(){if(!a){if(l)return r.data?.setWalletPassword?.onFailure(l),void s();if(!i)return r.data?.setWalletPassword?.onFailure(Error("User exited set recovery flow")),void s()}}r.onUserCloseViaDialogOrKeybindRef.current=n;let R=!(!a&&!i);return e.jsxs(e.Fragment,l?{children:[e.jsx(x,{onClose:n},"header"),e.jsx(A,{$color:"var(--privy-color-error)",style:{alignSelf:"center"},children:e.jsx(M,{height:38,width:38,stroke:"var(--privy-color-error)"})}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Something went wrong"}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{onClick:()=>h(null),children:"Try again"}),e.jsx(j,{})]}:{children:[e.jsx(x,{onClose:n},"header"),e.jsx(U,{style:{width:"3rem",height:"3rem",alignSelf:"center"}}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Automatically secure your account"}),e.jsx(W,{style:{marginTop:"1rem"},children:"When you log into a new device, you’ll only need to authenticate to access your account. Never get logged out if you forget your password."}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{loading:a,disabled:R,onClick:()=>(async function(){m(!0);try{let o=await b.getAccessToken(),c=w(t,f);if(!o||!u||!c)return;if(!(await u.setRecovery({accessToken:o,entropyId:f,entropyIdVerifier:P,existingRecoveryMethod:c.recoveryMethod,recoveryMethod:"privy"})).entropyId)throw Error("Unable to set recovery on wallet");let d=await $();if(!d)throw Error("Unable to set recovery on wallet");let p=w(d,c.address);if(!p)throw Error("Unabled to set recovery on wallet");T(!!d),setTimeout((()=>{r.data?.setWalletPassword?.onSuccess(p),s()}),F)}catch(o){h(o)}finally{m(!1)}})(),children:i?"Success":"Confirm"}),e.jsx(j,{})]})}};export{_ as SetAutomaticRecoveryScreen,_ as default};
