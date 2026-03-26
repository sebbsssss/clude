import{aU as N,P as U,c as M,I as D,r as n,E as d,bf as z,bd as A,j as r,F,bv as W,aV as s}from"./vendor-privy-DtunxRQf.js";import{n as B}from"./OpenLink-DZHy38vr-_fUoIzeO.js";import{C as V}from"./QrCode-B84kEIjT-CjwwAmGi.js";import{$ as q}from"./ModalHeader-BnVmXtvG-CidjF2-W.js";import{r as P}from"./LabelXs-oqZNqbm_-zEncrwsd.js";import{a as H}from"./shouldProceedtoEmbeddedWalletCreationFlow-D2ZT5lW9-PlVwZAmC.js";import{n as Q}from"./ScreenLayout-D1p_ntex-BYJDImRj.js";import{l as _}from"./farcaster-DPlSjvF5-Cw7fIJbf.js";import{C as J}from"./check-MsF7fwPJ.js";import{C as K}from"./copy-86b8b8bP.js";import"./dijkstra-COg3n3zL.js";import"./Screen-Cycy3IzT-BrkGy7CI.js";import"./index-Dq_xe9dz-N_qhxTGL.js";import"./createLucideIcon-D8mqQbvD.js";let X=s.div`
  width: 100%;
`,Y=s.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  height: 56px;
  background: ${e=>e.$disabled?"var(--privy-color-background-2)":"var(--privy-color-background)"};
  border: 1px solid var(--privy-color-foreground-4);
  border-radius: var(--privy-border-radius-md);

  &:hover {
    border-color: ${e=>e.$disabled?"var(--privy-color-foreground-4)":"var(--privy-color-foreground-3)"};
  }
