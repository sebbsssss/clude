import{bI as C,af as E,ai as F,r as y,j as e,dh as g,ak as w,c1 as P,bJ as R}from"./vendor-privy-D-qEdLrY.js";import{F as U}from"./ExclamationTriangleIcon-CfVl4UGE.js";import{F as M}from"./LockClosedIcon-DNkKjhwi.js";import{T as x,k as v,u as j}from"./ModalHeader-BnVmXtvG-nKy1GoVW.js";import{r as W}from"./Subtitle-CV-2yKE4-CuPgY2H6.js";import{e as b}from"./Title-BnzYV3Is-BUooebHz.js";const A=R.div`
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
`,O={component:()=>{let{user:t}=C(),{client:S,walletProxy:u,refreshSessionAndUser:$,closePrivyModal:s}=E(),r=F(),{entropyId:f,entropyIdVerifier:T}=r.data?.recoverWallet,[a,m]=y.useState(!1),[i,k]=y.useState(null),[l,h]=y.useState(null);function n(){if(!a){if(l)return r.data?.setWalletPassword?.onFailure(l),void s();if(!i)return r.data?.setWalletPassword?.onFailure(Error("User exited set recovery flow")),void s()}}r.onUserCloseViaDialogOrKeybindRef.current=n;let I=!(!a&&!i);return e.jsxs(e.Fragment,l?{children:[e.jsx(x,{onClose:n},"header"),e.jsx(A,{$color:"var(--privy-color-error)",style:{alignSelf:"center"},children:e.jsx(U,{height:38,width:38,stroke:"var(--privy-color-error)"})}),e.jsx(b,{style:{marginTop:"0.5rem"},children:"Something went wrong"}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{onClick:()=>h(null),children:"Try again"}),e.jsx(j,{})]}:{children:[e.jsx(x,{onClose:n},"header"),e.jsx(M,{style:{width:"3rem",height:"3rem",alignSelf:"center"}}),e.jsx(b,{style:{marginTop:"0.5rem"},children:"Automatically secure your account"}),e.jsx(W,{style:{marginTop:"1rem"},children:"When you log into a new device, you’ll only need to authenticate to access your account. Never get logged out if you forget your password."}),e.jsx(g,{style:{minHeight:"2rem"}}),e.jsx(v,{loading:a,disabled:I,onClick:()=>(async function(){m(!0);try{let o=await S.getAccessToken(),c=w(t,f);if(!o||!u||!c)return;if(!(await u.setRecovery({accessToken:o,entropyId:f,entropyIdVerifier:T,existingRecoveryMethod:c.recoveryMethod,recoveryMethod:"privy"})).entropyId)throw Error("Unable to set recovery on wallet");let d=await $();if(!d)throw Error("Unable to set recovery on wallet");let p=w(d,c.address);if(!p)throw Error("Unabled to set recovery on wallet");k(!!d),setTimeout((()=>{r.data?.setWalletPassword?.onSuccess(p),s()}),P)}catch(o){h(o)}finally{m(!1)}})(),children:i?"Success":"Confirm"}),e.jsx(j,{})]})}};export{O as SetAutomaticRecoveryScreen,O as default};
