import{aq as E,ap as F,an as I,al as y,am as e,dg as g,eb as w,c4 as P,ar as R}from"./index-C5ltmIwg.js";import{F as U}from"./ExclamationTriangleIcon-B3ddPmRH.js";import{F as M}from"./LockClosedIcon-DbQw6_z2.js";import{T as x,k as v,u as j}from"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import{r as W}from"./Subtitle-CV-2yKE4-BAV-HElB.js";import{e as S}from"./Title-BnzYV3Is-2xr-bbp9.js";const A=R.div`
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
`,O={component:()=>{let{user:t}=E(),{client:b,walletProxy:u,refreshSessionAndUser:$,closePrivyModal:a}=F(),r=I(),{entropyId:m,entropyIdVerifier:T}=r.data?.recoverWallet,[s,f]=y.useState(!1),[l,k]=y.useState(null),[i,h]=y.useState(null);function n(){if(!s){if(i)return r.data?.setWalletPassword?.onFailure(i),void a();if(!l)return r.data?.setWalletPassword?.onFailure(Error("User exited set recovery flow")),void a()}}r.onUserCloseViaDialogOrKeybindRef.current=n;let C=!(!s&&!l);return e.jsxs(e.Fragment,i?{children:[e.jsx(x,{onClose:n},"header"),e.jsx(A,{$color:"var(--privy-color-error)",style:{alignSelf:"center"},children:e.jsx(U,{height:38,width:38,stroke:"var(--privy-color-error)"})}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Something went wrong"}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{onClick:()=>h(null),children:"Try again"}),e.jsx(j,{})]}:{children:[e.jsx(x,{onClose:n},"header"),e.jsx(M,{style:{width:"3rem",height:"3rem",alignSelf:"center"}}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Automatically secure your account"}),e.jsx(W,{style:{marginTop:"1rem"},children:"When you log into a new device, you’ll only need to authenticate to access your account. Never get logged out if you forget your password."}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{loading:s,disabled:C,onClick:()=>(async function(){f(!0);try{let o=await b.getAccessToken(),c=w(t,m);if(!o||!u||!c)return;if(!(await u.setRecovery({accessToken:o,entropyId:m,entropyIdVerifier:T,existingRecoveryMethod:c.recoveryMethod,recoveryMethod:"privy"})).entropyId)throw Error("Unable to set recovery on wallet");let d=await $();if(!d)throw Error("Unable to set recovery on wallet");let p=w(d,c.address);if(!p)throw Error("Unabled to set recovery on wallet");k(!!d),setTimeout((()=>{r.data?.setWalletPassword?.onSuccess(p),a()}),P)}catch(o){h(o)}finally{f(!1)}})(),children:l?"Success":"Confirm"}),e.jsx(j,{})]})}};export{O as SetAutomaticRecoveryScreen,O as default};