`,G=s.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
`,I=s.span`
  display: block;
  font-size: 16px;
  line-height: 24px;
  color: ${e=>e.$disabled?"var(--privy-color-foreground-2)":"var(--privy-color-foreground)"};
  overflow: hidden;
  text-overflow: ellipsis;
  /* Use single-line truncation without nowrap to respect container width */
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  word-break: break-all;

  @media (min-width: 441px) {
    font-size: 14px;
    line-height: 20px;
  }
`,Z=s(I)`
  color: var(--privy-color-foreground-3);
  font-style: italic;
`,ee=s(P)`
  margin-bottom: 0.5rem;
`,re=s(q)`
  && {
    gap: 0.375rem;
    font-size: 14px;
    flex-shrink: 0;
  }
`;const te=({value:e,title:u,placeholder:l,className:t,showCopyButton:c=!0,truncate:o,maxLength:p=40,disabled:m=!1})=>{let[h,x]=n.useState(!1),w=o&&e?((a,E,f)=>{if((a=a.startsWith("https://")?a.slice(8):a).length<=f)return a;if(E==="middle"){let y=Math.ceil(f/2)-2,S=Math.floor(f/2)-1;return`${a.slice(0,y)}...${a.slice(-S)}`}return`${a.slice(0,f-3)}...`})(e,o,p):e;return n.useEffect((()=>{if(h){let a=setTimeout((()=>x(!1)),3e3);return()=>clearTimeout(a)}}),[h]),r.jsxs(X,{className:t,children:[u&&r.jsx(ee,{children:u}),r.jsxs(Y,{$disabled:m,children:[r.jsx(G,{children:e?r.jsx(I,{$disabled:m,title:e,children:w}):r.jsx(Z,{$disabled:m,children:l||"No value"})}),c&&e&&r.jsx(re,{onClick:function(a){a.stopPropagation(),navigator.clipboard.writeText(e).then((()=>x(!0))).catch(console.error)},size:"sm",children:r.jsxs(r.Fragment,h?{children:["Copied",r.jsx(J,{size:14})]}:{children:["Copy",r.jsx(K,{size:14})]})})]})]})},ae=({connectUri:e,loading:u,success:l,errorMessage:t,onBack:c,onClose:o,onOpenFarcaster:p})=>r.jsx(Q,F.isMobile||u?F.isIOS?{title:t?t.message:"Sign in with Farcaster",subtitle:t?t.detail:"To sign in with Farcaster, please open the Farcaster app.",icon:_,iconVariant:"loading",iconLoadingStatus:{success:l,fail:!!t},primaryCta:e&&p?{label:"Open Farcaster app",onClick:p}:void 0,onBack:c,onClose:o,watermark:!0}:{title:t?t.message:"Signing in with Farcaster",subtitle:t?t.detail:"This should only take a moment",icon:_,iconVariant:"loading",iconLoadingStatus:{success:l,fail:!!t},onBack:c,onClose:o,watermark:!0,children:e&&F.isMobile&&r.jsx(ie,{children:r.jsx(B,{text:"Take me to Farcaster",url:e,color:"#8a63d2"})})}:{title:"Sign in with Farcaster",subtitle:"Scan with your phone's camera to continue.",onBack:c,onClose:o,watermark:!0,children:r.jsxs(oe,{children:[r.jsx(se,{children:e?r.jsx(V,{url:e,size:275,squareLogoElement:_}):r.jsx(ce,{children:r.jsx(W,{})})}),r.jsxs(ne,{children:[r.jsx(le,{children:"Or copy this link and paste it into a phone browser to open the Farcaster app."}),e&&r.jsx(te,{value:e,truncate:"end",maxLength:30,showCopyButton:!0,disabled:!0})]})]})}),Ce={component:()=>{let{authenticated:e,logout:u,ready:l,user:t}=N(),{lastScreen:c,navigate:o,navigateBack:p,setModalData:m}=U(),h=M(),{getAuthFlow:x,loginWithFarcaster:w,closePrivyModal:a,createAnalyticsEvent:E}=D(),[f,y]=n.useState(void 0),[S,R]=n.useState(!1),[b,$]=n.useState(!1),C=n.useRef([]),O=x(),T=O?.meta.connectUri;return n.useEffect((()=>{let g=Date.now(),j=setInterval((async()=>{let k=await O.pollForReady.execute(),L=Date.now()-g;if(k){clearInterval(j),R(!0);try{await w(),$(!0)}catch(i){let v={retryable:!1,message:"Authentication failed"};if(i?.privyErrorCode===d.ALLOWLIST_REJECTED)return void o("AllowlistRejectionScreen");if(i?.privyErrorCode===d.USER_LIMIT_REACHED)return console.error(new z(i).toString()),void o("UserLimitReachedScreen");if(i?.privyErrorCode===d.USER_DOES_NOT_EXIST)return void o("AccountNotFoundScreen");if(i?.privyErrorCode===d.LINKED_TO_ANOTHER_USER)v.detail=i.message??"This account has already been linked to another user.";else{if(i?.privyErrorCode===d.ACCOUNT_TRANSFER_REQUIRED&&i.data?.data?.nonce)return m({accountTransfer:{nonce:i.data?.data?.nonce,account:i.data?.data?.subject,displayName:i.data?.data?.account?.displayName,linkMethod:"farcaster",embeddedWalletAddress:i.data?.data?.otherUser?.embeddedWalletAddress,farcasterEmbeddedAddress:i.data?.data?.otherUser?.farcasterEmbeddedAddress}}),void o("LinkConflictScreen");i?.privyErrorCode===d.INVALID_CREDENTIALS?(v.retryable=!0,v.detail="Something went wrong. Try again."):i?.privyErrorCode===d.TOO_MANY_REQUESTS&&(v.detail="Too many requests. Please wait before trying again.")}y(v)}}else L>12e4&&(clearInterval(j),y({retryable:!0,message:"Authentication failed",detail:"The request timed out. Try again."}))}),2e3);return()=>{clearInterval(j),C.current.forEach((k=>clearTimeout(k)))}}),[]),n.useEffect((()=>{if(l&&e&&b&&t){if(h?.legal.requireUsersAcceptTerms&&!t.hasAcceptedTerms){let g=setTimeout((()=>{o("AffirmativeConsentScreen")}),A);return()=>clearTimeout(g)}b&&(H(t,h.embeddedWallets)?C.current.push(setTimeout((()=>{m({createWallet:{onSuccess:()=>{},onFailure:g=>{console.error(g),E({eventName:"embedded_wallet_creation_failure_logout",payload:{error:g,screen:"FarcasterConnectStatusScreen"}}),u()},callAuthOnSuccessOnClose:!0}}),o("EmbeddedWalletOnAccountCreateScreen")}),A)):C.current.push(setTimeout((()=>a({shouldCallAuthOnSuccess:!0,isSuccess:!0})),A)))}}),[b,l,e,t]),r.jsx(ae,{connectUri:T,loading:S,success:b,errorMessage:f,onBack:c?p:void 0,onClose:a,onOpenFarcaster:()=>{T&&(window.location.href=T)}})}};let ie=s.div`
  margin-top: 24px;
`,oe=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`,se=s.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 275px;
`,ne=s.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`,le=s.div`
  font-size: 0.875rem;
  text-align: center;
  color: var(--privy-color-foreground-2);
`,ce=s.div`
  position: relative;
  width: 82px;
  height: 82px;
`;export{Ce as FarcasterConnectStatusScreen,ae as FarcasterConnectStatusView,Ce as default};
