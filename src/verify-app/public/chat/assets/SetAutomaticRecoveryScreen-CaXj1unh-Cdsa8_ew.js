import{dF as C,dc as E,da as I,de as y,d4 as e,e9 as g,en as x,dB as P,dx as R}from"./index-CTw60tnN.js";import{F as U}from"./ExclamationTriangleIcon-Cx1UOSnl.js";import{F as M}from"./LockClosedIcon-BMHwT7X0.js";import{T as w,k as v,u as j}from"./ModalHeader-BnVmXtvG-EcG3iF6i.js";import{r as W}from"./Subtitle-CV-2yKE4-Dhhgn4uJ.js";import{e as S}from"./Title-BnzYV3Is-CRn-SOdH.js";const A=R.div`
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
`,O={component:()=>{let{user:t}=C(),{client:b,walletProxy:u,refreshSessionAndUser:$,closePrivyModal:s}=E(),r=I(),{entropyId:m,entropyIdVerifier:T}=r.data?.recoverWallet,[a,f]=y.useState(!1),[i,F]=y.useState(null),[l,h]=y.useState(null);function n(){if(!a){if(l)return r.data?.setWalletPassword?.onFailure(l),void s();if(!i)return r.data?.setWalletPassword?.onFailure(Error("User exited set recovery flow")),void s()}}r.onUserCloseViaDialogOrKeybindRef.current=n;let k=!(!a&&!i);return e.jsxs(e.Fragment,l?{children:[e.jsx(w,{onClose:n},"header"),e.jsx(A,{$color:"var(--privy-color-error)",style:{alignSelf:"center"},children:e.jsx(U,{height:38,width:38,stroke:"var(--privy-color-error)"})}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Something went wrong"}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{onClick:()=>h(null),children:"Try again"}),e.jsx(j,{})]}:{children:[e.jsx(w,{onClose:n},"header"),e.jsx(M,{style:{width:"3rem",height:"3rem",alignSelf:"center"}}),e.jsx(S,{style:{marginTop:"0.5rem"},children:"Automatically secure your account"}),e.jsx(W,{style:{marginTop:"1rem"},children:"When you log into a new device, you’ll only need to authenticate to access your account. Never get logged out if you forget your password."}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{loading:a,disabled:k,onClick:()=>(async function(){f(!0);try{let o=await b.getAccessToken(),c=x(t,m);if(!o||!u||!c)return;if(!(await u.setRecovery({accessToken:o,entropyId:m,entropyIdVerifier:T,existingRecoveryMethod:c.recoveryMethod,recoveryMethod:"privy"})).entropyId)throw Error("Unable to set recovery on wallet");let d=await $();if(!d)throw Error("Unable to set recovery on wallet");let p=x(d,c.address);if(!p)throw Error("Unabled to set recovery on wallet");F(!!d),setTimeout((()=>{r.data?.setWalletPassword?.onSuccess(p),s()}),P)}catch(o){h(o)}finally{f(!1)}})(),children:i?"Success":"Confirm"}),e.jsx(j,{})]})}};export{O as SetAutomaticRecoveryScreen,O as default};
